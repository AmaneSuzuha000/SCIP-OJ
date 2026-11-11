"""Regression tests for score validity and solver/oracle separation."""
import itertools
import math
import unittest

from judge.common import (
    check_format,
    grade_assignment,
    grade_knapsack,
    resolve_sense,
    score_objective,
    validate_meta,
)
from judge.errors import JudgeConfigError
from judge.runner_l1 import run_l1
from judge.runner_l2_isolated import grade_file


class GradingSecurityTests(unittest.TestCase):
    def setUp(self):
        self.k_meta = {"pass_score": 90, "sense": "maximize",
                       "weights": {"F": 10, "C": 35, "I": 10, "O": 45}}
        self.a_meta = {"pass_score": 90, "sense": "minimize",
                       "weights": {"F": 10, "C": 35, "I": 10, "O": 45}}
        self.k = {"weights": [2, 3], "values": [3, 4],
                  "capacity": 3, "optimal_value": 4}
        self.a = {"n": 2, "costs": [[1, 10], [10, 1]], "optimal_value": 2}

    def test_optimal_answers_receive_100(self):
        self.assertEqual(grade_knapsack(
            {"objective": 4, "solution": [0, 1]}, self.k, self.k_meta)["score"], 100)
        self.assertEqual(grade_assignment(
            {"objective": 2, "solution": [[1, 0], [0, 1]]},
            self.a, self.a_meta)["score"], 100)

    def test_non_finite_objectives_are_not_accepted(self):
        for bad in ("nan", math.nan, "Infinity", math.inf, "-Infinity"):
            with self.subTest(bad=bad):
                self.assertFalse(check_format({"objective": bad, "solution": [0]})[0])
                self.assertEqual(grade_knapsack(
                    {"objective": bad, "solution": [1, 0]},
                    self.k, self.k_meta)["score"], 0)
                self.assertEqual(grade_assignment(
                    {"objective": bad, "solution": [[0, 1], [1, 0]]},
                    self.a, self.a_meta)["score"], 0)

    def test_non_finite_solution_is_rejected(self):
        for bad in (math.nan, math.inf, -math.inf):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    grade_knapsack({"objective": 4, "solution": [bad, 1]},
                                   self.k, self.k_meta)
                with self.assertRaises(ValueError):
                    grade_assignment({"objective": 2, "solution": [[bad, 0], [0, 1]]},
                                     self.a, self.a_meta)

    def test_ragged_matrix_is_rejected(self):
        with self.assertRaises(ValueError):
            grade_assignment({"objective": 2, "solution": [[1], [0, 1, 0]]},
                             self.a, self.a_meta)

    def test_objective_gap_rejects_nan(self):
        with self.assertRaises(ValueError):
            score_objective(math.nan, 10)

    def test_unknown_sense_is_rejected_not_treated_as_minimize(self):
        # Falling through to the minimize branch used to hand a full mark to
        # the worst solution of a maximise problem.
        with self.assertRaises(ValueError):
            score_objective(1.0, 10.0, "maximise")

    def test_sense_is_pinned_per_problem_family(self):
        self.assertEqual(resolve_sense("knapsack", {}), "maximize")
        self.assertEqual(resolve_sense("assignment", {}), "minimize")
        self.assertEqual(
            resolve_sense("assignment", {"sense": "minimize"}), "minimize")
        with self.assertRaises(JudgeConfigError):
            resolve_sense("assignment", {"sense": "maximize"})
        with self.assertRaises(JudgeConfigError):
            resolve_sense("telepathy", {})

    def test_flipped_sense_configuration_cannot_reward_the_worst_solution(self):
        # n=3 assignment where the worst permutation is far from optimal.
        costs = [[1, 9, 9], [9, 1, 9], [9, 9, 1]]
        instance = {"n": 3, "costs": costs, "optimal_value": 3.0}
        optimal = {"objective": 3, "solution": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
        good_meta = {"pass_score": 90, "sense": "minimize", "weights": self.a_meta["weights"]}
        self.assertEqual(grade_assignment(optimal, instance, good_meta)["score"], 100)
        bad_meta = {**good_meta, "sense": "maximize"}
        with self.assertRaises(JudgeConfigError):
            grade_assignment(optimal, instance, bad_meta)

    def test_knapsack_solver_receives_no_oracle_and_cannot_mutate_judge(self):
        def solve(inst):
            self.assertNotIn("optimal_value", inst)
            best = (-1, None)
            for bits in itertools.product((0, 1), repeat=inst["n"]):
                if sum(w * x for w, x in zip(inst["weights"], bits)) <= inst["capacity"]:
                    value = sum(v * x for v, x in zip(inst["values"], bits))
                    if value > best[0]:
                        best = (value, bits)
            inst["weights"][:] = [0] * inst["n"]
            inst["values"][:] = [0] * inst["n"]
            return {"objective": best[0], "solution": list(best[1])}

        report = run_l1(solve, {"id": "P001", "grader": "knapsack",
                                "n_instances_l1": 1, "seed_base": 20261021,
                                **self.k_meta})
        self.assertEqual(report["score"], 100)

    def test_assignment_solver_receives_no_oracle_and_cannot_mutate_judge(self):
        def solve(inst):
            self.assertNotIn("optimal_value", inst)
            costs = inst["costs"]
            perm = min(itertools.permutations(range(inst["n"])),
                       key=lambda p: sum(costs[i][j] for i, j in enumerate(p)))
            objective = sum(costs[i][j] for i, j in enumerate(perm))
            matrix = [[int(j == perm[i]) for j in range(inst["n"])]
                      for i in range(inst["n"])]
            costs[0][:] = [999] * inst["n"]
            return {"objective": objective, "solution": matrix}

        report = run_l1(solve, {"id": "P002", "grader": "assignment",
                                "n_instances_l1": 1, "seed_base": 20261022,
                                **self.a_meta})
        self.assertEqual(report["score"], 100)


class JudgeConfigErrorTests(unittest.TestCase):
    """A misconfigured problem must surface as system_error, never as a score."""

    def setUp(self):
        self.good = {
            "id": "P900", "grader": "knapsack", "sense": "maximize",
            "pass_score": 90, "n_instances_l1": 1, "seed_base": 1,
            "weights": {"F": 10, "C": 35, "I": 10, "O": 45},
        }

    def test_every_shipped_problem_satisfies_its_own_contract(self):
        # Guards against the validator itself drifting from the real problems.
        from pathlib import Path
        import json
        root = Path(__file__).resolve().parent.parent / "problems"
        seen = 0
        for meta_path in sorted(root.glob("*/meta.json")):
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            with self.subTest(problem=meta.get("id")):
                validate_meta(meta.get("grader"), meta)
            seen += 1
        self.assertEqual(seen, 2)

    def test_weights_must_sum_to_one_hundred(self):
        bad = {**self.good, "weights": {"F": 10, "C": 35, "I": 10, "O": 40}}
        with self.assertRaises(JudgeConfigError):
            validate_meta("knapsack", bad)

    def test_unknown_grader_is_a_configuration_fault(self):
        with self.assertRaises(JudgeConfigError):
            validate_meta("telepathy", self.good)

    def test_instance_count_is_bounded(self):
        for n in (0, -1, 21, "3"):
            with self.subTest(n=n):
                with self.assertRaises(JudgeConfigError):
                    validate_meta("knapsack", {**self.good, "n_instances_l1": n})

    def test_negative_weight_is_rejected(self):
        bad = {**self.good, "weights": {"F": -10, "C": 55, "I": 10, "O": 45}}
        with self.assertRaises(JudgeConfigError):
            validate_meta("knapsack", bad)

    def test_l1_reports_system_error_and_never_runs_the_submission(self):
        called = []

        def solve(instance):
            called.append(instance)
            return {"objective": 0, "solution": []}

        for bad in (
            {**self.good, "sense": "minimize"},                      # flipped
            {**self.good, "weights": {"F": 1, "C": 1, "I": 1, "O": 1}},  # bad sum
            {**self.good, "n_instances_l1": 0},                      # bad count
        ):
            with self.subTest(bad=bad):
                report = run_l1(solve, bad)
                self.assertFalse(report["ok"])
                self.assertEqual(report["status"], "system_error")
                self.assertIsNone(report["score"])
                self.assertFalse(report["passed"])
        self.assertEqual(called, [], "配置错误时不应运行学生代码")

    def test_l2_reports_system_error_for_an_out_of_range_assignment_override(self):
        # Runs before the Docker image check, so it needs no container.
        report = grade_file(
            __file__, problem_id="P001", assignment_meta={"n_instances": 0}
        )
        self.assertFalse(report["ok"])
        self.assertEqual(report["status"], "system_error")
        self.assertIsNone(report["score"])

    def test_l2_unknown_problem_is_a_system_error(self):
        report = grade_file(__file__, problem_id="P-not-a-real-problem")
        self.assertEqual(report["status"], "system_error")
        self.assertIsNone(report["score"])

    def test_l1_still_scores_a_correct_submission(self):
        def solve(instance):
            best = (-1, None)
            for bits in itertools.product((0, 1), repeat=instance["n"]):
                if sum(w * x for w, x in zip(instance["weights"], bits)) <= instance["capacity"]:
                    value = sum(v * x for v, x in zip(instance["values"], bits))
                    if value > best[0]:
                        best = (value, bits)
            return {"objective": best[0], "solution": list(best[1])}

        report = run_l1(solve, self.good)
        self.assertEqual(report["score"], 100)
        self.assertTrue(report["passed"])


if __name__ == "__main__":
    unittest.main()
