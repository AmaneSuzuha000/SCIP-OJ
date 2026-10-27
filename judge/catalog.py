"""Read-only problem lookup, shared by formal and local tooling."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"


def problem_dir_for(pid: str) -> Path | None:
    index = json.loads((PROBLEMS / "index.json").read_text(encoding="utf-8"))
    for item in index:
        if item["id"] == pid:
            return ROOT / item["path"]
    return None


