"""Supervised submission requires teacher-verified, not self-claimed, identity."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]

class VerifiedRosterTests(unittest.TestCase):
    def test_migration_verification_has_identity_invalidation(self):
        sql=(ROOT/"supabase/migrations/013_teacher_verified_exam_roster.sql").read_text()
        for expected in ["CREATE TABLE IF NOT EXISTS public.roster_verifications",
                         "invalidate_roster_verification","public.confirm_student_identity",
                         "public.is_verified_course_student","verified_by",
                         "REVOKE ALL ON FUNCTION public.is_verified_course_student"]:
            self.assertIn(expected,sql)
    def test_exam_gate_before_submission_write(self):
        edge=(ROOT/"supabase/functions/submit-assignment/index.ts").read_text()
        self.assertIn('"is_verified_course_student"',edge)
        self.assertIn('"IDENTITY_VERIFICATION_REQUIRED"',edge)
        self.assertLess(edge.index('"is_verified_course_student"'),edge.index('.from("submissions")'))
    def test_teacher_button_not_auto_verified(self):
        teacher=(ROOT/"site/js/teacher.js").read_text()
        self.assertIn("学号已匹配（未必已核验）",teacher)
        self.assertIn("confirmRosterIdentity",teacher)
        self.assertIn("教师已核验",teacher)

if __name__ == "__main__":
    unittest.main()
