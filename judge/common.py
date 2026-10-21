"""Property-based grading helpers (feasibility, integrality, objective gap)."""
from __future__ import annotations

from typing import Any, Mapping, Sequence


def check_format(result: Mapping[str, Any]) -> tuple[bool, str]:
    if not isinstance(result, Mapping):
        return False, "返回值必须是 dict"
    if "objective" not in result:
        return False, "缺少 objective"
    if "solution" not in result:
        return False, "缺少 solution"
    try:
        float(result["objective"])
    except (TypeError, ValueError):
        return False, "objective 必须是数字"
    return True, "格式 OK"


def check_feasibility(
    solution: Mapping[Any, float] | Sequence[float],
    instance: Mapping[str, Any],
    eps: float = 1e-5,
) -> tuple[bool, str]:
    """0-1 knapsack: capacity constraint + bounds."""
    weights = instance["weights"]
    capacity = instance["capacity"]
    n = len(weights)
    x = _as_vector(solution, n)
    load = sum(weights[i] * x[i] for i in range(n))
    if load - capacity > eps:
        return False, f"超重: load={load:.6g} > capacity={capacity}"
    for i, v in enumerate(x):
        if v < -eps or v > 1 + eps:
            return False, f"x[{i}]={v} 超出 [0,1]"
    return True, "可行"


def check_integrality(
    solution: Mapping[Any, float] | Sequence[float],
    instance: Mapping[str, Any],
    eps: float = 1e-5,
) -> tuple[bool, str]:
    n = len(instance["weights"])
    x = _as_vector(solution, n)
    for i, v in enumerate(x):
        if abs(v - round(v)) > eps:
            return False, f"x[{i}]={v} 非整数"
    return True, "整数性 OK"


def score_objective(
    obj: float,
    opt: float,
    sense: str = "maximize",
    eps_obj: float = 1e-4,
) -> tuple[int, str]:
    """Return 0..35 points for objective quality (default O weight)."""
    max_pts = 35
    if sense == "maximize":
        gap = (opt - obj) / max(1.0, abs(opt))
    else:
        gap = (obj - opt) / max(1.0, abs(opt))
    gap = max(0.0, gap)
    if gap <= eps_obj:
        return max_pts, f"目标最优 gap={gap:.2e}"
    if gap <= 0.01:
        return int(max_pts * 0.75), f"目标接近最优 gap={gap:.2%}"
    if gap <= 0.05:
        return int(max_pts * 0.5), f"目标可接受 gap={gap:.2%}"
    if gap <= 0.10:
        return int(max_pts * 0.25), f"目标偏差较大 gap={gap:.2%}"
    return 0, f"目标过差 gap={gap:.2%}"


def grade_knapsack(result: Mapping[str, Any], instance: Mapping[str, Any], meta: Mapping[str, Any]) -> dict[str, Any]:
    weights = {"F": 10, "C": 35, "I": 10, "O": 35, "R": 0}
    weights.update(meta.get("weights") or {})
    breakdown = {k: 0 for k in weights}
    messages: list[str] = []

    ok, msg = check_format(result)
    messages.append(msg)
    if not ok:
        return _pack(0, False, breakdown, messages, meta)
    breakdown["F"] = weights["F"]

    ok, msg = check_feasibility(result["solution"], instance, meta.get("eps_feas", 1e-5))
    messages.append(msg)
    if not ok:
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)
    breakdown["C"] = weights["C"]

    ok, msg = check_integrality(result["solution"], instance, meta.get("eps_int", 1e-5))
    messages.append(msg)
    if not ok:
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)
    breakdown["I"] = weights["I"]

    # verify objective matches solution for knapsack
    n = len(instance["values"])
    x = _as_vector(result["solution"], n)
    recomputed = sum(instance["values"][i] * x[i] for i in range(n))
    if abs(recomputed - float(result["objective"])) > meta.get("eps_feas", 1e-5):
        messages.append("objective 与 solution 不一致")
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)

    pts, msg = score_objective(
        float(result["objective"]),
        float(instance["optimal_value"]),
        meta.get("sense", "maximize"),
        meta.get("eps_obj", 1e-4),
    )
    # scale to configured O weight
    o_w = weights["O"]
    breakdown["O"] = int(round(pts * o_w / 35)) if o_w != 35 else pts
    messages.append(msg)

    score = int(sum(breakdown.values()))
    passed = score >= int(meta.get("pass_score", 90))
    return _pack(score, passed, breakdown, messages, meta)


def average_scores(reports: Sequence[Mapping[str, Any]], pass_score: int = 90) -> dict[str, Any]:
    if not reports:
        return {"score": 0, "passed": False, "breakdown": {}, "instances": [], "messages": ["无实例"]}
    score = int(round(sum(r["score"] for r in reports) / len(reports)))
    keys = reports[0]["breakdown"].keys()
    breakdown = {k: int(round(sum(r["breakdown"].get(k, 0) for r in reports) / len(reports))) for k in keys}
    return {
        "score": score,
        "passed": score >= pass_score,
        "breakdown": breakdown,
        "instances": list(reports),
        "messages": [f"N={len(reports)} 实例平均分"],
    }


