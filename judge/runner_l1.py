"""L1 multi-instance runner (also usable from desktop Python for smoke tests)."""
from __future__ import annotations

import importlib.util
import random
from pathlib import Path
from typing import Any, Callable

from judge.common import average_scores, grade_knapsack


def load_solve(path: Path) -> Callable[[dict], dict]:
    spec = importlib.util.spec_from_file_location("student_submission", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "solve"):
        raise AttributeError("提交文件必须定义 solve(instance)")
    return mod.solve


def gen_knapsack(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    n = rng.randint(4, 8)
    weights = [rng.randint(1, 10) for _ in range(n)]
    values = [rng.randint(1, 12) for _ in range(n)]
    capacity = max(weights) + rng.randint(5, 15)
    # exact DP optimal
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


def run_l1(solve_fn: Callable[[dict], dict], meta: dict[str, Any], problem_id: str = "P001") -> dict[str, Any]:
    n_inst = int(meta.get("n_instances_l1", 3))
    seed_base = int(meta.get("seed_base", 20261021))
    reports = []
    for i in range(n_inst):
        inst = gen_knapsack(seed_base + i)
        try:
            result = solve_fn(inst)
            rep = grade_knapsack(result, inst, meta)
        except Exception as e:  # noqa: BLE001 — student code
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
    out["problem_id"] = problem_id
    out["layer"] = "L1"
    return out
