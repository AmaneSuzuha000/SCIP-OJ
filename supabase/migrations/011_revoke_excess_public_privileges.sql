-- 011: Emergency privilege fix for exposed public tables and RPC helpers.
-- WARNING: PostgreSQL RLS does NOT protect TRUNCATE, REFERENCES or TRIGGER.
-- Browser clients only need authenticated, per-row RLS-mediated operations.
-- Anonymous browser sessions need NO direct access to OJ application tables.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- PUBLIC is inherited by every role, so both direct and PUBLIC grants must go.
-- Authenticated SELECT/INSERT/UPDATE/DELETE permissions and RLS stay intact.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_profile_student_no_sync()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_role_escalation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_submission_attempt_no()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_submission_public_code()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_submission_immutable_update()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_profiles_updated_at()
  FROM PUBLIC, anon, authenticated;

-- This SECURITY DEFINER helper is called inside authenticated RLS policies,
-- but need not be callable by anonymous REST clients.
REVOKE EXECUTE ON FUNCTION public.is_teacher_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_teacher_of(uuid) TO authenticated, service_role;

-- Preserve authenticated, purpose-built API functions (get_teacher_gradebook,
-- get_course_leaderboard, get_course_invite_code, join_course_by_code).

ALTER FUNCTION public.generate_submission_public_code()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prevent_submission_immutable_update()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_profiles_updated_at()
  SET search_path = pg_catalog, public, pg_temp;

NOTIFY pgrst, 'reload schema';