def _as_vector(solution: Mapping[Any, float] | Sequence[float], n: int) -> list[float]:
    if isinstance(solution, Mapping):
        out = []
        for i in range(n):
            if i in solution:
                out.append(float(solution[i]))
            elif str(i) in solution:
                out.append(float(solution[str(i)]))
            else:
                out.append(0.0)
        return out
    seq = list(solution)
    if len(seq) != n:
        raise ValueError(f"solution 长度 {len(seq)} != {n}")
    return [float(v) for v in seq]


def _pack(score: int, passed: bool, breakdown: dict, messages: list[str], meta: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "score": score,
        "passed": passed,
        "breakdown": breakdown,
        "messages": messages,
        "pass_score": int(meta.get("pass_score", 90)),
    }


def check_assignment_feasibility(
    solution: Mapping[Any, float] | Sequence[float],
    instance: Mapping[str, Any],
    eps: float = 1e-5,
) -> tuple[bool, str]:
    """n×n assignment: binary matrix, each row/col sums to 1."""
    n = int(instance["n"])
    x = _as_matrix(solution, n)
    for i in range(n):
        for j in range(n):
            v = x[i][j]
            if v < -eps or v > 1 + eps:
                return False, f"x[{i},{j}]={v} 超出 [0,1]"
    for i in range(n):
        s = sum(x[i][j] for j in range(n))
        if abs(s - 1.0) > eps:
            return False, f"行 {i} 和={s}（应为 1）"
    for j in range(n):
        s = sum(x[i][j] for i in range(n))
        if abs(s - 1.0) > eps:
            return False, f"列 {j} 和={s}（应为 1）"
    return True, "可行"


def check_assignment_integrality(
    solution: Mapping[Any, float] | Sequence[float],
    instance: Mapping[str, Any],
    eps: float = 1e-5,
) -> tuple[bool, str]:
    n = int(instance["n"])
    x = _as_matrix(solution, n)
    for i in range(n):
        for j in range(n):
            v = x[i][j]
            if abs(v - round(v)) > eps:
                return False, f"x[{i},{j}]={v} 非整数"
    return True, "整数性 OK"


def grade_assignment(result: Mapping[str, Any], instance: Mapping[str, Any], meta: Mapping[str, Any]) -> dict[str, Any]:
    weights = {"F": 10, "C": 35, "I": 10, "O": 35, "R": 0}
    weights.update(meta.get("weights") or {})
    breakdown = {k: 0 for k in weights}
    messages: list[str] = []

    ok, msg = check_format(result)
    messages.append(msg)
    if not ok:
        return _pack(0, False, breakdown, messages, meta)
    breakdown["F"] = weights["F"]

    ok, msg = check_assignment_feasibility(result["solution"], instance, meta.get("eps_feas", 1e-5))
    messages.append(msg)
    if not ok:
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)
    breakdown["C"] = weights["C"]

    ok, msg = check_assignment_integrality(result["solution"], instance, meta.get("eps_int", 1e-5))
    messages.append(msg)
    if not ok:
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)
    breakdown["I"] = weights["I"]

    n = int(instance["n"])
    costs = instance["costs"]
    x = _as_matrix(result["solution"], n)
    recomputed = sum(costs[i][j] * x[i][j] for i in range(n) for j in range(n))
    if abs(recomputed - float(result["objective"])) > meta.get("eps_feas", 1e-5):
        messages.append("objective 与 solution 不一致")
        return _pack(sum(breakdown.values()), False, breakdown, messages, meta)

    pts, msg = score_objective(
        float(result["objective"]),
        float(instance["optimal_value"]),
        meta.get("sense", "minimize"),
        meta.get("eps_obj", 1e-4),
    )
    o_w = weights["O"]
    breakdown["O"] = int(round(pts * o_w / 35)) if o_w != 35 else pts
    messages.append(msg)

    score = int(sum(breakdown.values()))
    passed = score >= int(meta.get("pass_score", 90))
    return _pack(score, passed, breakdown, messages, meta)


def _as_matrix(solution: Mapping[Any, float] | Sequence[Any], n: int) -> list[list[float]]:
    """Accept flat n*n list, nested list, or dict keys 'i,j' / (i,j) / i*n+j."""
    if isinstance(solution, Mapping):
        mat = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                for key in ((i, j), f"{i},{j}", f"{i}-{j}", i * n + j, str(i * n + j)):
                    if key in solution:
                        mat[i][j] = float(solution[key])
                        break
                else:
                    # nested dict solution[i][j]
                    row = solution.get(i, solution.get(str(i)))
                    if isinstance(row, Mapping) and (j in row or str(j) in row):
                        mat[i][j] = float(row[j] if j in row else row[str(j)])
        return mat
    seq = list(solution)
    if len(seq) == n and all(isinstance(r, (list, tuple)) for r in seq):
        return [[float(v) for v in row] for row in seq]
    if len(seq) == n * n:
        return [[float(seq[i * n + j]) for j in range(n)] for i in range(n)]
    raise ValueError(f"solution 形状无法解析为 {n}x{n}")
