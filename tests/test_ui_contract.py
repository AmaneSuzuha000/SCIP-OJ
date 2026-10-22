"""Static shell integration checks that catch broken IDs/asset links."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

SITE = Path(__file__).resolve().parents[1] / "site"


class Auditor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.styles, self.main_count = [], [], 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "main":
            self.main_count += 1
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.styles.append(attrs.get("href"))


class UIContractTests(unittest.TestCase):
    def test_pages_preserve_all_critical_view_identifiers(self):
        required = {
            "index.html": ["problem-list", "workspace", "code", "readme",
                           "btn-grade", "btn-submit-formal", "report", "draft-state",
                           "problem-search-input", "my-submissions-container",
                           "filter-difficulty", "filter-progress", "tab-description",
                           "tab-history", "editor-font-size", "exam-notice",
                           "btn-prev-problem", "btn-next-problem", "problem-position"],
            "teacher.html": ["teacher-panel", "course-select", "roster-area",
                             "tab-gradebook", "tab-roster", "tab-assignments",
                             "metric-students", "metric-graded", "metric-passrate",
                             "assign-integrity-policy"],
            "doc.html": ["md"],
        }
        for filename, ids in required.items():
            with self.subTest(filename=filename):
                auditor = Auditor()
                auditor.feed((SITE / filename).read_text(encoding="utf8"))
                self.assertEqual(auditor.main_count, 1)
                self.assertEqual(len(auditor.ids), len(set(auditor.ids)))
                self.assertTrue(set(ids).issubset(auditor.ids))
                self.assertIn("style.css", auditor.styles)
                self.assertIn("ui-refresh.css", auditor.styles)
                if filename == "index.html":
                    self.assertIn("leetcode.css", auditor.styles)

    def test_draft_is_local_and_server_submission_remains(self):
        script = (SITE / "js/app.js").read_text(encoding="utf8")
        self.assertIn('localStorage.setItem("scipoj:draft:"', script)
        self.assertIn('localStorage.removeItem("scipoj:draft:"', script)
        self.assertIn("submitAssignment", script)

    def test_immersive_workbench_hides_landing_and_guards_exam_draft(self):
        js = (SITE / "js/app.js").read_text()
        css = (SITE / "leetcode.css").read_text()
        self.assertIn('document.body.classList.add("workbench-active")', js)
        self.assertIn('document.body.classList.remove("workbench-active")', js)
        self.assertIn("confirmLeaveIfExamDraft", js)
        self.assertIn("workbench-active .hero-panel", css)
        self.assertIn("workbench-active .overview-strip", css)

    def test_sql_regrade_view_orders_by_grading_time_first(self):
        text = (SITE.parent / "supabase/migrations/008_latest_grading_per_submission.sql").read_text()
        self.assertIn("SELECT DISTINCT ON (g.submission_id)", text)
        self.assertIn("ORDER BY g.submission_id, g.created_at DESC, g.id DESC", text)
        self.assertIn("JOIN latest_grading_per_submission g", text)


if __name__ == "__main__":
    unittest.main()
