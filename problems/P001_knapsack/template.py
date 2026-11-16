"""P001 初始模板：请使用 PySCIPOpt 建立 0-1 背包优化模型。"""


def solve(instance: dict) -> dict:
    from pyscipopt import Model, quicksum

    weights = instance["weights"]
    values = instance["values"]
    capacity = instance["capacity"]
    n = int(instance["n"])

    model = Model("p001-knapsack")
    model.hideOutput()

    # 1. 定义 0-1 决策变量：x[i] = 1 表示选入第 i 件物品
    chosen = [model.addVar(vtype="B", name=f"x_{i}") for i in range(n)]

    # 2. 添加容量约束：选中物品总重量不超过 capacity
    # model.addCons(quicksum(weights[i] * chosen[i] for i in range(n)) <= capacity)

    # 3. 设置目标函数：最大化选中物品总价值
    # model.setObjective(quicksum(values[i] * chosen[i] for i in range(n)), "maximize")

    model.optimize()
    solution = {i: 0.0 for i in range(n)}
    objective = 0.0
    if model.getNSols() > 0:
        solution = {i: float(round(model.getVal(chosen[i]))) for i in range(n)}
        objective = float(model.getObjVal())
    return {"status": str(model.getStatus()), "objective": objective, "solution": solution}
