-- 012: Atomic, revocable enrollment invitations.
-- Apply after 011. There is one shared security boundary for browser and Edge
-- Function clients: an authenticated SECURITY DEFINER RPC with course-level locks.
ALTER TABLE public.course_invites
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Invite codes are case-insensitive throughout the system; avoid collisions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_invites_case_insensitive_code
  ON public.course_invites (lower(btrim(code)));

CREATE OR REPLACE FUNCTION public.join_course_by_code(p_code text)
RETURNS jsonb
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','请先登录再选课','code','UNAUTHORIZED');
  END IF;
  IF v_code !~ '^[a-z0-9_-]{4,64}$' THEN
    RETURN jsonb_build_object('ok',false,'error','邀请码格式不正确','code','INVALID_CODE');
  END IF;

  -- Preliminary discovery only. Take the COURSE lock before reading any
  -- mutable invitation fields to serialize joins with code rotation.
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

  -- Lock invitation after course; updates/revocations always use same order.
  SELECT ci.id,ci.role,ci.expires_at,ci.max_uses,ci.uses_count
    INTO v_invite_id,v_invite_role,v_invite_expiry,v_invite_max,v_invite_uses
    FROM public.course_invites ci
   WHERE ci.course_id=v_course_id AND lower(btrim(ci.code))=v_code
     AND ci.revoked_at IS NULL
   FOR UPDATE;

  IF v_invite_id IS NULL THEN
    -- Only the CURRENT legacy course invite is valid as fallback.
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

  IF v_existing_role IS NOT NULL THEN
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

  RETURN jsonb_build_object('ok',true,
    'already_enrolled',(v_inserted_role IS NULL),
    'message',CASE WHEN v_inserted_role IS NULL THEN '您已加入该课程' ELSE '选课成功' END,
    'course_id',v_course_id,'course_name',v_course_name,
    'course_code',v_course_code,
    'role',coalesce(v_inserted_role,v_existing_role,v_invite_role,'student'));
END;
$$;

-- Atomic rotation revokes every previous STUDENT invite for this course.
-- TA invitations are separate and must be explicitly revoked by course staff.
CREATE OR REPLACE FUNCTION public.rotate_course_invite_code(
  p_course_id uuid, p_new_code text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_new_code,'')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'login required' USING ERRCODE='42501';
  END IF;
  IF NOT (public.is_teacher_of(p_course_id) OR EXISTS(
    SELECT 1 FROM public.profiles p WHERE p.user_id=v_uid AND p.role='admin'
  )) THEN
    RAISE EXCEPTION 'course teacher required' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM public.courses c WHERE c.id=p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'course missing' USING ERRCODE='22023';
  END IF;

  IF v_code='' THEN
    v_code := 'SCIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  END IF;
  IF v_code !~ '^[A-Z0-9_-]{4,32}$' THEN
    RAISE EXCEPTION 'invalid invite format' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.course_invites ci
      WHERE lower(btrim(ci.code))=lower(v_code)
  ) OR EXISTS (
    SELECT 1 FROM public.courses c
      WHERE c.id<>p_course_id AND lower(btrim(coalesce(c.invite_code,'')))=lower(v_code)
  ) THEN
    RAISE EXCEPTION 'invite already exists; choose a different code' USING ERRCODE='23505';
  END IF;

  UPDATE public.course_invites ci SET revoked_at=clock_timestamp()
  WHERE ci.course_id=p_course_id AND ci.role='student' AND ci.revoked_at IS NULL;

  UPDATE public.courses SET invite_code=v_code WHERE id=p_course_id;

  INSERT INTO public.course_invites(course_id,code,role,created_by)
  VALUES (p_course_id,v_code,'student',v_uid);
  RETURN v_code;
END;
$$;

-- Prevent direct REST writes from bypassing the revocation/usage lock.
REVOKE INSERT,UPDATE,DELETE ON public.course_invites FROM authenticated;
REVOKE UPDATE ON public.courses FROM authenticated;
-- Earlier migration 006 explicitly granted this COLUMN privilege. Revoke both.
REVOKE UPDATE (invite_code) ON public.courses FROM authenticated;
REVOKE ALL ON FUNCTION public.rotate_course_invite_code(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_course_invite_code(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.join_course_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_course_by_code(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
