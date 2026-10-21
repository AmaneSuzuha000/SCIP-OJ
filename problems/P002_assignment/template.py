"""P002 student template — implement solve(instance) for assignment."""
import itertools


def solve(instance: dict) -> dict:
    n = instance["n"]
    costs = instance["costs"]
    # TODO: replace with MIP (PySCIPOpt). Demo: brute-force permutations (ok for small n).
    best_perm = None
    best = None
    for perm in itertools.permutations(range(n)):
        val = sum(costs[i][perm[i]] for i in range(n))
        if best is None or val < best:
            best = val
            best_perm = perm
    sol = [[0.0] * n for _ in range(n)]
    for i, j in enumerate(best_perm):
        sol[i][j] = 1.0
    return {"status": "optimal", "objective": float(best), "solution": sol}
