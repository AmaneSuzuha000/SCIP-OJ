"""The recorded score baseline must not drift.

This is the CI gate for "a judge change never silently regrades anyone". It runs
the same scoring layer the real runners use over a deterministic corpus and
fails on any score, breakdown, or contract-fingerprint difference.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.parity_report import BASELINE, baseline_document, compare  # noqa: E402


class ParityBaselineTests(unittest.TestCase):
    def test_baseline_file_exists(self):
        self.assertTrue(BASELINE.exists(), "缺少 tests/parity_baseline.json")

    def test_scoring_matches_the_recorded_baseline(self):
        expected = json.loads(BASELINE.read_text(encoding="utf-8"))
        diffs = compare(expected, baseline_document())
        self.assertEqual(diffs, [], "判分结果相对基线发生漂移：\n" + "\n".join(diffs))

    def test_baseline_covers_every_problem_and_score_tier(self):
        expected = json.loads(BASELINE.read_text(encoding="utf-8"))
        cases = expected["cases"]
        self.assertGreaterEqual(len(cases), 40)
        problems = {c["id"].split(":")[0] for c in cases}
        self.assertEqual(problems, {"P001", "P002"})
        scores = {c["observed"].get("score") for c in cases}
        # A useful baseline spans satisfaction and failure, not just one tier.
        self.assertIn(100, scores)
        self.assertTrue(any(isinstance(s, int) and s < 90 for s in scores))


if __name__ == "__main__":
    unittest.main()
