"""P002 初始模板：请使用 PySCIPOpt 建立指派优化模型。"""


def solve(instance: dict) -> dict:
    from pyscipopt import Model, quicksum

    n = int(instance["n"])
    costs = instance["costs"]

    model = Model("p002-assignment")
    model.hideOutput()
    x = [[model.addVar(vtype="B", name=f"x_{i}_{j}") for j in range(n)] for i in range(n)]

    # 补充行/列指派约束与最小化总成本目标：
    # for i in range(n):
    #     model.addCons(quicksum(x[i][j] for j in range(n)) == 1)
    # for j in range(n):
    #     model.addCons(quicksum(x[i][j] for i in range(n)) == 1)
    # model.setObjective(
    #     quicksum(costs[i][j] * x[i][j] for i in range(n) for j in range(n)),
    #     "minimize",
    # )

    model.optimize()
    sol = [[0.0] * n for _ in range(n)]
    objective = 0.0
    if model.getNSols() > 0:
        sol = [[float(round(model.getVal(x[i][j]))) for j in range(n)] for i in range(n)]
        objective = float(model.getObjVal())
    return {"status": str(model.getStatus()), "objective": objective, "solution": sol}
