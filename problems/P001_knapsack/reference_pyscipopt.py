"""P001 参考解答 — PySCIPOpt MIP 建模（不进学生模板，仅供教师参考）"""

def solve(instance: dict) -> dict:
    from pyscipopt import Model
    
    weights = instance["weights"]
    values = instance["values"]
    capacity = instance["capacity"]
    n = instance["n"]
    
    model = Model("knapsack")
    model.setParam("display/verblevel", 0)
    
    x = {}
    for i in range(n):
        x[i] = model.addVar(vtype="B", name=f"x_{i}")
    
    model.addCons(
        sum(weights[i] * x[i] for i in range(n)) <= capacity,
        "capacity"
    )
    
    model.setObjective(
        sum(values[i] * x[i] for i in range(n)),
        "maximize"
    )
    
    model.optimize()
    
    sol = model.getBestSol()
    objective = model.getObjVal()
    solution = {i: model.getVal(x[i]) for i in range(n)}
    
    return {
        "status": str(model.getStatus()),
        "objective": float(objective),
        "solution": solution
    }
