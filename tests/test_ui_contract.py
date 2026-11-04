"""Contracts that still point at code in the tree.

This file used to audit the vanilla shell under site/ -- index.html's element
ids, teacher.html's tabs, doc.html's markdown container. That frontend was
replaced by the React app, and the pages are gone, so those assertions were
protecting files nobody ships. What is left are the checks whose subject is
still real: the SQL that decides which grading counts, and the evidence the
grading image records.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UIContractTests(unittest.TestCase):
    def test_sql_regrade_view_orders_by_grading_time_first(self):
        text = (ROOT / "supabase/migrations/008_latest_grading_per_submission.sql").read_text()
        self.assertIn("SELECT DISTINCT ON (g.submission_id)", text)
        self.assertIn("ORDER BY g.submission_id, g.created_at DESC, g.id DESC", text)
        self.assertIn("JOIN latest_grading_per_submission g", text)

    def test_grading_image_digest_evidence_contract(self):
        grade_script = (ROOT / "scripts/run_formal_grade.py").read_text()
        self.assertIn("image_digest", grade_script)
        workflow = (ROOT / ".github/workflows/grade-submission.yml").read_text()
        self.assertIn("Sandbox image ID", workflow)


if __name__ == "__main__":
    unittest.main()
