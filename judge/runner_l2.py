"""L2: grade submission files under submissions/<user>/<PID>.py"""
from __future__ import annotations

import json
from pathlib import Path

from judge.runner_l1 import load_solve, run_l1

ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"


def problem_dir_for(pid: str) -> Path | None:
    index = json.loads((PROBLEMS / "index.json").read_text(encoding="utf-8"))
    for item in index:
        if item["id"] == pid:
            return ROOT / item["path"]
    return None


def grade_file(path: Path) -> dict:
    pid = path.stem  # P001.py -> P001
    pdir = problem_dir_for(pid)
    if not pdir:
        return {"ok": False, "error": f"未知题目 {pid}", "path": str(path)}
    meta = json.loads((pdir / "meta.json").read_text(encoding="utf-8"))
    solve = load_solve(path)
    report = run_l1(solve, meta, problem_id=pid)
    report["ok"] = True
    report["path"] = str(path)
    report["layer"] = "L2"
    return report


def discover(submissions_root: Path) -> list[Path]:
    if not submissions_root.is_dir():
        return []
    return sorted(submissions_root.glob("*/*.py"))
