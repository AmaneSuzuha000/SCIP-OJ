-- 20261116000000: Fresh audit hardening for staff/admin privilege consistency,
-- TA roster verification alignment, case-insensitive student_no uniqueness,
-- profile/roster whitespace normalization, and INSERT trigger coverage.

-- 1. Unify public.is_teacher_of(cid) with global admin privilege (profiles.role = 'admin')
--    and harden search_path to include pg_catalog.
CREATE OR REPLACE FUNCTION public.is_teacher_of(cid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = cid
          AND e.user_id = auth.uid()
          AND e.role IN ('teacher', 'ta', 'admin')
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.role = 'admin'
    );
$$;

-- 2. Align confirm_student_identity and get_course_verified_roster with TA & global admin
--    course staff roles so TAs viewing RosterPanel see accurate verification states
--    and can perform identity attestation as documented.
CREATE OR REPLACE FUNCTION public.confirm_student_identity(
  p_roster_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_course uuid;
  v_matched uuid;
  v_status text;
  v_number text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT r.course_id, r.matched_user_id, r.status, r.student_no
    INTO v_course, v_matched, v_status, v_number
    FROM public.roster_pending r WHERE r.id = p_roster_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'roster row not found' USING ERRCODE='22023'; END IF;
  IF NOT (
     EXISTS(SELECT 1 FROM public.enrollments e
       WHERE e.course_id = v_course AND e.user_id = v_actor AND e.role IN ('teacher', 'ta', 'admin'))
     OR EXISTS(SELECT 1 FROM public.profiles p
       WHERE p.user_id = v_actor AND p.role = 'admin')
  ) THEN
    RAISE EXCEPTION 'course teacher required' USING ERRCODE='42501';
  END IF;
  IF v_status <> 'matched' OR v_matched IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'student claim not matched' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.profiles p JOIN public.enrollments e
      ON e.user_id = p.user_id AND e.course_id = v_course AND e.role = 'student'
    WHERE p.user_id = p_user_id
      AND lower(btrim(p.student_no)) = lower(btrim(v_number))
  ) THEN
    RAISE EXCEPTION 'enrollment and student number mismatch' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = p_user_id AND i.provider = 'github'
  ) THEN
    RAISE EXCEPTION 'Github OAuth identity missing' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.roster_verifications
     (course_id, roster_id, user_id, verified_by, verified_at)
  VALUES (v_course, p_roster_id, p_user_id, v_actor, clock_timestamp())
  ON CONFLICT(roster_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    verified_by = EXCLUDED.verified_by,
    verified_at = EXCLUDED.verified_at;
  RETURN jsonb_build_object('ok', true, 'roster_id', p_roster_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_verified_roster(p_course_id uuid)
RETURNS TABLE(roster_id uuid, user_id uuid, verified_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT v.roster_id, v.user_id, v.verified_at
  FROM public.roster_verifications v
  WHERE v.course_id = p_course_id
    AND (
      EXISTS(SELECT 1 FROM public.enrollments e
        WHERE e.course_id = p_course_id AND e.user_id = auth.uid()
          AND e.role IN ('teacher', 'ta', 'admin'))
      OR EXISTS(SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.role = 'admin')
    );
$$;

REVOKE ALL ON FUNCTION public.confirm_student_identity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_student_identity(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_course_verified_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_verified_roster(uuid) TO authenticated;

-- 3. Normalize profiles and roster_pending fields on INSERT/UPDATE and enforce
--    case-insensitive uniqueness on student_no so two accounts cannot claim
--    'u20260001' vs 'U20260001' or bypass trim checks via direct REST writes.
CREATE OR REPLACE FUNCTION public.normalize_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    NEW.student_no := NULLIF(BTRIM(COALESCE(NEW.student_no, '')), '');
    NEW.display_name := NULLIF(BTRIM(COALESCE(NEW.display_name, '')), '');
    IF NEW.display_name IS NULL THEN
        IF TG_OP = 'UPDATE' THEN
            NEW.display_name := COALESCE(NULLIF(BTRIM(COALESCE(OLD.display_name, '')), ''), '新用户');
        ELSE
            NEW.display_name := '新用户';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aaa_normalize_profile_fields ON public.profiles;
CREATE TRIGGER trg_aaa_normalize_profile_fields
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_profile_fields();

REVOKE ALL ON FUNCTION public.normalize_profile_fields() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_roster_pending_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    NEW.student_no := BTRIM(COALESCE(NEW.student_no, ''));
    NEW.display_name := BTRIM(COALESCE(NEW.display_name, ''));
    NEW.github_login := NULLIF(BTRIM(COALESCE(NEW.github_login, '')), '');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aaa_normalize_roster_pending_fields ON public.roster_pending;
CREATE TRIGGER trg_aaa_normalize_roster_pending_fields
    BEFORE INSERT OR UPDATE ON public.roster_pending
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_roster_pending_fields();

REVOKE ALL ON FUNCTION public.normalize_roster_pending_fields() FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_student_no_ci
    ON public.profiles (LOWER(BTRIM(student_no)))
    WHERE student_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_pending_course_student_no_ci
    ON public.roster_pending (course_id, LOWER(BTRIM(student_no)));

-- 4. Ensure handle_profile_student_no_sync supports both INSERT and UPDATE of student_no.
CREATE OR REPLACE FUNCTION public.handle_profile_student_no_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_new_no TEXT := NULLIF(LOWER(BTRIM(COALESCE(NEW.student_no, ''))), '');
    v_old_no TEXT := CASE
        WHEN TG_OP = 'UPDATE' THEN NULLIF(LOWER(BTRIM(COALESCE(OLD.student_no, ''))), '')
        ELSE NULL
    END;
BEGIN
    IF v_new_no IS NOT DISTINCT FROM v_old_no THEN
        RETURN NEW;
    END IF;

    UPDATE public.roster_pending rp
       SET status = 'pending',
           matched_user_id = NULL
     WHERE rp.matched_user_id = NEW.user_id
       AND (v_new_no IS NULL OR LOWER(BTRIM(rp.student_no)) IS DISTINCT FROM v_new_no);

    IF v_new_no IS NOT NULL THEN
        UPDATE public.roster_pending rp
           SET status = 'matched',
               matched_user_id = NEW.user_id
         WHERE LOWER(BTRIM(rp.student_no)) = v_new_no
           AND (rp.matched_user_id IS NULL OR rp.matched_user_id = NEW.user_id)
           AND rp.course_id IN (
               SELECT e.course_id FROM public.enrollments e WHERE e.user_id = NEW.user_id
           );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_student_no_sync ON public.profiles;
CREATE TRIGGER trg_profile_student_no_sync
    AFTER INSERT OR UPDATE OF student_no ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profile_student_no_sync();

REVOKE ALL ON FUNCTION public.handle_profile_student_no_sync() FROM PUBLIC, anon, authenticated;

-- 5. Allow global admin (via is_teacher_of) to view course leaderboards even without
--    an explicit student/teacher enrollment row.
CREATE OR REPLACE FUNCTION public.get_course_leaderboard(
    p_course_id UUID,
    p_problem_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    course_id UUID,
    problem_id TEXT,
    student_no_masked TEXT,
    display_name TEXT,
    best_score INTEGER,
    passed BOOLEAN,
    attempt_count BIGINT,
    last_submitted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_problem TEXT;
BEGIN
    IF p_course_id IS NULL THEN
        RETURN;
    END IF;

    IF NOT (
        EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.course_id = p_course_id
              AND e.user_id = auth.uid()
        )
        OR public.is_teacher_of(p_course_id)
    ) THEN
        RETURN;
    END IF;

    v_problem := NULLIF(UPPER(BTRIM(COALESCE(p_problem_id, ''))), '');

    IF v_problem IS NULL THEN
        RETURN QUERY
        SELECT
            g.course_id,
            NULL::TEXT AS problem_id,
            CASE
                WHEN g.student_no IS NULL OR LENGTH(BTRIM(g.student_no)) < 6 THEN '***'
                ELSE LEFT(BTRIM(g.student_no), 4) || '****' || RIGHT(BTRIM(g.student_no), 2)
            END AS student_no_masked,
            g.display_name,
            MAX(g.best_score)::INTEGER AS best_score,
            BOOL_OR(g.passed) AS passed,
            COALESCE(SUM(g.attempt_count), 0)::BIGINT AS attempt_count,
            MAX(g.last_submitted_at) AS last_submitted_at
        FROM public.course_gradebook g
        WHERE g.course_id = p_course_id
          AND g.enroll_role = 'student'
          AND g.best_score IS NOT NULL
        GROUP BY g.course_id, g.user_id, g.student_no, g.display_name
        ORDER BY MAX(g.best_score) DESC, MAX(g.last_submitted_at) ASC
        LIMIT 100;
    ELSE
        RETURN QUERY
        SELECT
            g.course_id,
            g.problem_id,
            CASE
                WHEN g.student_no IS NULL OR LENGTH(BTRIM(g.student_no)) < 6 THEN '***'
                ELSE LEFT(BTRIM(g.student_no), 4) || '****' || RIGHT(BTRIM(g.student_no), 2)
            END AS student_no_masked,
            g.display_name,
            g.best_score,
            g.passed,
            COALESCE(g.attempt_count, 0)::BIGINT AS attempt_count,
            g.last_submitted_at
        FROM public.course_gradebook g
        WHERE g.course_id = p_course_id
          AND g.enroll_role = 'student'
          AND g.problem_id = v_problem
          AND g.best_score IS NOT NULL
        ORDER BY g.best_score DESC, g.last_submitted_at ASC
        LIMIT 100;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_leaderboard(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
