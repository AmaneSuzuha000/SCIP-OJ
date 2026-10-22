"""Static CI gates for RLS-bypassing PostgreSQL grants and RPC scopes."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DBPrivilegeTests(unittest.TestCase):
    def test_emergency_grant_revoke(self):
        content = (ROOT / "supabase/migrations/011_revoke_excess_public_privileges.sql").read_text()
        self.assertIn("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon", content)
        self.assertIn("REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES", content)
        self.assertIn("REVOKE EXECUTE ON FUNCTION public.handle_new_user()", content)
        self.assertIn("REVOKE EXECUTE ON FUNCTION public.is_teacher_of(uuid) FROM PUBLIC, anon", content)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.is_teacher_of(uuid) TO authenticated", content)

    def test_sql_atomic_invitation_auth_and_lock_order(self):
        text = (ROOT / "supabase/migrations/012_atomic_revocable_course_invites.sql").read_text()
        self.assertIn("auth.uid()", text)
        self.assertIn("UPDATE public.course_invites ci SET revoked_at", text)
        self.assertIn("FOR UPDATE;", text)
        self.assertIn("INSERT INTO public.enrollments", text)
        self.assertIn("REVOKE UPDATE (invite_code) ON public.courses FROM authenticated", text)
        self.assertIn("uq_course_invites_case_insensitive_code", text)

    def test_enrollment_edge_no_service_role_mutations(self):
        code = (ROOT / "supabase/functions/join-course/index.ts").read_text()
        self.assertIn('const anonKey = Deno.env.get("SUPABASE_ANON_KEY")', code)
        self.assertIn('userClient.rpc("join_course_by_code"', code)
        self.assertNotIn('.from("course_invites")', code)
        self.assertNotIn('.from("enrollments")', code)


if __name__ == "__main__":
    unittest.main()
