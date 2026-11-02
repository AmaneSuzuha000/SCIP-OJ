"""The scoring contract must be inspectable and drift-detectable.

A grader_ref already pins meta.json transitively, so the fingerprint is not what
makes a regrade reproducible. It is what makes the applied rules *visible*, and
what turns an unnoticed contract edit into a visible diff.
"""
import json
import unittest
from pathlib import Path

from judge.common import GRADER_VERSION
from judge.contract import contract_fingerprint, contract_view
from judge.errors import JudgeConfigError
from judge.runner_l1 import run_l1

PROBLEMS = Path(__file__).resolve().parent.parent / "problems"


def load_meta(dirname):
    return json.loads((PROBLEMS / dirname / "meta.json").read_text(encoding="utf-8"))


class ContractFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.meta = load_meta("P002_assignment")

    def test_fingerprint_is_stable_regardless_of_key_order(self):
        shuffled = dict(reversed(list(self.meta.items())))
        self.assertEqual(
            contract_fingerprint("assignment", self.meta),
            contract_fingerprint("assignment", shuffled),
        )

    def test_fingerprint_is_a_sha256_hex_digest(self):
        value = contract_fingerprint("assignment", self.meta)
        self.assertEqual(len(value), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in value))

    def test_a_weights_change_alters_the_fingerprint(self):
        baseline = contract_fingerprint("assignment", self.meta)
        tweaked = {**self.meta, "weights": {**self.meta["weights"], "O": 50, "C": 30}}
        self.assertNotEqual(baseline, contract_fingerprint("assignment", tweaked))

    def test_an_epsilon_change_alters_the_fingerprint(self):
        baseline = contract_fingerprint("assignment", self.meta)
        tweaked = {**self.meta, "eps_obj": 1e-2}
        self.assertNotEqual(baseline, contract_fingerprint("assignment", tweaked))

    def test_a_pass_score_change_alters_the_fingerprint(self):
        baseline = contract_fingerprint("assignment", self.meta)
        self.assertNotEqual(
            baseline, contract_fingerprint("assignment", {**self.meta, "pass_score": 80}))

    def test_a_cosmetic_change_does_not_alter_the_fingerprint(self):
        # An unrelated field must not look like a scoring change.
        baseline = contract_fingerprint("assignment", self.meta)
        self.assertEqual(
            baseline, contract_fingerprint("assignment", {**self.meta, "id": "renamed"}))

    def test_grader_version_is_part_of_the_contract(self):
        view = contract_view("assignment", self.meta)
        self.assertEqual(view["grader_version"], GRADER_VERSION["assignment"])
        self.assertEqual(view["sense"], "minimize")

    def test_every_shipped_problem_has_a_fingerprint(self):
        seen = set()
        for meta_path in sorted(PROBLEMS.glob("*/meta.json")):
            meta = load_meta(meta_path.parent.name)
            with self.subTest(problem=meta.get("id")):
                value = contract_fingerprint(meta["grader"], meta)
                self.assertEqual(len(value), 64)
                self.assertNotIn(value, seen, "不同题目不应出现指纹碰撞")
                seen.add(value)
        self.assertEqual(len(seen), 3)

    def test_fingerprint_requires_a_valid_direction(self):
        with self.assertRaises(JudgeConfigError):
            contract_fingerprint("assignment", {**self.meta, "sense": "maximize"})

    def test_l1_report_carries_the_contract(self):
        import itertools

        def solve(instance):
            best = (-1, None)
            for bits in itertools.product((0, 1), repeat=instance["n"]):
                if sum(w * x for w, x in zip(instance["weights"], bits)) <= instance["capacity"]:
                    value = sum(v * x for v, x in zip(instance["values"], bits))
                    if value > best[0]:
                        best = (value, bits)
            return {"objective": best[0], "solution": list(best[1])}

        meta = {"grader": "knapsack", "sense": "maximize", "n_instances_l1": 1, "seed_base": 7}
        report = run_l1(solve, meta)
        self.assertEqual(report["score"], 100)
        self.assertEqual(report["contract_fingerprint"], contract_fingerprint("knapsack", meta))
        self.assertEqual(report["contract"]["sense"], "maximize")
        self.assertEqual(report["contract"]["grader_version"], GRADER_VERSION["knapsack"])


if __name__ == "__main__":
    unittest.main()
