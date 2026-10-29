"""Offline smoke solver for P001. Not the student-facing template."""


def solve(instance: dict) -> dict:
    weights = instance["weights"]
    values = instance["values"]
    capacity = instance["capacity"]
    n = instance["n"]
    table = [[0] * (capacity + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        weight, value = weights[i - 1], values[i - 1]
        for cap in range(capacity + 1):
            table[i][cap] = table[i - 1][cap]
            if cap >= weight:
                table[i][cap] = max(table[i][cap], table[i - 1][cap - weight] + value)
    cap = capacity
    solution = {i: 0.0 for i in range(n)}
    for i in range(n, 0, -1):
        if table[i][cap] != table[i - 1][cap]:
            solution[i - 1] = 1.0
            cap -= weights[i - 1]
    return {"status": "optimal", "objective": float(table[n][capacity]), "solution": solution}
