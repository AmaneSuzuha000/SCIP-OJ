# SCIP-OJ V4 security boundaries: PostgreSQL grants and course invitations

Date: 2026-10-23. Scope: public Data API + enrollment/invite rotation.

## Confirmed production exposure and fix

The original database gave `anon` and `authenticated` `TRUNCATE` on 9 RLS-protected tables. PostgreSQL RLS does **not** guard TRUNCATE: this was a real database privilege defect, not a browser preference. Migration 011 has been applied and queried on the connected production project. Checked after deployment: anonymous TRUNCATE=0, authenticated TRUNCATE=0, anonymous table SELECT=0, missing `service_role` SELECT=0. Trigger-only SECURITY DEFINER functions are no longer directly executable by anonymous or logged-in REST clients.

The application still intentionally exposes authenticated, authorization-checked RPCs for instructor gradebook and course leaderboard; some Supabase adviser warnings for these functions are expected and require reviewing their guards rather than blindly revoking access.

## Atomic invitation joins / rotation

Migration 012 is applied online. `join_course_by_code` now:
1. Gets the authenticated identity from `auth.uid()`, never a client-submitted user id.
2. Locks the course row **before** re-reading and locking the invite row. This coordinates with rotation.
3. Checks revocation, expiration, seat quota, and existing enrollment in one PostgreSQL transaction.
4. Inserts the enrollment and increments invite usage only when the insert is new.
5. Uses current `courses.invite_code` solely as a legacy fallback, never the public course code.

`rotate_course_invite_code` checks course-teacher or platform-admin authorization, then revokes previous **student** invitation rows, updates the course's current invite code, and inserts a cryptographically unpredictable replacement in one transaction. Separate TA invitations are not implicitly rotated and need explicit staff revocation.

Direct authenticated Data API writes to `course_invites`, `courses.invite_code`, and unrelated privileged operations are revoked. Note that migration 006 previously granted column-level UPDATE on `courses.invite_code`; migration 012 explicitly revokes this *column* grant as well as the table grant.

The `join-course` Edge Function uses the verified caller JWT to invoke the RPC; it cannot directly write enrollment/usage counters with its service-role client. Missing public-key configuration fails closed.

## Inspected validation and remaining Gate

Verified using Supabase SQL metadata after migrations:
- `anon`/`authenticated` TRUNCATE denied;
- authenticated direct `courses.invite_code` UPDATE and `course_invites` INSERT denied;
- `authenticated` has EXECUTE on both invitation RPCs;
- uniqueness index on normalized invite code installed;
- join RPC contains `FOR UPDATE`, rotate RPC contains revocation logic.

Static and code-contract tests also run under GitHub Actions.

**Not yet established**: independent browser login/JWT test for an actual teacher and student, 20-way parallel enrollment at max_use=1, race between rotation and joining, and rollback fault injection. Production has one course and no imported roster as of this audit; do not mutate user enrollment in verification scripts. These remain formal live E2E gates.

**Known identity weakness**: a user-entered student number is not independent identity proof. `roster_pending.matched` may be populated from self-declared student numbers, so it is a match, **not** teacher-verified identity. Add teacher-verified GitHub identity-to-roster approval before claiming invigilated assessments.

Supabase references:
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/database-linter
