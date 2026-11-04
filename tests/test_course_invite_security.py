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
        # The subject moved from site/src/platform to the React teacher API when
        # the shell was rewritten; the property is the same one, so the check
        # follows the code rather than being dropped with the old frontend.
        ts = (ROOT / "web/src/features/teacher/api.ts").read_text()
        block = ts.split("export async function rotateInviteCode(", 1)[1].split("/**", 1)[0]
        self.assertIn(".rpc('rotate_course_invite_code'", block)
        # A direct table write would bypass the row lock that serialises joins
        # against a rotation, which is the whole point of the RPC.
        self.assertNotIn(".from('course_invites')", block)
        self.assertNotIn("update({ invite_code", block)
        self.assertIn("REVOKE UPDATE (invite_code) ON public.courses FROM authenticated", (ROOT/"supabase/migrations/012_atomic_revocable_course_invites.sql").read_text())

if __name__ == "__main__":
    unittest.main()
