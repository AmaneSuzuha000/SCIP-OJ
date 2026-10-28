import heapq
import math


def workload(params, seed):
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
        duration = -params["serviceMean"] * math.log(uniform())
        jobs.append((arrival, duration))
    return jobs


def overlap(start, end, low, high):
    return max(0.0, min(end, high) - max(start, low))


def solve(instance: dict) -> dict:
    servers = int(instance["servers"])
    warmup = float(instance["warmup"])
    horizon = float(instance["horizon"])
    seed = int(instance["seed"])
    jobs = workload(instance, seed)

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
        "avgWait": waiting / cohort if cohort else 0.0,
        "throughput": 60.0 * completions / window,
        "utilization": busy / (window * servers),
        "meanQueue": queue_area / window,
        "meanWip": wip_area / window,
        "completions": completions,
    }
