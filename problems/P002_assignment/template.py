"""P002 初始模板：请使用 PySCIPOpt 建立指派优化模型。"""


def solve(instance: dict) -> dict:
    from pyscipopt import Model, quicksum

    n = int(instance["n"])
    costs = instance["costs"]

    model = Model("p002-assignment")
    model.hideOutput()

    # 1. 定义 0-1 决策变量：x[i][j] = 1 表示人员 i 指派给任务 j
    x = [[model.addVar(vtype="B", name=f"x_{i}_{j}") for j in range(n)] for i in range(n)]

    # 2. 添加行指派约束（每人恰一项任务）与列指派约束（每任务恰由一人承担）
    # for i in range(n):
    #     model.addCons(quicksum(x[i][j] for j in range(n)) == 1)
    # for j in range(n):
    #     model.addCons(quicksum(x[i][j] for i in range(n)) == 1)

    # 3. 设置目标函数：最小化总指派费用
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
