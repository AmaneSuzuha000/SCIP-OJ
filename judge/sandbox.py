"""Untrusted code execution only: isolated Docker, bounded resources and cleanup."""
from __future__ import annotations
import json
import os
import resource
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from judge.errors import SystemJudgeError

IMAGE = os.environ.get("SCIP_OJ_SANDBOX_IMAGE", "scip-oj-student:ci")
RESULT_PREFIX = "SCIP_OJ_RESULT="
ERROR_PREFIX = "SCIP_OJ_ERROR="
OUTPUT_LIMIT = 1 << 20


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

