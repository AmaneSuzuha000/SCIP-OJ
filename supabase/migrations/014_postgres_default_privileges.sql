-- 014: Prevent new tables/functions/sequences from reopening V4 database grants.
-- Applies only to objects subsequently CREATED by 'postgres' in schema public.
-- Existing objects retain their independently reviewed grants.
-- Supabase connection has no membership in supabase_admin; that owner's
-- defaults require separate privileged administration outside this migration.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;

-- PostgreSQL's BUILT-IN function default is EXECUTE for PUBLIC. Per-schema
-- REVOKEs cannot cancel a global default, so remove it at the owner level.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- This does NOT change any grants for existing functions/tables, nor the
-- default privileges of 'supabase_admin'. Future application migrations must
-- intentionally GRANT only the required authenticated access.
