"""Concurrent instances must produce byte-identical verdicts to serial ones.

Overlapping containers is only acceptable because it changes wall time and
nothing else. This pins that claim: same seeds, same instances, same scores,
same order, and no private seed anywhere in the report.
"""
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from judge.runner_l2_isolated import grade_file

PROBLEM_DIR = Path(__file__).resolve().parent.parent / "problems" / "P001_knapsack"


def cheap_witness(instance):
    """Valid but deliberately mediocre. Cheap on purpose: these instances hold
    16 to 30 items, so an exact search would dominate the test runtime."""
    n = instance["n"]
    bits = [0] * n
    remaining = instance["capacity"]
    for i in range(n):
        if instance["weights"][i] <= remaining:
            bits[i] = 1
            remaining -= instance["weights"][i]
    objective = sum(v * x for v, x in zip(instance["values"], bits))
    return {"objective": objective, "solution": bits}


class _Ok:
    returncode = 0


def run_case(parallelism: str) -> tuple[dict, list[str]]:
    seen: list[str] = []

    def fake_run_isolated(path, instance, timeout):
        seen.append(json.dumps(instance, sort_keys=True))
        return cheap_witness(instance), None

    with patch.dict(os.environ, {"SCIP_OJ_INSTANCE_PARALLELISM": parallelism}), \
         patch("judge.runner_l2_isolated.subprocess.run", return_value=_Ok()), \
         patch("judge.runner_l2_isolated._run_isolated", side_effect=fake_run_isolated):
        report = grade_file(PROBLEM_DIR / "template.py", "P001", {
            "n_instances": 3,
            "pass_score": 90,
            "instance_seed": "parity-seed",
        })
    return report, seen


class ParallelInstanceTests(unittest.TestCase):
    def test_parallel_matches_serial_exactly(self):
        serial, serial_instances = run_case("1")
        parallel, parallel_instances = run_case("4")
        self.assertEqual(serial["status"], "done")
        self.assertEqual(serial["score"], parallel["score"])
        self.assertEqual(serial["passed"], parallel["passed"])
        self.assertEqual(serial["breakdown"], parallel["breakdown"])
        self.assertEqual(len(serial["instances"]), len(parallel["instances"]))
        for a, b in zip(serial["instances"], parallel["instances"]):
            self.assertEqual(a["score"], b["score"])
            self.assertEqual(a["breakdown"], b["breakdown"])
        self.assertEqual(sorted(serial_instances), sorted(parallel_instances))

    def test_instances_stay_distinct_across_attempts(self):
        _, seen = run_case("3")
        self.assertEqual(len(seen), 3)
        self.assertEqual(len(set(seen)), 3, "每次尝试的实例必须不同")

    def test_report_never_contains_the_private_seed(self):
        report, _ = run_case("3")
        blob = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("sandbox_seed", blob)
        self.assertNotIn("instance_seed", blob)
        self.assertNotIn("parity-seed", blob)
        for item in report["instances"]:
            self.assertNotIn("seed", item)

    def test_zero_parallelism_falls_back_to_serial(self):
        report, seen = run_case("0")
        self.assertEqual(report["status"], "done")
        self.assertEqual(len(seen), 3)


if __name__ == "__main__":
    unittest.main()
