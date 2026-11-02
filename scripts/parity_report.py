"""Score parity harness: prove a judge change does not silently regrade anyone.

Every case is a (problem, deterministic seed, witness solution) triple graded
through the same functions the real runner uses. The recorded baseline pins the
score, the score breakdown, and the contract fingerprint, so a change either
reproduces all three or shows up as a diff.

This covers the scoring math and configuration, not container isolation. It runs
in well under a second and needs no Docker, which is what makes it usable on
every commit.

    python scripts/parity_report.py --write    # regenerate the baseline
    python scripts/parity_report.py            # compare, exit 1 on any diff
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from judge.common import grade_assignment, grade_knapsack, validate_meta  # noqa: E402
from judge.contract import contract_fingerprint  # noqa: E402
from judge.runner_l1 import gen_assignment, gen_knapsack  # noqa: E402

BASELINE = ROOT / "tests" / "parity_baseline.json"
SEEDS_PER_PROBLEM = 4

PROBLEMS = (
    ("P001_knapsack", "knapsack", gen_knapsack, grade_knapsack),
    ("P002_assignment", "assignment", gen_assignment, grade_assignment),
)


def load_meta(dirname: str) -> dict:
    path = ROOT / "problems" / dirname / "meta.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _assignment_matrix(n: int, perm: list[int]) -> list[list[int]]:
    return [[int(j == perm[i]) for j in range(n)] for i in range(n)]


def knapsack_witnesses(instance: dict) -> dict:
    """Solutions spanning the whole score range, including hostile shapes."""
    n = instance["n"]
    weights, values, cap = instance["weights"], instance["values"], instance["capacity"]

    def feasible(bits):
        return sum(w * x for w, x in zip(weights, bits)) <= cap

    def value_of(bits):
        return sum(v * x for v, x in zip(values, bits))

    best_bits, best_value = None, None
    for bits in itertools.product((0, 1), repeat=n):
        if feasible(bits):
            total = value_of(bits)
            if best_value is None or total > best_value:
                best_bits, best_value = list(bits), total

    greedy = [0] * n
    remaining = cap
    for i in sorted(range(n), key=lambda i: values[i] / weights[i], reverse=True):
        if weights[i] <= remaining:
            greedy[i] = 1
            remaining -= weights[i]

    return {
        "optimal": {"objective": best_value, "solution": best_bits},
        "greedy_ratio": {"objective": value_of(greedy), "solution": greedy},
        "empty": {"objective": 0, "solution": [0] * n},
        "over_capacity": {"objective": best_value, "solution": [1] * n},
        "wrong_length": {"objective": best_value, "solution": best_bits[:-1]},
        "fractional": {"objective": float(best_value),
                       "solution": [1.0 if x else 0.5 for x in best_bits]},
        "non_finite": {"objective": float("inf"), "solution": best_bits},
    }


def assignment_witnesses(instance: dict) -> dict:
    n, costs = instance["n"], instance["costs"]

    def cost_of(perm):
        return sum(costs[i][perm[i]] for i in range(n))

    best_perm, best_cost = None, None
    for perm in itertools.permutations(range(n)):
        total = cost_of(perm)
        if best_cost is None or total < best_cost:
            best_perm, best_cost = list(perm), total

    identity = list(range(n))
    reversed_perm = list(reversed(range(n)))
    greedy = []
    taken = set()
    for i in range(n):
        j = min((k for k in range(n) if k not in taken), key=lambda k: costs[i][k])
        greedy.append(j)
        taken.add(j)

    return {
        "optimal": {"objective": best_cost, "solution": _assignment_matrix(n, best_perm)},
        "identity": {"objective": cost_of(identity), "solution": _assignment_matrix(n, identity)},
        "reversed": {"objective": cost_of(reversed_perm),
                     "solution": _assignment_matrix(n, reversed_perm)},
        "greedy_row": {"objective": cost_of(greedy), "solution": _assignment_matrix(n, greedy)},
        "wrong_shape": {"objective": best_cost, "solution": _assignment_matrix(n, best_perm)[:-1]},
        "duplicate_column": {"objective": best_cost,
                             "solution": [[1 if j == 0 else 0 for j in range(n)]
                                          for _ in range(n)]},
        "non_finite": {"objective": float("nan"),
                       "solution": _assignment_matrix(n, best_perm)},
    }


def build_cases() -> list[dict]:
    cases: list[dict] = []
    for dirname, grader, generate, grade in PROBLEMS:
        meta = load_meta(dirname)
        validate_meta(grader, meta)
        fingerprint = contract_fingerprint(grader, meta)
        witnesses_of = knapsack_witnesses if grader == "knapsack" else assignment_witnesses
        for offset in range(SEEDS_PER_PROBLEM):
            seed = int(meta.get("seed_base", 0)) + offset
            instance = generate(seed)
            for name, result in witnesses_of(instance).items():
                try:
                    report = grade(result, instance, meta)
                    observed = {"score": report["score"],
                                "breakdown": dict(report["breakdown"])}
                except (TypeError, ValueError, KeyError, OverflowError) as exc:
                    observed = {"raised": type(exc).__name__}
                cases.append({
                    "id": f"{meta['id']}:seed{seed}:{name}",
                    "contract_fingerprint": fingerprint,
                    "observed": observed,
                })
    return cases


def baseline_document() -> dict:
    return {
        "schema": 1,
        "note": "Scores produced by the scoring layer only; container isolation is out of scope.",
        "cases": build_cases(),
    }


def compare(expected: dict, actual: dict) -> list[str]:
    diffs: list[str] = []
    want = {c["id"]: c for c in expected.get("cases", [])}
    got = {c["id"]: c for c in actual.get("cases", [])}
    for case_id in sorted(set(want) - set(got)):
        diffs.append(f"缺少用例 {case_id}")
    for case_id in sorted(set(got) - set(want)):
        diffs.append(f"新增未记录用例 {case_id}")
    for case_id in sorted(set(want) & set(got)):
        if want[case_id]["observed"] != got[case_id]["observed"]:
            diffs.append(
                f"{case_id}: 期望 {json.dumps(want[case_id]['observed'], ensure_ascii=False)} "
                f"实际 {json.dumps(got[case_id]['observed'], ensure_ascii=False)}")
        if want[case_id]["contract_fingerprint"] != got[case_id]["contract_fingerprint"]:
            diffs.append(f"{case_id}: 评分合同指纹发生变化")
    return diffs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="判分结果基线对比")
    parser.add_argument("--write", action="store_true", help="重新生成基线文件")
    parser.add_argument("--baseline", type=Path, default=BASELINE)
    args = parser.parse_args(argv)

    actual = baseline_document()
    if args.write:
        args.baseline.parent.mkdir(parents=True, exist_ok=True)
        args.baseline.write_text(
            json.dumps(actual, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"已写入基线：{args.baseline}（{len(actual['cases'])} 个用例）")
        return 0

    if not args.baseline.exists():
        print(f"基线不存在：{args.baseline}，请先运行 --write", file=sys.stderr)
        return 2

    expected = json.loads(args.baseline.read_text(encoding="utf-8"))
    diffs = compare(expected, actual)
    if diffs:
        print(f"判分结果与基线不一致（{len(diffs)} 处）：", file=sys.stderr)
        for line in diffs:
            print("  " + line, file=sys.stderr)
        return 1

    print(f"判分结果与基线一致：{len(actual['cases'])} 个用例，0 处差异")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
