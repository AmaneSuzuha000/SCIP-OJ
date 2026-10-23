"""Formal grading seed contract: reproducible, private and fail-closed in production."""
import os
import unittest
from unittest.mock import patch

from judge.private_instances import private_assignment, private_knapsack
from judge.runner_l2_isolated import (
    PRIVATE_SEED_PROTOCOL,
    _derive_private_seed,
    grade_file,
)


class TestReplayablePrivateInstances(unittest.TestCase):
    def test_same_submission_reproduces_same_instances(self):
        seed1 = _derive_private_seed("P001", "sub-123", 0, "private-key")
        seed2 = _derive_private_seed("P001", "sub-123", 0, "private-key")
        self.assertEqual(seed1, seed2)
        self.assertEqual(private_knapsack(seed1), private_knapsack(seed2))

    def test_different_submission_index_key_and_problem(self):
        seed = _derive_private_seed("P001", "sub-123", 0, "key-a")
        for args in [
            ("P001", "sub-456", 0, "key-a"),
            ("P001", "sub-123", 1, "key-a"),
            ("P001", "sub-123", 0, "key-b"),
            ("P002", "sub-123", 0, "key-a"),
        ]:
            self.assertNotEqual(seed, _derive_private_seed(*args))
        self.assertNotEqual(private_assignment(seed), private_assignment(
            _derive_private_seed("P002", "sub-123", 0, "key-a")))

    def test_missing_context_rejected(self):
        for args in [
            ("", "sub-123", 0, "key"),
            ("P001", "", 0, "key"),
            ("P001", "sub-123", -1, "key"),
            ("P001", "sub-123", 0, ""),
        ]:
            with self.assertRaises(ValueError):
                _derive_private_seed(*args)

    def test_production_fails_closed_without_key(self):
        env = {
            "SCIP_OJ_SUBMISSION_ID": "submission-1",
            "SCIP_OJ_PRIVATE_TEST_KEY": "",
            "SCIP_OJ_REQUIRE_REPLAYABLE_TESTS": "1",
        }
        with patch.dict(os.environ, env):
            report = grade_file("problems/P001_knapsack/template.py", "P001")
        self.assertEqual(report["status"], "system_error")
        self.assertIsNone(report["score"])

    def test_protocol_is_explicitly_versioned(self):
        self.assertEqual(PRIVATE_SEED_PROTOCOL, "hmac_sha256_submission_v1")


if __name__ == "__main__":
    unittest.main()
