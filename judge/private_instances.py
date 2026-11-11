"""Formal-only random test families, isolated from browser L1 and public seeds.

The browser generator intentionally retains tiny teaching examples. Formal
instances cover larger problem sizes, include equality/near-capacity cases,
and compute the exact optimum on the trusted judge host only.
"""
from __future__ import annotations

import random


def private_knapsack(seed: int) -> dict:
    rng = random.Random(seed)
    n = rng.randint(16, 30)
    weights = [rng.randint(1, 55) for _ in range(n)]
    values = [rng.randint(1, 90) for _ in range(n)]
    cap_ratio = rng.uniform(0.24, 0.65)
    capacity = max(max(weights), int(sum(weights) * cap_ratio))

    # O(n*C) exact reference, never sent to the student's solve().
    dp = [0] * (capacity + 1)
    for w, v in zip(weights, values):
        for c in range(capacity, w - 1, -1):
            dp[c] = max(dp[c], dp[c - w] + v)

    return {"n": n, "weights": weights, "values": values,
            "capacity": capacity, "optimal_value": dp[capacity]}


def private_assignment(seed: int) -> dict:
    rng = random.Random(seed)
    n = rng.randint(6, 9)
    # Include ties and structured local minima, without making data constant.
    costs = [[rng.randint(2, 75) for _ in range(n)] for _ in range(n)]
    # Exact bit-mask dynamic programming O(n*2^n) avoids factorial oracle
    # runtime on the trusted host. Row i is the number of assigned columns.
    dp = {0: 0}
    for _ in range(n):
        nxt = {}
        for mask, value in dp.items():
            row = mask.bit_count()
            for column in range(n):
                if not mask & (1 << column):
                    key = mask | (1 << column)
                    candidate = value + costs[row][column]
                    if key not in nxt or candidate < nxt[key]:
                        nxt[key] = candidate
        dp = nxt
    return {"n": n, "costs": costs,
            "optimal_value": float(dp[(1 << n) - 1])}
