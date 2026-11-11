"""Untrusted code execution only: isolated Docker, bounded resources and cleanup."""
from __future__ import annotations
import json
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any
from judge.errors import SystemJudgeError

IMAGE = os.environ.get("SCIP_OJ_SANDBOX_IMAGE", "scip-oj-student:ci")
RESULT_PREFIX = "SCIP_OJ_RESULT="
ERROR_PREFIX = "SCIP_OJ_ERROR="
OUTPUT_LIMIT = 1 << 20
STDERR_LIMIT = 16 << 10


def _drain_pipe(pipe, buf: bytearray, limit: int, truncated: list[bool]) -> None:
    try:
        while True:
            chunk = pipe.read(8192)
            if not chunk:
                break
            remaining = limit - len(buf)
            if remaining > 0:
                buf.extend(chunk[:remaining])
            if len(chunk) > remaining:
                truncated[0] = True
    finally:
        try:
            pipe.close()
        except OSError:
            pass


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
            try:
                proc = subprocess.Popen(
                    docker_args,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=False,
                )
            except FileNotFoundError as exc:
                raise SystemJudgeError("Docker runtime unavailable") from exc

            out_buf = bytearray()
            err_buf = bytearray()
            out_truncated = [False]
            err_truncated = [False]
            t_out = threading.Thread(target=_drain_pipe, args=(proc.stdout, out_buf, OUTPUT_LIMIT, out_truncated), daemon=True)
            t_err = threading.Thread(target=_drain_pipe, args=(proc.stderr, err_buf, STDERR_LIMIT, err_truncated), daemon=True)
            t_out.start()
            t_err.start()

            try:
                payload = (json.dumps(instance, ensure_ascii=False) + "\n").encode("utf-8")
                if proc.stdin is not None:
                    try:
                        proc.stdin.write(payload)
                        proc.stdin.flush()
                    except BrokenPipeError:
                        pass
                    finally:
                        try:
                            proc.stdin.close()
                        except OSError:
                            pass
                returncode = proc.wait(timeout=timeout_sec + 5)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
                t_out.join(timeout=1)
                t_err.join(timeout=1)
                return None, f"超过 {timeout_sec}s 时间限制"

            t_out.join(timeout=2)
            t_err.join(timeout=2)
            stdout = out_buf.decode("utf-8", errors="replace")
            stderr = err_buf.decode("utf-8", errors="replace")

            if returncode == 125:
                raise SystemJudgeError("Sandbox container failed to start: " + stderr[:400])
            if returncode < 0:
                return None, "评测容器因资源限制退出"
            if out_truncated[0]:
                return None, "代码标准输出超过 1 MiB 限制"
            lines = stdout.splitlines()
            result_lines = [x[len(RESULT_PREFIX):] for x in lines if x.startswith(RESULT_PREFIX)]
            if returncode == 0 and result_lines:
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

