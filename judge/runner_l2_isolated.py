"""Formal L2 judge: host-side score verification, untrusted Docker-only execution.

Do not import a student's Python module in this process. Each instance runs in
a fresh container with no host secrets, network, or grade oracle. Docker/OCI
isolation is defense-in-depth, not a guarantee against all kernel escapes.
"""
from __future__ import annotations

import json
import hashlib
import secrets
import subprocess
from pathlib import Path
from typing import Any

from judge.common import average_scores, grade_assignment, grade_knapsack, grade_ie_des01
from judge.errors import SystemJudgeError
from judge.private_instances import private_assignment, private_knapsack, private_ie_des01
from judge.catalog import problem_dir_for
from judge.sandbox import IMAGE, _run_isolated


def grade_file(path: Path, problem_id: str | None = None,
               assignment_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Formal grade. Config overrides originate from authenticated DB lookup."""
    path = Path(path)
    pid = problem_id or path.stem
    pdir = problem_dir_for(pid)
    if pdir is None:
        return {"ok": False, "status": "system_error", "error": "未知题目",
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
    meta = json.loads((pdir / "meta.json").read_text(encoding="utf-8"))
    if assignment_meta:
        # Caller must only supply trusted metadata from the server; never
        # accept these fields from student's submitted source/code.
        if "pass_score" in assignment_meta:
            meta["pass_score"] = int(assignment_meta["pass_score"])
        if "n_instances" in assignment_meta:
            meta["n_instances_l1"] = int(assignment_meta["n_instances"])
    n = int(meta.get("n_instances_l1", 3))
    if not 1 <= n <= 20:
        return {"ok": False, "status": "system_error", "error": "非法测试实例数量",
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
    grader = meta.get("grader")
    if grader == "assignment":
        gen = private_assignment
        grade = grade_assignment
    elif grader == "ie_des01":
        gen = private_ie_des01
        grade = grade_ie_des01
    else:
        gen = private_knapsack
        grade = grade_knapsack
    try:
        inspected = subprocess.run(
            ["docker", "image", "inspect", IMAGE], timeout=10,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if inspected.returncode != 0:
            raise SystemJudgeError("可信评测容器未构建完成")
        reports = []
        for index in range(n):
            # Cryptographically unpredictable per-attempt L2 tests: never use
            # published meta.seed_base or send the oracle to the container.
            seed = secrets.randbits(64)
            # Only service-owned context may supply this private, persistent
            # seed. It is never part of browser-readable config or reports.
            if assignment_meta and assignment_meta.get("instance_seed"):
                raw = f"{assignment_meta['instance_seed']}:{index}".encode()
                seed = int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")
            inst = gen(seed)
            public = {key: value for key, value in inst.items()
                      if key != "optimal_value"}
            result, error = _run_isolated(path, public, int(meta.get("time_limit_sec", 30)))
            if error is not None:
                reports.append({"score": 0, "passed": False,
                                "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                                "messages": [error]})
                continue
            try:
                reports.append(grade(result, inst, meta))
            except (TypeError, ValueError, KeyError, OverflowError) as exc:
                reports.append({"score": 0, "passed": False,
                                "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                                "messages": ["返回解不符合评测格式: " + str(exc)[:180]]})
        aggregate = average_scores(reports, int(meta.get("pass_score", 90)))
        aggregate.update({"ok": True, "status": "done", "problem_id": pid,
                          "path": str(path), "layer": "L2",
                          "test_set": "server_private_v2",
                          "sandbox": "isolated_container"})
        return aggregate
    except (SystemJudgeError, OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "status": "system_error",
                "error": "评测基础设施异常: " + str(exc)[:350],
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
