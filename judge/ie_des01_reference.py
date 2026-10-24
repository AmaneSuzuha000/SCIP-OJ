"""Independent teacher-side replay of IE-DES-01 browser experiments.

This is an educational data-integrity check, NOT student authentication, plagiarism
detection, hidden testing, a formal grade, or proof of a real industrial outcome.

The reference simulator intentionally uses a completion-time priority queue,
rather than the browser's per-server availability array.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
from pathlib import Path


SCHEMA = "ie-des01-experiment/1"
PARAM_BOUNDS = {
    "arrivalMean": (1, 120, False),
    "serviceMean": (1, 180, False),
    "serversA": (1, 16, True),
    "serversB": (1, 16, True),
    "horizon": (120, 10080, True),
    "warmup": (0, 9999, True),
    "replications": (5, 100, True),
    "seed": (1, 4294967295, True),
}
METRICS = (
    "avgWait", "throughput", "utilization", "meanQueue", "meanWip",
    "arrivals", "cohortSize", "completions",
)
AGGREGATES = (
    "avgWait", "throughput", "utilization", "meanQueue", "meanWip", "arrivals",
)


class VerificationError(ValueError):
    """The exported lab data could not be independently reproduced."""


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise VerificationError(f"{label}: expected a finite number")
    return value


def _equal(actual, expected, label):
    number = _finite(actual, label)
    if not math.isclose(number, expected, rel_tol=1e-9, abs_tol=1e-7):
        raise VerificationError(f"{label}: exported {number!r} differs from replay {expected!r}")


def validate_params(raw):
    if not isinstance(raw, dict) or set(raw) != set(PARAM_BOUNDS):
        raise VerificationError("params: unexpected or missing fields")
    for key, (low, high, integer) in PARAM_BOUNDS.items():
        value = _finite(raw[key], key)
        if value < low or value > high or (integer and not isinstance(value, int)):
            raise VerificationError(f"{key}: outside the agreed course input contract")
    if raw["warmup"] >= raw["horizon"]:
        raise VerificationError("warmup must be less than horizon")
    return raw


def workload(params, seed):
    """Independently port the published educational 32-bit LCG and inverse CDF."""
    state = seed & 0xFFFFFFFF

    def uniform():
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return (state + 0.5) / 4294967296

    jobs = []
    arrival = 0.0
    while arrival < params["horizon"]:
        arrival -= params["arrivalMean"] * math.log(uniform())
        if arrival >= params["horizon"]:
            break
        if len(jobs) >= 20000:
            raise VerificationError("too many events for the published course contract")
        duration = -params["serviceMean"] * math.log(uniform())
        jobs.append((arrival, duration))
    return jobs


def overlap(start, end, low, high):
    return max(0.0, min(end, high) - max(start, low))


def reference_simulate(jobs, servers, warmup, horizon):
    """FCFS common queue: pop next completed station from a min-heap."""
    finish_times = []
    waiting = busy = queue_area = wip_area = 0.0
    cohort = completions = 0
    for arrival, duration in jobs:
        if len(finish_times) == servers:
            start = max(arrival, heapq.heappop(finish_times))
        else:
            start = arrival
        end = start + duration
        heapq.heappush(finish_times, end)
        if warmup <= arrival < horizon:
            waiting += start - arrival
            cohort += 1
        if warmup <= end < horizon:
            completions += 1
        busy += overlap(start, end, warmup, horizon)
        queue_area += overlap(arrival, start, warmup, horizon)
        wip_area += overlap(arrival, end, warmup, horizon)
    window = horizon - warmup
    return {
        "avgWait": waiting / cohort if cohort else 0,
        "throughput": 60 * completions / window,
        "utilization": busy / (window * servers),
        "meanQueue": queue_area / window,
        "meanWip": wip_area / window,
        "arrivals": len(jobs),
        "cohortSize": cohort,
        "completions": completions,
    }


def _check_metrics(exported, expected, context):
    if not isinstance(exported, dict):
        raise VerificationError(f"{context}: expected metrics object")
    for name in METRICS:
        if name not in exported:
            raise VerificationError(f"{context}.{name}: missing field")
        _equal(exported[name], expected[name], f"{context}.{name}")


def _aggregate(results):
    return {key: sum(row[key] for row in results) / len(results) for key in AGGREGATES}


def verify_document(document):
    """Recompute every replicate, each metric, each summary, and the paired CI."""
    if not isinstance(document, dict) or document.get("schemaVersion") != SCHEMA:
        raise VerificationError("unsupported or missing schemaVersion")
    if document.get("caseId") != "IE-DES-01":
        raise VerificationError("unexpected caseId")
    params = validate_params(document.get("params"))
    runs = document.get("runs")
    if not isinstance(runs, list) or len(runs) != params["replications"]:
        raise VerificationError("runs must contain exactly replications records")
    baseline, alternative, differences = [], [], []
    for index, run in enumerate(runs):
        if not isinstance(run, dict):
            raise VerificationError(f"run #{index + 1} must be an object")
        seed = (params["seed"] + index * 2654435761) & 0xFFFFFFFF
        if run.get("index") != index + 1 or run.get("seed") != seed:
            raise VerificationError(f"run #{index + 1}: index or seed mismatch")
        jobs = workload(params, seed)
        expected_a = reference_simulate(
            jobs, params["serversA"], params["warmup"], params["horizon"]
        )
        expected_b = reference_simulate(
            jobs, params["serversB"], params["warmup"], params["horizon"]
        )
        _check_metrics(run.get("resultA"), expected_a, f"runs[{index}].resultA")
        _check_metrics(run.get("resultB"), expected_b, f"runs[{index}].resultB")
        delta = expected_b["avgWait"] - expected_a["avgWait"]
        _equal(run.get("waitDifference"), delta, f"runs[{index}].waitDifference")
        baseline.append(expected_a)
        alternative.append(expected_b)
        differences.append(delta)

    summary = document.get("summary")
    if not isinstance(summary, dict):
        raise VerificationError("summary missing")
    for label, expected in (("baseline", _aggregate(baseline)), ("alternative", _aggregate(alternative))):
        reported = summary.get(label)
        if not isinstance(reported, dict):
            raise VerificationError(f"summary.{label}: missing object")
        for name, value in expected.items():
            _equal(reported.get(name), value, f"summary.{label}.{name}")
    mean = sum(differences) / len(differences)
    variance = sum((d - mean) ** 2 for d in differences) / (len(differences) - 1)
    half_width = 1.96 * math.sqrt(variance / len(differences))
    ci = summary.get("waitDiffCI")
    if not isinstance(ci, dict) or ci.get("method") != "normal_approx_95" or ci.get("replications") != len(runs):
        raise VerificationError("summary.waitDiffCI: unsupported interval protocol")
    for key, expected in {
        "mean": mean, "low": mean - half_width,
        "high": mean + half_width, "halfWidth": half_width
    }.items():
        _equal(ci.get(key), expected, f"summary.waitDiffCI.{key}")
    return {
        "status": "VERIFIED_REPLAY",
        "caseId": "IE-DES-01",
        "schemaVersion": SCHEMA,
        "replications": len(runs),
        "message": "Educational simulation values replayed; this is NOT an official grade.",
    }


def main():
    parser = argparse.ArgumentParser(description="Recompute IE-DES-01 local simulation evidence.")
    parser.add_argument("manifest", type=Path, help="Browser-exported JSON evidence file")
    args = parser.parse_args()
    try:
        if args.manifest.stat().st_size > 2_000_000:
            raise VerificationError("manifest exceeds the 2 MB educational limit")
        document = json.loads(args.manifest.read_text(encoding="utf-8"))
        print(json.dumps(verify_document(document), ensure_ascii=False))
    except (VerificationError, ValueError, OSError) as exc:
        print(json.dumps({"status": "FAILED_REPLAY", "reason": str(exc)}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
