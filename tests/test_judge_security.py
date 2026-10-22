"""Regression tests for score validity and solver/oracle separation."""
import itertools
import math
import unittest

from judge.common import (
    check_format,
    grade_assignment,
    grade_knapsack,
    score_objective,
)
from judge.runner_l1 import run_l1


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


if __name__ == "__main__":
    unittest.main()
