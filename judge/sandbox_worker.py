"""Untrusted-side protocol. Runs ONLY inside the isolated, networkless container.

The trusted instance generator, scorer, authentication tokens, and test seeds
must remain outside this process and outside its mounted filesystem.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

RESULT_PREFIX = "SCIP_OJ_RESULT="
ERROR_PREFIX = "SCIP_OJ_ERROR="
STUDENT_FILE = Path("/sandbox/submission.py")


def main() -> int:
    try:
        public_instance = json.loads(sys.stdin.readline())
        if not isinstance(public_instance, dict):
            raise ValueError("Expected an instance object")
        spec = importlib.util.spec_from_file_location("student_submission", STUDENT_FILE)
        if spec is None or spec.loader is None:
            raise ValueError("Unable to load submission")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if not callable(getattr(module, "solve", None)):
            raise TypeError("Submission must define solve(instance)")
        result = module.solve(public_instance)
        # Disallow non-JSON and non-finite outputs before passing to host scorer.
        serialized = json.dumps(result, allow_nan=False, ensure_ascii=False)
        print(RESULT_PREFIX + serialized, flush=True)
        return 0
    except BaseException as exc:
        # Never expose the host scorer, secrets, stack frames or private seeds.
        print(ERROR_PREFIX + f"{type(exc).__name__}: {str(exc)[:300]}", flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())
