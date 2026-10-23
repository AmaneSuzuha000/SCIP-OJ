"""Proposed OJ scoring contract v2 (host-only, NOT wired to live L2).

Design:
- Protocol, integrality and hard feasibility are gates, not bonus points.
- Exact tasks award a test case only after independent property/oracle validation.
- Approximate tasks may award continuous [0,1] quality, but ONLY for feasible
  solutions independently checked on the trusted host.
- Subtask score = weight * minimum quality across the subtask's private cases.
- Official pass requires every private case to be valid AND score >= threshold.
- Infrastructure failure has no numeric grade.

The grading host, never the student's returned JSON, must create verdicts and quality.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping

SCHEMA = "scip-oj-score-policy/2"
ERROR_VERDICTS = frozenset({
    "WA", "TLE", "RE", "FORMAT_ERROR", "INFEASIBLE",
    "NON_INTEGRAL", "OBJECTIVE_MISMATCH", "MEMORY_LIMIT",
})
ALLOWED_VERDICTS = ERROR_VERDICTS | {"AC", "SYSTEM_ERROR"}


class PolicyError(ValueError):
    """The teacher's immutable scoring contract or host verdict is malformed."""


def _decimal(value: Any, label: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise PolicyError(f"{label}: expected a finite decimal")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise PolicyError(f"{label}: invalid decimal") from exc
    if not number.is_finite():
        raise PolicyError(f"{label}: non-finite decimal")
    return number


def normalized_quality(objective: float, baseline: float, certified_optimum: float,
                       sense: str) -> float:
    """A dimensionless approximate-optimization score, not an LP/MIP proof gap.

    Baseline and *certified* optimum must be host-side data. A degenerate
    baseline identical to the optimum is unsuitable for this score and should
    be handled as an exact test, never divided by an epsilon.
    """
    obj = _decimal(objective, "objective")
    base = _decimal(baseline, "baseline")
    opt = _decimal(certified_optimum, "certified_optimum")
    if sense == "minimize":
        improvement, possible = base - obj, base - opt
    elif sense == "maximize":
        improvement, possible = obj - base, opt - base
    else:
        raise PolicyError("sense must be minimize or maximize")
    if possible <= 0:
        raise PolicyError("baseline must be strictly worse than certified optimum")
    if (sense == "minimize" and obj < opt) or (sense == "maximize" and obj > opt):
        raise PolicyError("candidate beats certified optimum: oracle/checker mismatch")
    return float(max(Decimal(0), min(Decimal(1), improvement / possible)))



def target_referenced_quality(objective: float, baseline: float,
                              full_score_target: float, sense: str) -> float:
    """For NP-hard problems WITHOUT certified optimum: reproducible target credit.

    The fixed target grants full marks at or beyond the benchmark; students
    legitimately beating that target also get 1. This is NOT an optimality gap.
    A teacher must pre-register the benchmark's input version and compute budget.
    """
    obj = _decimal(objective, "objective")
    base = _decimal(baseline, "baseline")
    target = _decimal(full_score_target, "full_score_target")
    if sense == "minimize":
        improvement, required = base - obj, base - target
    elif sense == "maximize":
        improvement, required = obj - base, target - base
    else:
        raise PolicyError("sense must be minimize or maximize")
    if required <= 0:
        raise PolicyError("full-score target must be strictly better than baseline")
    return float(max(Decimal(0), min(Decimal(1), improvement / required)))

def score_subtasks(policy: Mapping[str, Any],
                   trusted_results: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """Aggregate a frozen teacher policy and trusted host-generated case verdicts.

    Pass/fail is distinct from score: a high numeric score with even one failed
    private case is NOT 'passed'. Public sample tests do not belong to this
    manifest, since they are practice feedback with zero formal weight.
    """
    if not isinstance(policy, Mapping) or policy.get("schemaVersion") != SCHEMA:
        raise PolicyError("unknown score policy version")
    mode = policy.get("mode")
    if mode not in {"exact", "approximate"}:
        raise PolicyError("mode must be exact or approximate")
    pass_score = policy.get("passScore")
    if type(pass_score) is not int or not 0 <= pass_score <= 100:
        raise PolicyError("passScore must be integer 0..100")
    groups = policy.get("groups")
    if not isinstance(groups, list) or not groups:
        raise PolicyError("groups must be a nonempty list")
    if not isinstance(trusted_results, Mapping):
        raise PolicyError("trusted_results must be a mapping")

    case_ids: set[str] = set()
    group_ids: set[str] = set()
    groups_checked = []
    total_weight = 0
    for group in groups:
        if not isinstance(group, Mapping):
            raise PolicyError("group must be an object")
        name, weight, cases = group.get("id"), group.get("weight"), group.get("cases")
        if not isinstance(name, str) or not name or name in group_ids:
            raise PolicyError("duplicate/invalid group id")
        if type(weight) is not int or not 1 <= weight <= 100:
            raise PolicyError("group weight must be positive integer")
        if not isinstance(cases, list) or not cases:
            raise PolicyError(f"{name}: no case IDs")
        group_ids.add(name)
        total_weight += weight
        for case_id in cases:
            if not isinstance(case_id, str) or not case_id or case_id in case_ids:
                raise PolicyError("duplicate/invalid test case id")
            case_ids.add(case_id)
        groups_checked.append((name, weight, tuple(cases)))
    if total_weight != 100:
        raise PolicyError("group weights must sum to exactly 100")

    # Missing cases, unexpected cases or judge bugs are system errors, never
    # student zeroes or successful grades.
    if set(trusted_results) != case_ids:
        return {
            "status": "system_error", "score": None, "passed": False,
            "reason": "judge case coverage does not match frozen policy",
        }

    group_scores = []
    all_accepted = True
    total = Decimal(0)
    for name, weight, cases in groups_checked:
        qualities: list[Decimal] = []
        statuses = []
        for case_id in cases:
            result = trusted_results[case_id]
            if not isinstance(result, Mapping):
                raise PolicyError("verdict must be an object")
            verdict = result.get("verdict")
            if verdict not in ALLOWED_VERDICTS:
                raise PolicyError(f"{case_id}: unsupported verdict")
            if verdict == "SYSTEM_ERROR":
                return {
                    "status": "system_error", "score": None, "passed": False,
                    "reason": "trusted runner or checker infrastructure failure",
                }
            if verdict != "AC":
                qualities.append(Decimal(0))
                all_accepted = False
            elif mode == "exact":
                qualities.append(Decimal(1))
            else:
                quality = _decimal(result.get("quality"), f"{case_id}.quality")
                if not 0 <= quality <= 1:
                    raise PolicyError(f"{case_id}: approximate quality outside 0..1")
                qualities.append(quality)
            statuses.append({"id": case_id, "verdict": verdict})
        fraction = min(qualities)  # IOI-like robust subtask aggregation.
        raw_score = Decimal(weight) * fraction
        total += raw_score
        group_scores.append({
            "id": name,
            "weight": weight,
            "fraction": float(fraction),
            "points": float(raw_score),
            "cases": statuses,  # case IDs and verdicts only; never reveal seeds.
        })
    rounded = int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return {
        "schemaVersion": SCHEMA,
        "status": "done",
        "score": rounded,
        "passed": bool(all_accepted and rounded >= pass_score),
        "allCasesAccepted": all_accepted,
        "passScore": pass_score,
        "mode": mode,
        "rounding": "ROUND_HALF_UP_ONCE",
        "aggregation": "weighted_minimum_per_subtask",
        "groups": group_scores,
    }
