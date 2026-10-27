"""L2: grade submission files under submissions/<user>/<PID>.py"""
from __future__ import annotations

import json
from pathlib import Path

from judge.runner_l1 import SystemJudgeError, load_solve, run_l1

from judge.catalog import problem_dir_for


def grade_file(path: Path) -> dict:
    pid = path.stem  # P001.py -> P001
    pdir = problem_dir_for(pid)
    if not pdir:
        return {
            "ok": False,
            "status": "system_error",
            "error": f"未知题目 {pid}",
            "score": None,
            "passed": False,
            "path": str(path),
        }
    meta = json.loads((pdir / "meta.json").read_text(encoding="utf-8"))
    try:
        solve = load_solve(path)
        report = run_l1(solve, meta, problem_id=pid)
        report["ok"] = True
        report["status"] = "done"
        report["path"] = str(path)
        report["layer"] = "L2"
        return report
    except SystemJudgeError as e:
        return {
            "ok": False,
            "status": "system_error",
            "error": str(e),
            "score": None,
            "passed": False,
            "path": str(path),
            "layer": "L2",
        }
    except Exception as e:
        if "pyscipopt" in str(e).lower() or "scip" in str(e).lower():
            return {
                "ok": False,
                "status": "system_error",
                "error": f"评测环境缺失 SCIP/PySCIPOpt 依赖: {e}",
                "score": None,
                "passed": False,
                "path": str(path),
                "layer": "L2",
            }
        return {
            "ok": False,
            "status": "done",
            "error": f"执行异常: {e}",
            "score": 0,
            "passed": False,
            "path": str(path),
            "layer": "L2",
        }


def discover(submissions_root: Path) -> list[Path]:
    if not submissions_root.is_dir():
        return []
    return sorted(submissions_root.glob("*/*.py"))
