from source_files import component_source
"""Static guardrails against split client-side invite transactions."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]

class CourseInviteTests(unittest.TestCase):
    def test_db_invites_are_transactional_and_revocable(self):
        sql = (ROOT/"supabase/migrations/012_atomic_revocable_course_invites.sql").read_text()
        for needle in ("FOR UPDATE","revoked_at","uses_count=uses_count+1",
                       "public.rotate_course_invite_code","auth.uid()",
                       "REVOKE UPDATE ON public.courses FROM authenticated",
                       "REVOKE INSERT,UPDATE,DELETE ON public.course_invites FROM authenticated"):
            self.assertIn(needle,sql)
    def test_join_is_user_authenticated_rpc_not_service_role_write(self):
        code = (ROOT/"supabase/functions/join-course/index.ts").read_text()
        self.assertIn('userClient.rpc("join_course_by_code"',code)
        self.assertIn('auth.jwt',code)
        self.assertNotIn('.from("enrollments").insert(',code)
    def test_frontend_rotation_is_atomic_rpc(self):
        js=component_source('platform')
        block=js.split("async function rotateCourseInviteCode(",1)[1].split("// ── UI 渲染",1)[0]
        self.assertIn('.rpc("rotate_course_invite_code"',block)
        self.assertNotIn('.from("course_invites")',block)
        self.assertNotIn('.from("courses")',block)
        self.assertIn("REVOKE UPDATE (invite_code) ON public.courses FROM authenticated", (ROOT/"supabase/migrations/012_atomic_revocable_course_invites.sql").read_text())

if __name__ == "__main__":
    unittest.main()
