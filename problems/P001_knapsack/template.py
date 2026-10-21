"""P001 student template — implement solve(instance)."""


def solve(instance: dict) -> dict:
    weights = instance["weights"]
    values = instance["values"]
    capacity = instance["capacity"]
    n = instance["n"]

    # TODO: replace with MIP / DP. Demo DP so the page can smoke-test.
    dp = [0] * (capacity + 1)
    take = [-1] * (capacity + 1)
    parent = [-1] * (capacity + 1)
    for i, (w, v) in enumerate(zip(weights, values)):
        for c in range(capacity, w - 1, -1):
            cand = dp[c - w] + v
            if cand > dp[c]:
                dp[c] = cand
                take[c] = i
                parent[c] = c - w

    # reconstruct one optimal bitset (approx via replay)
    best_c = max(range(capacity + 1), key=lambda c: dp[c])
    chosen = set()
    # recompute with classic 2D for correct reconstruction
    W = [[0] * (capacity + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        w, v = weights[i - 1], values[i - 1]
        for c in range(capacity + 1):
            W[i][c] = W[i - 1][c]
            if c >= w:
                W[i][c] = max(W[i][c], W[i - 1][c - w] + v)
    c = capacity
    sol = {i: 0.0 for i in range(n)}
    for i in range(n, 0, -1):
        if W[i][c] != W[i - 1][c]:
            sol[i - 1] = 1.0
            c -= weights[i - 1]

    return {"status": "optimal", "objective": float(W[n][capacity]), "solution": sol}
