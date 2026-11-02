"""The scoring contract, and a stable fingerprint for it.

A 40-hex grader_ref already pins the judge source, and therefore meta.json, so a
regrade is reproducible. What it does not give anyone is a cheap way to see
which scoring rules a historical grade actually used, or to notice that the
contract changed between two runs.

The fingerprint below is that missing piece: it is computed from the effective
contract at grade time, written into every report, and can be compared across
runs without checking out any commit.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from judge.common import GRADER_VERSION, resolve_sense

# Fields that can change a student's score. Anything that does not influence the
# number deliberately stays out, so cosmetic edits do not look like drift.
_FINGERPRINT_FIELDS = (
    "eps_feas",
    "eps_int",
    "eps_obj",
    "pass_score",
    "n_instances_l1",
    "time_limit_sec",
    "scoring_policy_version",
)


def contract_view(grader: str, meta: Mapping[str, Any]) -> dict[str, Any]:
    """Return the normalised, scoring-relevant view of a problem's contract."""
    view: dict[str, Any] = {
        "grader": grader,
        "grader_version": GRADER_VERSION.get(grader),
        "sense": resolve_sense(grader, meta),
    }
    weights = meta.get("weights")
    view["weights"] = dict(weights) if isinstance(weights, Mapping) else None
    for field in _FINGERPRINT_FIELDS:
        view[field] = meta.get(field)
    return view


def contract_fingerprint(grader: str, meta: Mapping[str, Any]) -> str:
    """Stable SHA-256 over the scoring contract, independent of key order."""
    payload = json.dumps(
        contract_view(grader, meta),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
