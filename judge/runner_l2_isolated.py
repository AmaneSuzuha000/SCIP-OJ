"""Formal L2 judge: host-side score verification, untrusted Docker-only execution.

Do not import a student's Python module in this process. Each instance runs in
a fresh container with no host secrets, network, or grade oracle. Docker/OCI
isolation is defense-in-depth, not a guarantee against all kernel escapes.
"""
from __future__ import annotations

import json
import hashlib
import os
import secrets
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from judge.common import (
    average_scores,
    grade_assignment,
    grade_knapsack,
    grade_ie_des01,
    validate_meta,
)
from judge.contract import contract_fingerprint, contract_view
from judge.errors import JudgeConfigError, SystemJudgeError
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
        try:
            if "pass_score" in assignment_meta:
                meta["pass_score"] = int(assignment_meta["pass_score"])
            if "n_instances" in assignment_meta:
                meta["n_instances_l1"] = int(assignment_meta["n_instances"])
        except (TypeError, ValueError) as exc:
            return {"ok": False, "status": "system_error",
                    "error": "作业配置字段无法解析: " + str(exc)[:180],
                    "score": None, "passed": False, "path": str(path), "layer": "L2"}
    grader = meta.get("grader")
    try:
        validate_meta(grader, meta)
    except JudgeConfigError as exc:
        # A misconfigured problem is an infrastructure fault. Reporting it as a
        # student's zero would silently destroy a correct submission.
        return {"ok": False, "status": "system_error",
                "error": "题目配置异常: " + str(exc)[:300],
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
    n = int(meta.get("n_instances_l1", 3))
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
        # Seeds are derived before any work starts, so the instances a student
        # receives do not depend on scheduling or on how many run concurrently.
        seeds: list[int] = []
        for index in range(n):
            # Cryptographically unpredictable per-attempt L2 tests: never use
            # published meta.seed_base or send the oracle to the container.
            seed = secrets.randbits(64)
            # Only service-owned context may supply this private, persistent
            # seed. It is never part of browser-readable config or reports.
            if assignment_meta and assignment_meta.get("instance_seed"):
                raw = f"{assignment_meta['instance_seed']}:{index}".encode()
                seed = int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")
            seeds.append(seed)

        def grade_one(index: int) -> dict[str, Any]:
            inst = gen(seeds[index])
            public = {key: value for key, value in inst.items()
                      if key != "optimal_value"}
            result, error = _run_isolated(path, public, int(meta.get("time_limit_sec", 30)))
            if error is not None:
                return {"score": 0, "passed": False,
                        "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                        "messages": [error]}
            # The private seed stays out of the report: it is returned to the
            # browser and would let a student rebuild the hidden instances.
            return grade(result, inst, meta)

        # Containers are independent and startup dominates, so overlapping them
        # shortens wall time without changing any score. Each container is still
        # pinned to one CPU and its own memory ceiling.
        workers = max(1, min(n, int(os.environ.get("SCIP_OJ_INSTANCE_PARALLELISM", "3"))))
        if workers == 1:
            reports = []
            for index in range(n):
                try:
                    reports.append(grade_one(index))
                except (TypeError, ValueError, KeyError, OverflowError) as exc:
                    reports.append({"score": 0, "passed": False,
                                    "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                                    "messages": ["返回解不符合评测格式: " + str(exc)[:180]]})
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                # map() preserves input order, so reports stay index-aligned.
                futures = [pool.submit(grade_one, index) for index in range(n)]
                reports = []
                for future in futures:
                    try:
                        reports.append(future.result())
                    except (TypeError, ValueError, KeyError, OverflowError) as exc:
                        reports.append({"score": 0, "passed": False,
                                        "breakdown": {"F": 0, "C": 0, "I": 0, "O": 0},
                                        "messages": ["返回解不符合评测格式: " + str(exc)[:180]]})
        aggregate = average_scores(reports, int(meta.get("pass_score", 90)))
        # Record the exact scoring contract this run applied, so a later regrade
        # or audit can compare rules without checking out the pinned commit.
        contract_meta = dict(meta)
        if assignment_meta and "scoring_policy_version" in assignment_meta:
            contract_meta["scoring_policy_version"] = assignment_meta["scoring_policy_version"]
        aggregate.update({"ok": True, "status": "done", "problem_id": pid,
                          "path": str(path), "layer": "L2",
                          "test_set": "server_private_v2",
                          "sandbox": "isolated_container",
                          "grader": grader,
                          "contract": contract_view(grader, contract_meta),
                          "contract_fingerprint": contract_fingerprint(grader, contract_meta)})
        return aggregate
    except (SystemJudgeError, OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "status": "system_error",
                "error": "评测基础设施异常: " + str(exc)[:350],
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
