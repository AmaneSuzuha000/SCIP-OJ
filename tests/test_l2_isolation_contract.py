"""Fail-closed, secrets-safe L2 runner contract checks (no Docker required)."""
from pathlib import Path
import unittest
from unittest.mock import patch
from judge.runner_l2_isolated import grade_file


class SandboxContractTests(unittest.TestCase):
    def test_source_never_imports_student_into_host_process(self):
        source = (Path(__file__).resolve().parents[1] / "judge/runner_l2_isolated.py").read_text()
        self.assertNotIn("load_solve(", source)
        for guard in ['"--network", "none"', '"--read-only"', '"--cap-drop", "ALL"',
                      '"--memory", "768m"', '"--pids-limit", "64"']:
            self.assertIn(guard, source)
        self.assertIn("secrets.randbits(64)", source)
        self.assertNotIn("meta.get(\"seed_base\"", source)

    def test_private_solver_input_has_no_oracle(self):
        filename = Path("problems/P001_knapsack/template.py")
        recorded = []
        def fake_execute(path, instance, timeout):
            self.assertNotIn("optimal_value", instance)
            recorded.append(instance)
            # valid all-zero knapsack solution; no objective points
            return {"objective": 0, "solution": [0] * instance["n"]}, None
        class OK: returncode = 0
        with patch("judge.runner_l2_isolated.subprocess.run", return_value=OK()), \
             patch("judge.runner_l2_isolated._run_isolated", side_effect=fake_execute):
            result = grade_file(filename, "P001", {"n_instances": 2, "pass_score": 90})
        self.assertTrue(result["ok"])
        self.assertEqual(len(recorded), 2)
        self.assertEqual(len(result["instances"]), 2)
        self.assertEqual(result["test_set"], "server_private_v2")
        self.assertNotIn("seed", str(result))

    def test_callback_and_workflow_bind_specific_grading_and_runner(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/grade-submission.yml").read_text()
        callback = (root / "supabase/functions/grade-callback/index.ts").read_text()
        github = (root / "supabase/functions/_shared/github.ts").read_text()
        self.assertIn("grading_id: gradingId", github)
        self.assertIn("GRADING_ID: ${{ inputs.grading_id }}", workflow)
        self.assertIn('"grading_id": os.environ["GRADING_ID"]', workflow)
        self.assertIn('.eq("id", grading_id)', callback)
        self.assertIn("pending.runner_ref !== runner_ref", callback)
        self.assertNotIn('.order("created_at", { ascending: false })', callback)

    def test_missing_docker_marks_system_error_not_zero_score(self):
        with patch("judge.runner_l2_isolated.subprocess.run", side_effect=FileNotFoundError()):
            report = grade_file(Path("problems/P002_assignment/template.py"), "P002")
        self.assertEqual(report["status"], "system_error")
        self.assertIsNone(report["score"])


if __name__ == "__main__":
    unittest.main()
