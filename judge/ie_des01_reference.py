"""Reference simulation for IE-DES-01, used as the grading oracle.

The judge host calls workload() to generate the arrival and service stream and
reference_simulate() to compute the metrics a correct student implementation
must reproduce. Nothing is sent to the student's solve().

The browser lab page that exported verifiable JSON, and the replay CLI that
checked it, were both retired with the old frontend: there is no longer an
experiment to export, so there is nothing to replay. What remains is the part
the grader uses.
"""
from __future__ import annotations

import heapq
import math



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

