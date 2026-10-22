"""L1 multi-instance runner (desktop smoke + future L2)."""
from __future__ import annotations

import copy
import importlib.util
import itertools
import random
from pathlib import Path
from typing import Any, Callable

from judge.common import average_scores, grade_assignment, grade_knapsack


class SystemJudgeError(RuntimeError):
    """评测环境故障（如系统缺少求解器/依赖包），不代表学生解答得分 0"""
    pass


def load_solve(path: Path) -> Callable[[dict], dict]:
    try:
        spec = importlib.util.spec_from_file_location("student_submission", path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except (ModuleNotFoundError, ImportError) as e:
        if "pyscipopt" in str(e).lower() or "scip" in str(e).lower():
            raise SystemJudgeError(f"评测环境缺失 SCIP/PySCIPOpt 依赖: {e}") from e
        raise
    if not hasattr(mod, "solve"):
        raise AttributeError("提交文件必须定义 solve(instance)")
    return mod.solve


def gen_knapsack(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    n = rng.randint(4, 8)
    weights = [rng.randint(1, 10) for _ in range(n)]
    values = [rng.randint(1, 12) for _ in range(n)]
    capacity = max(weights) + rng.randint(5, 15)
    dp = [0] * (capacity + 1)
    for w, v in zip(weights, values):
        for c in range(capacity, w - 1, -1):
            dp[c] = max(dp[c], dp[c - w] + v)
    return {
        "n": n,
        "weights": weights,
        "values": values,
        "capacity": capacity,
        "optimal_value": dp[capacity],
    }


def _assignment_opt(costs: list[list[int]]) -> float:
    n = len(costs)
    best = None
    for perm in itertools.permutations(range(n)):
        val = sum(costs[i][perm[i]] for i in range(n))
        if best is None or val < best:
            best = val
    return float(best)


def gen_assignment(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    n = rng.randint(3, 5)
    costs = [[rng.randint(1, 20) for _ in range(n)] for _ in range(n)]
    return {"n": n, "costs": costs, "optimal_value": _assignment_opt(costs)}


def run_l1(
    solve_fn: Callable[[dict], dict],
    meta: dict[str, Any],
    problem_id: str | None = None,
) -> dict[str, Any]:
    pid = problem_id or str(meta.get("id", "PXXX"))
    grader = meta.get("grader", "knapsack")
    gen = gen_assignment if grader == "assignment" else gen_knapsack
    grade = grade_assignment if grader == "assignment" else grade_knapsack
    n_inst = int(meta.get("n_instances_l1", 3))
    seed_base = int(meta.get("seed_base", 20261021))
    reports = []
    for i in range(n_inst):
        inst = gen(seed_base + i)
        try:
            # Keep the oracle and grading state private from the solve(instance) API.
            public_instance = copy.deepcopy({k: v for k, v in inst.items() if k != "optimal_value"})
            result = solve_fn(public_instance)
            rep = grade(result, inst, meta)
        except (ModuleNotFoundError, ImportError) as e:
            if "pyscipopt" in str(e).lower() or "scip" in str(e).lower():
                raise SystemJudgeError(f"评测环境缺失 SCIP/PySCIPOpt 依赖: {e}") from e
            rep = {
                "score": 0,
                "passed": False,
                "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                "messages": [f"运行错误: {e}"],
                "seed": seed_base + i,
            }
        except SystemJudgeError:
            raise
        except Exception as e:  # noqa: BLE001
            rep = {
                "score": 0,
                "passed": False,
                "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                "messages": [f"运行错误: {e}"],
                "seed": seed_base + i,
            }
        else:
            rep["seed"] = seed_base + i
        reports.append(rep)
    out = average_scores(reports, int(meta.get("pass_score", 90)))
    out["problem_id"] = pid
    out["layer"] = "L1"
    return out
