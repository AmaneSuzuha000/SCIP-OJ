"""P001 学生模板：用 PySCIPOpt 完成 0-1 背包，不要硬编码 optimal_value。"""


def solve(instance: dict) -> dict:
    from pyscipopt import Model

    weights = instance["weights"]
    values = instance["values"]
    capacity = int(instance["capacity"])
    n = int(instance["n"])

    model = Model("p001-knapsack")
    model.hideOutput()
    chosen = [model.addVar(vtype="B", name=f"x_{i}") for i in range(n)]

    # 容量约束：选中物品的重量之和不超过 capacity。
    # model.addCons(sum(weights[i] * chosen[i] for i in range(n)) <= capacity)
    # 目标：最大化选中物品的价值。
    # model.setObjective(sum(values[i] * chosen[i] for i in range(n)), "maximize")

    model.optimize()
    solution = {i: 0.0 for i in range(n)}
    objective = 0.0
    if model.getNSols() > 0:
        solution = {i: float(round(model.getVal(chosen[i]))) for i in range(n)}
        objective = float(model.getObjVal())
    return {"status": str(model.getStatus()), "objective": objective, "solution": solution}
