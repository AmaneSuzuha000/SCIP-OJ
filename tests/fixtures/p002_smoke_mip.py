"""Offline PySCIPOpt smoke solver for P002. Not the student-facing template."""


def solve(instance: dict) -> dict:
    from pyscipopt import Model, quicksum

    n = int(instance["n"])
    costs = instance["costs"]

    model = Model("p002-smoke-mip")
    model.hideOutput()
    x = [[model.addVar(vtype="B", name=f"x_{i}_{j}") for j in range(n)] for i in range(n)]
    for i in range(n):
        model.addCons(quicksum(x[i][j] for j in range(n)) == 1)
    for j in range(n):
        model.addCons(quicksum(x[i][j] for i in range(n)) == 1)
    model.setObjective(
        quicksum(costs[i][j] * x[i][j] for i in range(n) for j in range(n)),
        "minimize",
    )
    model.optimize()
    sol = [[float(round(model.getVal(x[i][j]))) for j in range(n)] for i in range(n)]
    return {"status": str(model.getStatus()), "objective": float(model.getObjVal()), "solution": sol}
