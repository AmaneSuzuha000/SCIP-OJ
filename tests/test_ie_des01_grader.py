"""Unit tests for IE-DES-01 gradeable simulation problem integration."""
import unittest
from pathlib import Path
from unittest.mock import patch

from judge.catalog import problem_dir_for
from judge.common import grade_ie_des01
from judge.private_instances import private_ie_des01
from judge.runner_l1 import load_solve, run_l1
from judge.runner_l2_isolated import grade_file

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_DIR = ROOT / "problems/IE_DES01_queueing"


class IEDES01GraderTests(unittest.TestCase):
    def test_catalog_resolves_ie_des01(self):
        pdir = problem_dir_for("IE-DES-01")
        self.assertIsNotNone(pdir)
        self.assertTrue((pdir / "meta.json").exists())
        self.assertTrue((pdir / "template.py").exists())
        self.assertTrue((pdir / "judge.py").exists())

    def test_private_instance_generation_and_oracle(self):
        for seed in range(5):
            inst = private_ie_des01(seed)
            self.assertIn("arrivalMean", inst)
            self.assertIn("serviceMean", inst)
            self.assertIn("servers", inst)
            self.assertIn("horizon", inst)
            self.assertIn("warmup", inst)
            self.assertIn("seed", inst)
            self.assertIn("optimal_value", inst)
            oracle = inst["optimal_value"]
            self.assertGreater(oracle["completions"], 0)
            self.assertGreaterEqual(oracle["utilization"], 0.0)
            self.assertLessEqual(oracle["utilization"], 1.0)
            self.assertGreaterEqual(oracle["meanWip"], oracle["meanQueue"])

    def test_reference_implementation_scores_full_marks(self):
        solve_fn = load_solve(PROBLEM_DIR / "reference_simulation.py")
        inst = private_ie_des01(42)
        public_inst = {k: v for k, v in inst.items() if k != "optimal_value"}
        res = solve_fn(public_inst)
        meta = {"pass_score": 90, "weights": {"F": 15, "C": 25, "I": 20, "O": 40, "R": 0}}
        grade_res = grade_ie_des01(res, inst, meta)
        self.assertEqual(grade_res["score"], 100)
        self.assertTrue(grade_res["passed"])
        self.assertEqual(grade_res["breakdown"]["F"], 15)
        self.assertEqual(grade_res["breakdown"]["C"], 25)
        self.assertEqual(grade_res["breakdown"]["I"], 20)
        self.assertEqual(grade_res["breakdown"]["O"], 40)

    def test_empty_template_fails_bounds(self):
        solve_fn = load_solve(PROBLEM_DIR / "template.py")
        inst = private_ie_des01(1)
        public_inst = {k: v for k, v in inst.items() if k != "optimal_value"}
        res = solve_fn(public_inst)
        meta = {"pass_score": 90}
        grade_res = grade_ie_des01(res, inst, meta)
        # Empty template has 0 throughput, completions, wait, etc., fails oracle matching
        self.assertLess(grade_res["score"], 90)
        self.assertFalse(grade_res["passed"])

    def test_l1_runner_integration(self):
        solve_fn = load_solve(PROBLEM_DIR / "reference_simulation.py")
        meta = {
            "id": "IE-DES-01",
            "grader": "ie_des01",
            "n_instances_l1": 2,
            "seed_base": 20261028,
            "pass_score": 90
        }
        rep = run_l1(solve_fn, meta, "IE-DES-01")
        self.assertEqual(rep["score"], 100)
        self.assertTrue(rep["passed"])
        self.assertEqual(len(rep["instances"]), 2)

    def test_l2_isolated_runner_contract_without_oracle_leak(self):
        recorded_instances = []
        solve_fn = load_solve(PROBLEM_DIR / "reference_simulation.py")

        def fake_run_isolated(path, instance, timeout):
            self.assertNotIn("optimal_value", instance)
            recorded_instances.append(instance)
            return solve_fn(instance), None

        class OK:
            returncode = 0

        with patch("judge.runner_l2_isolated.subprocess.run", return_value=OK()), \
             patch("judge.runner_l2_isolated._run_isolated", side_effect=fake_run_isolated):
            res = grade_file(PROBLEM_DIR / "reference_simulation.py", "IE-DES-01", {
                "n_instances": 2,
                "pass_score": 90,
                "instance_seed": "test-ie-seed"
            })

        self.assertTrue(res["ok"])
        self.assertEqual(res["score"], 100)
        self.assertTrue(res["passed"])
        self.assertEqual(len(recorded_instances), 2)
        for inst in recorded_instances:
            self.assertNotIn("optimal_value", inst)


if __name__ == "__main__":
    unittest.main()
