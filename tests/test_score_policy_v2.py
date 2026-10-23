"""Pre-registered grading-contract tests; v2 is intentionally not live."""
from __future__ import annotations

import copy
import unittest

from judge.common import average_scores
from judge.score_policy_v2 import (
    PolicyError, normalized_quality, target_referenced_quality, score_subtasks, SCHEMA,
)


def policy(mode="exact", pass_score=90):
    contract = {
        "schemaVersion": SCHEMA,
        "mode": mode,
        "passScore": pass_score,
        "groups": [
            {"id": "basic", "weight": 20, "cases": ["b1", "b2", "b3"]},
            {"id": "boundary", "weight": 30, "cases": ["e1", "e2", "e3", "e4"]},
            {"id": "stress", "weight": 50, "cases": ["s1", "s2", "s3", "s4", "s5"]},
        ],
    }
    if mode == "approximate":
        contract["referenceKind"] = "certified_optimum"
    return contract


def all_cases(pol, quality=None):
    value = {"verdict": "AC"} if quality is None else {"verdict": "AC", "quality": quality}
    return {
        case_id: value.copy()
        for group in pol["groups"]
        for case_id in group["cases"]
    }


class ScoringContractV2Tests(unittest.TestCase):
    def test_full_correctness_100_and_passed(self):
        pol = policy()
        result = score_subtasks(pol, all_cases(pol))
        self.assertEqual(result["score"], 100)
        self.assertTrue(result["passed"])
        self.assertEqual([g["points"] for g in result["groups"]], [20, 30, 50])

    def test_ioi_like_subtask_one_failure_loses_group(self):
        pol = policy()
        results = all_cases(pol)
        results["s3"] = {"verdict": "INFEASIBLE"}
        result = score_subtasks(pol, results)
        self.assertEqual(result["score"], 50)
        self.assertFalse(result["passed"])
        self.assertFalse(result["allCasesAccepted"])

    def test_single_hard_constraint_failure_cannot_be_averaged_away(self):
        # Previous published L2 format/feasibility/integrality points could yield
        # 55 for an all-zero feasible but poor answer. 19 good + 1 bad = 98.
        legacy = [{"score": 100, "breakdown": {"F": 10}} for _ in range(19)]
        legacy += [{"score": 55, "breakdown": {"F": 10}}]
        self.assertTrue(average_scores(legacy, 90)["passed"])
        custom = {
            "schemaVersion": SCHEMA, "mode": "exact", "passScore": 90,
            "groups": [
                {"id": "narrow", "weight": 5, "cases": ["bad"]},
                {"id": "rest", "weight": 95, "cases": ["good"]},
            ],
        }
        grade = score_subtasks(custom, {
            "bad": {"verdict": "INFEASIBLE"},
            "good": {"verdict": "AC"},
        })
        self.assertEqual(grade["score"], 95)
        self.assertFalse(grade["passed"], "Even 95/100 cannot waive a hard-constraint failure")

    def test_format_or_timeout_are_no_partial_bonus(self):
        pol = policy()
        for outcome in ("FORMAT_ERROR", "NON_INTEGRAL", "TLE", "RE", "OBJECTIVE_MISMATCH"):
            with self.subTest(outcome=outcome):
                cases = all_cases(pol)
                cases["b1"] = {"verdict": outcome}
                grade = score_subtasks(pol, cases)
                self.assertEqual(grade["score"], 80)
                self.assertFalse(grade["passed"])

    def test_missing_or_extra_runner_cases_cannot_get_grade(self):
        pol = policy()
        for mutator in (
            lambda d: d.pop("e2"),
            lambda d: d.update({"unexpected": {"verdict": "AC"}}),
        ):
            with self.subTest(mutator=mutator):
                cases = all_cases(pol)
                mutator(cases)
                report = score_subtasks(pol, cases)
                self.assertEqual(report["status"], "system_error")
                self.assertIsNone(report["score"])

    def test_infrastructure_error_does_not_penalize_student(self):
        pol = policy()
        cases = all_cases(pol)
        cases["b2"] = {"verdict": "SYSTEM_ERROR"}
        report = score_subtasks(pol, cases)
        self.assertEqual(report["status"], "system_error")
        self.assertIsNone(report["score"])
        self.assertFalse(report["passed"])

    def test_approximate_only_scores_independently_validated_quality(self):
        pol = policy("approximate")
        cases = all_cases(pol, 1)
        cases["e1"]["quality"] = 0.5
        cases["s1"]["quality"] = 0.8
        report = score_subtasks(pol, cases)
        self.assertEqual(report["score"], 75)  # 20+15+40
        self.assertTrue(report["allCasesAccepted"])
        self.assertFalse(report["passed"])
        for bad_quality in (-0.1, 1.1, float("nan"), float("inf")):
            cases = all_cases(pol, 1)
            cases["s1"]["quality"] = bad_quality
            with self.assertRaises(PolicyError):
                score_subtasks(pol, cases)

    def test_valid_zero_quality_has_zero_group_points_not_55(self):
        pol = policy("approximate")
        result = score_subtasks(pol, all_cases(pol, 0))
        self.assertEqual(result["score"], 0)
        self.assertFalse(result["passed"])
        self.assertTrue(result["allCasesAccepted"])

    def test_exact_does_not_trust_claimed_quality(self):
        pol = policy("exact")
        cases = all_cases(pol)
        cases["e1"] = {"verdict": "WA", "quality": 1}
        report = score_subtasks(pol, cases)
        self.assertEqual(report["score"], 70)
        self.assertFalse(report["passed"])

    def test_quality_is_baseline_normalized_not_misnamed_mip_gap(self):
        self.assertEqual(normalized_quality(80, 100, 60, "minimize"), 0.5)
        self.assertEqual(normalized_quality(70, 50, 90, "maximize"), 0.5)
        self.assertEqual(normalized_quality(500, 100, 60, "minimize"), 0)
        self.assertEqual(normalized_quality(60, 100, 60, "minimize"), 1)
        with self.assertRaises(PolicyError):
            normalized_quality(90, 100, 100, "minimize")
        with self.assertRaises(PolicyError):
            normalized_quality(59, 100, 60, "minimize")
        with self.assertRaises(PolicyError):
            normalized_quality(70, 50, 90, "maximize" + "oops")

    def test_unproven_benchmark_target_is_not_misrepresented_as_optimum(self):
        # For a hard scheduling problem with no proven OPT, a frozen target
        # 60 (min) is a full-score yardstick, not an impossible-to-beat oracle.
        self.assertEqual(target_referenced_quality(80, 100, 60, "minimize"), 0.5)
        self.assertEqual(target_referenced_quality(55, 100, 60, "minimize"), 1)
        self.assertEqual(target_referenced_quality(100, 100, 60, "minimize"), 0)
        self.assertEqual(target_referenced_quality(70, 50, 90, "maximize"), 0.5)
        self.assertEqual(target_referenced_quality(95, 50, 90, "maximize"), 1)
        with self.assertRaises(PolicyError):
            target_referenced_quality(90, 100, 100, "minimize")
        with self.assertRaises(PolicyError):
            target_referenced_quality(float("nan"), 100, 60, "minimize")

    def test_policy_must_be_frozen_and_complete(self):
        pol = policy()
        invalid_policies = []
        x = copy.deepcopy(pol)
        x["groups"][1]["weight"] = 31
        invalid_policies.append(x)
        x = copy.deepcopy(pol)
        x["groups"][1]["cases"] = ["b1"]
        invalid_policies.append(x)
        x = copy.deepcopy(pol)
        x["passScore"] = "90"
        invalid_policies.append(x)
        x = copy.deepcopy(pol)
        x["schemaVersion"] = "scip-oj-score-policy/1"
        invalid_policies.append(x)
        for bad in invalid_policies:
            with self.subTest(bad=bad):
                with self.assertRaises(PolicyError):
                    score_subtasks(bad, all_cases(pol))

    def test_approximate_reference_provenance_is_mandatory(self):
        pol = policy("approximate")
        data = all_cases(pol, 1)
        for bad_kind in (None, "", "best_known", "claimed_optimal"):
            p = copy.deepcopy(pol)
            if bad_kind is None:
                p.pop("referenceKind")
            else:
                p["referenceKind"] = bad_kind
            with self.subTest(reference=bad_kind):
                with self.assertRaises(PolicyError):
                    score_subtasks(p, data)
        p = copy.deepcopy(pol)
        p["referenceKind"] = "frozen_target"
        result = score_subtasks(p, data)
        self.assertEqual(result["referenceKind"], "frozen_target")
        self.assertTrue(result["passed"])
        exact = policy()
        exact["referenceKind"] = "frozen_target"
        with self.assertRaises(PolicyError):
            score_subtasks(exact, all_cases(exact))

    def test_round_half_up_once(self):
        pol = {
            "schemaVersion": SCHEMA, "mode": "approximate", "passScore": 90,
            "referenceKind": "frozen_target",
            "groups": [{"id": "all", "weight": 100, "cases": ["x"]}],
        }
        result = score_subtasks(pol, {"x": {"verdict": "AC", "quality": 0.995}})
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["groups"][0]["points"], 99.5)


if __name__ == "__main__":
    unittest.main()
