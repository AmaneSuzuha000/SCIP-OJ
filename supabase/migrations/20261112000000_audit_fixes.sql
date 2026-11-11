-- 20261112000000: Audit fixes for leaderboard exclusion and bidirectional roster
-- synchronization (profile update/clear, late join, post-join roster CSV import).
-- Keep historical migrations unmodified; all fixes are additive/CREATE OR REPLACE.

-- 1. Leaderboard: ensure fresh databases exclude staff/TA/admin trial scores
--    as documented in 007_gradebook_include_staff_trials.sql.
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

    IF NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = p_course_id
          AND e.user_id = auth.uid()
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

-- 2. Bidirectional roster synchronization:
--    a) When profiles.student_no changes or is cleared, unmatch stale roster rows
--       (firing trg_invalidate_roster_verification to delete stale attestations),
--       then match the normalized new student_no across enrolled courses.
CREATE OR REPLACE FUNCTION public.handle_profile_student_no_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_new_no TEXT := NULLIF(LOWER(BTRIM(COALESCE(NEW.student_no, ''))), '');
    v_old_no TEXT := NULLIF(LOWER(BTRIM(COALESCE(OLD.student_no, ''))), '');
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

REVOKE ALL ON FUNCTION public.handle_profile_student_no_sync() FROM PUBLIC, anon, authenticated;

--    b) When roster rows are imported AFTER a student already joined and set
--       profiles.student_no, match immediately on insert without auto-verifying.
CREATE OR REPLACE FUNCTION public.auto_match_roster_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_no TEXT := NULLIF(LOWER(BTRIM(COALESCE(NEW.student_no, ''))), '');
BEGIN
    IF v_no IS NULL OR NEW.matched_user_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT e.user_id
      INTO v_uid
      FROM public.enrollments e
      JOIN public.profiles p ON p.user_id = e.user_id
     WHERE e.course_id = NEW.course_id
       AND NULLIF(LOWER(BTRIM(COALESCE(p.student_no, ''))), '') = v_no
     LIMIT 1;

    IF v_uid IS NOT NULL THEN
        NEW.status := 'matched';
        NEW.matched_user_id := v_uid;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roster_pending_auto_match_insert ON public.roster_pending;
CREATE TRIGGER trg_roster_pending_auto_match_insert
    BEFORE INSERT ON public.roster_pending
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_match_roster_on_insert();

REVOKE ALL ON FUNCTION public.auto_match_roster_on_insert() FROM PUBLIC, anon, authenticated;

-- 3. Restore roster_pending alignment inside atomic join_course_by_code (lost
--    when 012 replaced 006's join_course_by_code), preserving all course locks,
--    revocation, expiry, max-uses and seat counting semantics.
CREATE OR REPLACE FUNCTION public.join_course_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_code,'')));
  v_course_id uuid;
  v_course_name text;
  v_course_code text;
  v_invite_id uuid;
  v_invite_role text;
  v_invite_expiry timestamptz;
  v_invite_max integer;
  v_invite_uses integer;
  v_existing_role text;
  v_inserted_role text;
  v_student_no text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','请先登录再选课','code','UNAUTHORIZED');
  END IF;
  IF v_code !~ '^[a-z0-9_-]{4,64}$' THEN
    RETURN jsonb_build_object('ok',false,'error','邀请码格式不正确','code','INVALID_CODE');
  END IF;

  SELECT ci.course_id INTO v_course_id
    FROM public.course_invites ci
   WHERE lower(btrim(ci.code))=v_code AND ci.revoked_at IS NULL
   LIMIT 1;
  IF v_course_id IS NULL THEN
    SELECT c.id INTO v_course_id FROM public.courses c
     WHERE lower(btrim(coalesce(c.invite_code,'')))=v_code LIMIT 1;
  END IF;
  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','邀请码无效或已撤销','code','INVALID_INVITE');
  END IF;

  SELECT c.name,c.code INTO v_course_name,v_course_code
  FROM public.courses c WHERE c.id=v_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','课程不存在','code','NOT_FOUND');
  END IF;

  SELECT ci.id,ci.role,ci.expires_at,ci.max_uses,ci.uses_count
    INTO v_invite_id,v_invite_role,v_invite_expiry,v_invite_max,v_invite_uses
    FROM public.course_invites ci
   WHERE ci.course_id=v_course_id AND lower(btrim(ci.code))=v_code
     AND ci.revoked_at IS NULL
   FOR UPDATE;

  IF v_invite_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id=v_course_id
        AND lower(btrim(coalesce(c.invite_code,'')))=v_code
    ) THEN
      RETURN jsonb_build_object('ok',false,'error','邀请码已经撤销','code','INVITE_REVOKED');
    END IF;
    v_invite_role := 'student';
  END IF;

  SELECT e.role INTO v_existing_role
  FROM public.enrollments e
  WHERE e.course_id=v_course_id AND e.user_id=v_uid;

  SELECT nullif(lower(btrim(coalesce(p.student_no,''))),'') INTO v_student_no
  FROM public.profiles p WHERE p.user_id=v_uid;

  IF v_existing_role IS NOT NULL THEN
    IF v_student_no IS NOT NULL THEN
      UPDATE public.roster_pending rp
         SET status='matched', matched_user_id=v_uid
       WHERE rp.course_id=v_course_id
         AND lower(btrim(rp.student_no))=v_student_no
         AND (rp.matched_user_id IS NULL OR rp.matched_user_id=v_uid);
    END IF;
    RETURN jsonb_build_object('ok',true,'already_enrolled',true,
      'message','您已加入该课程','course_id',v_course_id,
      'course_name',v_course_name,'course_code',v_course_code,
      'role',v_existing_role);
  END IF;

  IF v_invite_id IS NOT NULL THEN
    IF v_invite_expiry IS NOT NULL AND clock_timestamp() > v_invite_expiry THEN
      RETURN jsonb_build_object('ok',false,'error','邀请码已经过期','code','INVITE_EXPIRED');
    END IF;
    IF v_invite_max IS NOT NULL AND v_invite_uses >= v_invite_max THEN
      RETURN jsonb_build_object('ok',false,'error','邀请码人数已满','code','INVITE_FULL');
    END IF;
  END IF;

  INSERT INTO public.enrollments(course_id,user_id,role)
  VALUES (v_course_id,v_uid,coalesce(v_invite_role,'student'))
  ON CONFLICT (course_id,user_id) DO NOTHING
  RETURNING role INTO v_inserted_role;

  IF v_inserted_role IS NOT NULL AND v_invite_id IS NOT NULL THEN
    UPDATE public.course_invites
       SET uses_count=uses_count+1
     WHERE id=v_invite_id;
  END IF;

  IF v_student_no IS NOT NULL THEN
    UPDATE public.roster_pending rp
       SET status='matched', matched_user_id=v_uid
     WHERE rp.course_id=v_course_id
       AND lower(btrim(rp.student_no))=v_student_no
       AND (rp.matched_user_id IS NULL OR rp.matched_user_id=v_uid);
  END IF;

  RETURN jsonb_build_object('ok',true,
    'already_enrolled',(v_inserted_role IS NULL),
    'message',CASE WHEN v_inserted_role IS NULL THEN '您已加入该课程' ELSE '选课成功' END,
    'course_id',v_course_id,'course_name',v_course_name,
    'course_code',v_course_code,
    'role',coalesce(v_inserted_role,v_existing_role,v_invite_role,'student'));
END;
$$;

REVOKE ALL ON FUNCTION public.join_course_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_course_by_code(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
