-- SCIP-OJ 010: single transactional insert gate for rate limits and attempt numbering.
-- Run as a Supabase migration; no historical submission rows are deleted.
-- Uses one advisory transaction lock per user, so concurrent requests cannot
-- race either the quota or attempt_no calculation.
-- Limits: same assignment >=20s apart, <=12/hour/assignment, <=60/day/user.
-- Teacher-initiated regrades only insert gradings, so these quotas do not
-- block legitimate regrading.

CREATE OR REPLACE FUNCTION public.compute_submission_attempt_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_now timestamptz := clock_timestamp();
    v_cooldown boolean;
    v_hourly integer;
    v_daily integer;
BEGIN
    IF NEW.user_id IS NULL OR NEW.assignment_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23502', MESSAGE = 'Missing user or assignment';
    END IF;

    -- Transaction-scoped lock serializes all submissions from this user.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 641493));

    -- Forbid caller-controlled backdating. The server assigns the real timestamp.
    NEW.created_at := v_now;

    SELECT
      bool_or(s.assignment_id = NEW.assignment_id AND
              s.created_at > v_now - interval '20 seconds'),
      count(*) FILTER (
          WHERE s.assignment_id = NEW.assignment_id
            AND s.created_at > v_now - interval '1 hour'),
      count(*)
    INTO v_cooldown, v_hourly, v_daily
    FROM public.submissions s
    WHERE s.user_id = NEW.user_id
      AND s.created_at > v_now - interval '24 hours';

    IF coalesce(v_cooldown, false) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='SUBMISSION_RATE_LIMIT_COOLDOWN';
    END IF;
    IF v_hourly >= 12 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='SUBMISSION_RATE_LIMIT_HOURLY';
    END IF;
    IF v_daily >= 60 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='SUBMISSION_RATE_LIMIT_DAILY';
    END IF;

    -- MAX()+1 is stable across gaps, unlike COUNT()+1. An admin deleting
    -- the latest submission can still cause number reuse; strict historical
    -- monotonicity would require a separate immutable sequence table.
    SELECT coalesce(max(s.attempt_no),0) + 1
    INTO NEW.attempt_no
    FROM public.submissions s
    WHERE s.user_id = NEW.user_id
      AND s.assignment_id = NEW.assignment_id;

    RETURN NEW;
END;
$$;

-- Existing rows must be checked for duplicates before enabling this on
-- a legacy database. A duplicate is a blocking data-quality issue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_user_assignment_attempt
    ON public.submissions(user_id, assignment_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_submissions_user_created
    ON public.submissions(user_id, created_at DESC);

COMMENT ON FUNCTION public.compute_submission_attempt_no() IS
  'Atomic, per-student submission throttling + unique attempt numbering under transaction-scoped advisory lock.';

-- Do not expose trigger function as a public RPC.
REVOKE ALL ON FUNCTION public.compute_submission_attempt_no() FROM PUBLIC, anon, authenticated;
