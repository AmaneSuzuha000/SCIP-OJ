# SCIP-OJ V6: Default privileges are a separate security boundary

## Why migration 014 exists

V4 revoked dangerous `anon` / `authenticated` table grants on existing tables. A subsequent audit of `pg_default_acl` found both `postgres` and `supabase_admin` owners still had overly broad defaults in `public`, including table `TRUNCATE` and automatic EXECUTE of new functions. A future feature could reopen a high-severity RLS bypass just by creating a table.

Migration 014 restricts **postgres-owned future objects** in public: no implicit anonymous/authenticated table/sequence/function privileges, and no built-in PUBLIC function EXECUTE by default. A migration must explicitly GRANT intended access for every new table/RPC.

## Scope limitation

The project SQL connection is `postgres` and `pg_has_role('postgres','supabase_admin','MEMBER')` is **false**. Consequently this assistant cannot modify `supabase_admin` default ACLs. **Do not claim that second owner's defaults are fixed**; a project administrator with the appropriate role must perform the equivalent REVOKE operations for objects created by `supabase_admin`, or explicitly revoke permissions on each new object.

## Verification
- Check `pg_default_acl` for `postgres` in `public` after migration.
- Confirm all existing teacher/student application functions still have their required explicit grants.
- Confirm `service_role` can still read existing application tables.
- Continue to verify every newly created table with `has_table_privilege('anon',...'TRUNCATE') = false`; inspect any new `SECURITY DEFINER` RPC for exposed privileges.

Supabase reference: https://supabase.com/docs/guides/api/securing-your-api

## Remaining high-stakes gates

Even with grant fixes, do not treat static tests as a full production penetration test. Verify a consenting teacher/student OAuth E2E (roster attestation, one official submission, workflow dispatch, sandbox, signed callback, gradebook display), invalid JWT handling, duplicate/in-flight regrade safety, and realistic concurrent invite-quota tests before assessed examinations.
