"""Formal L2 judge: host-side score verification, untrusted Docker-only execution.

Do not import a student's Python module in this process. Each instance runs in
a fresh container with no host secrets, network, or grade oracle. Docker/OCI
isolation is defense-in-depth, not a guarantee against all kernel escapes.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import resource
import secrets
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from judge.common import average_scores, grade_assignment, grade_knapsack
from judge.runner_l1 import SystemJudgeError
from judge.private_instances import private_assignment, private_knapsack
from judge.runner_l2 import problem_dir_for

ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get("SCIP_OJ_SANDBOX_IMAGE", "scip-oj-student:ci")
RESULT_PREFIX = "SCIP_OJ_RESULT="
ERROR_PREFIX = "SCIP_OJ_ERROR="
OUTPUT_LIMIT = 1 << 20
PRIVATE_SEED_PROTOCOL = "hmac_sha256_submission_v1"


def _derive_private_seed(problem_id: str, submission_id: str, index: int, secret: str) -> int:
    """Deterministic private instance, bound to a submission and secret server key.

    Independent grading attempts for the same submission intentionally reuse
    hidden test instances. Students never receive the key or the private seed.
    """
    if not problem_id or not submission_id or index < 0 or not secret:
        raise ValueError("Incomplete private-test seed context")
    payload = f"scip-oj:l2:{PRIVATE_SEED_PROTOCOL}:{problem_id}:{submission_id}:{index}".encode()
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big")



def _limit_cli_output() -> None:
    # Limit file writes by the docker CLI (attached stdout/stderr), not only
    # the Python student process inside the container.
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))


def _run_isolated(code_path: Path, instance: dict[str, Any], timeout_sec: int) -> tuple[dict | None, str | None]:
    """Return (student result, student error). Raise on judge infrastructure errors."""
    with tempfile.TemporaryDirectory(prefix="scip-oj-cid-") as scratch:
        cidfile = Path(scratch) / "cid"
        docker_args = [
            "docker", "run", "--rm", "-i",
            "--network", "none", "--read-only", "--ipc", "none",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--pids-limit", "64", "--memory", "768m", "--memory-swap", "768m",
            "--cpus", "1", "--user", "65534:65534",
            "--tmpfs", "/tmp:rw,nosuid,noexec,size=64m",
            "--cidfile", str(cidfile),
            "--mount", f"type=bind,src={code_path.resolve()},dst=/sandbox/submission.py,readonly",
            "-e", "PYTHONDONTWRITEBYTECODE=1", IMAGE,
        ]
        try:
            with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as out, \
                    tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as err:
                try:
                    run = subprocess.run(
                        docker_args,
                        input=json.dumps(instance, ensure_ascii=False) + "\n",
                        text=True, stdout=out, stderr=err,
                        timeout=timeout_sec + 5, preexec_fn=_limit_cli_output,
                        check=False,
                    )
                except subprocess.TimeoutExpired:
                    return None, f"超过 {timeout_sec}s 时间限制"
                except FileNotFoundError as exc:
                    raise SystemJudgeError("Docker runtime unavailable") from exc
                out.seek(0)
                err.seek(0)
                stdout = out.read(OUTPUT_LIMIT)
                stderr = err.read(1200)
            if run.returncode == 125:
                raise SystemJudgeError("Sandbox container failed to start: " + stderr[:400])
            if run.returncode < 0:
                return None, "评测容器因资源限制退出"
            lines = stdout.splitlines()
            result_lines = [x[len(RESULT_PREFIX):] for x in lines if x.startswith(RESULT_PREFIX)]
            if run.returncode == 0 and result_lines:
                try:
                    value = json.loads(result_lines[-1])
                    if isinstance(value, dict):
                        return value, None
                    return None, "solve(instance) 必须返回 dict"
                except (json.JSONDecodeError, ValueError):
                    return None, "求解器返回 JSON 格式错误"
            student_errors = [x[len(ERROR_PREFIX):] for x in lines if x.startswith(ERROR_PREFIX)]
            return None, (student_errors[-1][:400] if student_errors else "代码异常或输出超限")
        finally:
            # Ensure orphaned containers are stopped if the docker CLI timed out.
            if cidfile.exists():
                container_id = cidfile.read_text().strip()
                if container_id and all(c in "0123456789abcdef" for c in container_id):
                    subprocess.run(["docker", "rm", "-f", container_id],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=10, check=False)


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
    submission_id = os.environ.get("SCIP_OJ_SUBMISSION_ID", "").strip()
    private_key = os.environ.get("SCIP_OJ_PRIVATE_TEST_KEY", "")
    replayable = bool(submission_id and private_key)
    if os.environ.get("SCIP_OJ_REQUIRE_REPLAYABLE_TESTS") == "1" and not replayable:
        return {"ok": False, "status": "system_error",
                "error": "正式评测缺少私有测试重放密钥或提交标识",
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
    if not 1 <= n <= 20:
        return {"ok": False, "status": "system_error", "error": "非法测试实例数量",
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
    gen = private_assignment if meta.get("grader") == "assignment" else private_knapsack
    grade = grade_assignment if meta.get("grader") == "assignment" else grade_knapsack
    try:
        inspected = subprocess.run(
            ["docker", "image", "inspect", IMAGE], timeout=10,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if inspected.returncode != 0:
            raise SystemJudgeError("可信评测容器未构建完成")
        reports = []
        for index in range(n):
            # Hidden tests are unpredictable without the server secret, yet
            # reproducible on appeal and across regrades of this submission.
            # Local ad-hoc runs remain random unless explicitly configured.
            seed = (_derive_private_seed(pid, submission_id, index, private_key)
                    if replayable else secrets.randbits(64))
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
                          "seed_protocol": PRIVATE_SEED_PROTOCOL if replayable else "ephemeral_random",
                          "judge_commit": os.environ.get("GITHUB_SHA") or None,
                          "sandbox": "isolated_container"})
        return aggregate
    except (SystemJudgeError, OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "status": "system_error",
                "error": "评测基础设施异常: " + str(exc)[:350],
                "score": None, "passed": False, "path": str(path), "layer": "L2"}
