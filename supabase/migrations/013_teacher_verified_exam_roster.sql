-- 013: Explicit instructor-verified identity record for supervised assignments.
-- A self-entered student number / auto-matched roster row is NOT proof of ID.
CREATE TABLE IF NOT EXISTS public.roster_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  roster_id uuid NOT NULL UNIQUE REFERENCES public.roster_pending(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_by uuid NOT NULL REFERENCES auth.users(id),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(course_id,user_id)
);
ALTER TABLE public.roster_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roster_verifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.roster_verifications TO service_role;

-- Any change to the claimed GitHub user, student number or designated login
-- voids prior human approval immediately. Only a teacher may re-verify.
CREATE OR REPLACE FUNCTION public.invalidate_roster_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.matched_user_id IS DISTINCT FROM OLD.matched_user_id
     OR NEW.student_no IS DISTINCT FROM OLD.student_no
     OR NEW.github_login IS DISTINCT FROM OLD.github_login
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.status IS DISTINCT FROM OLD.status
  THEN
    DELETE FROM public.roster_verifications v WHERE v.roster_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invalidate_roster_verification ON public.roster_pending;
CREATE TRIGGER trg_invalidate_roster_verification
AFTER UPDATE ON public.roster_pending
FOR EACH ROW EXECUTE FUNCTION public.invalidate_roster_verification();

-- Administrative teacher confirms the account AFTER independent offline ID check.
-- This is a recorded human attestation, not automatic facial/online identity proof.
CREATE OR REPLACE FUNCTION public.confirm_student_identity(
  p_roster_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_course uuid;
  v_matched uuid;
  v_status text;
  v_number text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT r.course_id,r.matched_user_id,r.status,r.student_no
    INTO v_course,v_matched,v_status,v_number
    FROM public.roster_pending r WHERE r.id=p_roster_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'roster row not found' USING ERRCODE='22023'; END IF;
  IF NOT (
     EXISTS(SELECT 1 FROM public.enrollments e
       WHERE e.course_id=v_course AND e.user_id=v_actor AND e.role IN ('teacher','admin'))
     OR EXISTS(SELECT 1 FROM public.profiles p
       WHERE p.user_id=v_actor AND p.role='admin')
  ) THEN
    RAISE EXCEPTION 'course teacher required' USING ERRCODE='42501';
  END IF;
  IF v_status<>'matched' OR v_matched IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'student claim not matched' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.profiles p JOIN public.enrollments e
      ON e.user_id=p.user_id AND e.course_id=v_course AND e.role='student'
    WHERE p.user_id=p_user_id
      AND lower(btrim(p.student_no))=lower(btrim(v_number))
  ) THEN
    RAISE EXCEPTION 'enrollment and student number mismatch' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id=p_user_id AND i.provider='github'
  ) THEN
    RAISE EXCEPTION 'Github OAuth identity missing' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.roster_verifications
     (course_id,roster_id,user_id,verified_by,verified_at)
  VALUES (v_course,p_roster_id,p_user_id,v_actor,clock_timestamp())
  ON CONFLICT(roster_id) DO UPDATE SET
    user_id=EXCLUDED.user_id,
    verified_by=EXCLUDED.verified_by,
    verified_at=EXCLUDED.verified_at;
  RETURN jsonb_build_object('ok',true,'roster_id',p_roster_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_verified_roster(p_course_id uuid)
RETURNS TABLE(roster_id uuid,user_id uuid,verified_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,public,pg_temp
AS $$
 SELECT v.roster_id,v.user_id,v.verified_at
 FROM public.roster_verifications v
 WHERE v.course_id=p_course_id AND
   (EXISTS(SELECT 1 FROM public.enrollments e
      WHERE e.course_id=p_course_id AND e.user_id=auth.uid()
        AND e.role IN ('teacher','admin'))
    OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.role='admin'));
$$;

-- Service-role-only internal verification: user IDs here are supplied by the
-- server after auth.getUser(jwt), never by the browser.
CREATE OR REPLACE FUNCTION public.is_verified_course_student(
  p_course_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,public,pg_temp
AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.roster_verifications v
   JOIN public.roster_pending r ON r.id=v.roster_id
     AND r.course_id=v.course_id AND r.matched_user_id=v.user_id
     AND r.status='matched'
   JOIN public.profiles p ON p.user_id=v.user_id
     AND lower(btrim(p.student_no))=lower(btrim(r.student_no))
   JOIN public.enrollments e ON e.course_id=v.course_id
     AND e.user_id=v.user_id AND e.role='student'
   WHERE v.course_id=p_course_id AND v.user_id=p_user_id
     AND EXISTS (SELECT 1 FROM auth.identities i
       WHERE i.user_id=p_user_id AND i.provider='github')
 );
$$;

REVOKE ALL ON FUNCTION public.invalidate_roster_verification() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_student_identity(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_student_identity(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_course_verified_roster(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_course_verified_roster(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_verified_course_student(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_course_student(uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
