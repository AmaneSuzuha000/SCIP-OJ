-- Additive migration: historical submissions, grades and ACLs remain intact.
-- RPCs are SECURITY INVOKER and executable ONLY by service_role. The Edge
-- authenticates the actor; the transaction rechecks course and exam authority.
ALTER TABLE public.submissions ADD COLUMN request_key uuid;
CREATE UNIQUE INDEX submissions_request_key ON public.submissions(user_id, request_key)
  WHERE request_key IS NOT NULL;
ALTER TABLE public.gradings
  ADD COLUMN config_snapshot jsonb,
  ADD COLUMN requested_by uuid REFERENCES auth.users(id),
  ADD COLUMN request_key uuid,
  ADD COLUMN retry_of uuid REFERENCES public.gradings(id),
  ADD COLUMN retry_depth integer NOT NULL DEFAULT 0 CHECK (retry_depth BETWEEN 0 AND 2);
CREATE UNIQUE INDEX gradings_request_key ON public.gradings(requested_by, request_key)
  WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX gradings_retry_once ON public.gradings(retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX gradings_pending_age ON public.gradings(status, created_at)
  WHERE status IN ('queued', 'running');

-- Private execution inputs must never be joined into browser-readable reports.
-- Retain the random seed to reproduce exactly the instances of an attempt.
CREATE TABLE public.grading_dispatches (
  grading_id uuid PRIMARY KEY REFERENCES public.gradings(id),
  instance_seed uuid NOT NULL DEFAULT gen_random_uuid(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  dispatched_at timestamptz,
  last_error text
);
ALTER TABLE public.grading_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grading_dispatches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.grading_dispatches TO service_role;

CREATE FUNCTION public.enqueue_grading(
  p_user_id uuid, p_assignment_id uuid, p_submission_id uuid,
  p_code_text text, p_request_key uuid, p_grader_ref text,
  p_metadata jsonb, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  a public.assignments%ROWTYPE;
  s public.submissions%ROWTYPE;
  g public.gradings%ROWTYPE;
  v_staff boolean;
  v_old integer;
  v_config jsonb;
  v_meta jsonb;
BEGIN
  IF p_user_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST_KEY';
  END IF;
  -- Same lock as the authoritative quota trigger, also serializes idempotency.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 641493));
  IF p_submission_id IS NULL THEN
    SELECT * INTO s FROM public.submissions
      WHERE user_id=p_user_id AND request_key=p_request_key;
    IF FOUND THEN
      IF s.assignment_id IS DISTINCT FROM p_assignment_id OR s.code_text IS DISTINCT FROM p_code_text THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
      END IF;
      SELECT * INTO g FROM public.gradings WHERE submission_id=s.id
        ORDER BY created_at DESC, id DESC LIMIT 1;
      RETURN jsonb_build_object('ok',true,'submission_id',s.id,'public_code',s.public_code,
        'attempt_no',s.attempt_no,'grading_id',g.id,'status',g.status,'duplicate',true);
    END IF;
    IF p_code_text IS NULL OR btrim(p_code_text)='' OR octet_length(p_code_text)>200000 THEN
      RAISE EXCEPTION 'INVALID_CODE';
    END IF;
    SELECT * INTO a FROM public.assignments WHERE id=p_assignment_id FOR SHARE;
  ELSE
    SELECT * INTO g FROM public.gradings WHERE requested_by=p_user_id AND request_key=p_request_key;
    IF FOUND THEN
      IF g.submission_id<>p_submission_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      RETURN jsonb_build_object('ok',true,'submission_id',g.submission_id,
        'grading_id',g.id,'status',g.status,'duplicate',true);
    END IF;
    SELECT * INTO s FROM public.submissions WHERE id=p_submission_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
    SELECT * INTO a FROM public.assignments WHERE id=s.assignment_id FOR SHARE;
  END IF;
  IF a.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.enrollments e WHERE e.user_id=p_user_id
      AND e.course_id=a.course_id AND e.role IN ('teacher','ta','admin'))
    OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=p_user_id AND p.role='admin')
    INTO v_staff;
  IF p_submission_id IS NOT NULL THEN
    IF NOT v_staff THEN RAISE EXCEPTION 'TEACHER_ROLE_REQUIRED'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.enrollments WHERE user_id=p_user_id AND course_id=a.course_id) THEN
      RAISE EXCEPTION 'NOT_ENROLLED';
    END IF;
    IF NOT v_staff AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_user_id
        AND nullif(btrim(student_no),'') IS NOT NULL) THEN RAISE EXCEPTION 'STUDENT_NO_REQUIRED'; END IF;
    IF a.integrity_policy IN ('exam_warn','exam_block') AND NOT v_staff
        AND NOT public.is_verified_course_student(a.course_id,p_user_id) THEN
      RAISE EXCEPTION 'IDENTITY_VERIFICATION_REQUIRED';
    END IF;
  END IF;
  IF p_grader_ref IS NULL OR p_grader_ref !~ '^[0-9a-f]{40}$' THEN RAISE EXCEPTION 'INVALID_GRADER_REF'; END IF;
  IF a.problem_id NOT IN ('P001','P002') OR a.pass_score NOT BETWEEN 0 AND 100
      OR a.n_instances NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_GRADING_CONFIG'; END IF;
  v_config:=jsonb_build_object('schema_version',1,'problem_id',a.problem_id,
    'grader_ref',p_grader_ref,'scoring_policy_version',a.scoring_policy_version,
    'pass_score',a.pass_score,'n_instances',a.n_instances,'test_set','server_private_v2');
  IF p_submission_id IS NULL THEN
    v_meta:=coalesce(p_metadata,'{}'::jsonb) - 'late' - 'submitted_after_due' - 'identity';
    IF a.due_at IS NOT NULL AND clock_timestamp()>a.due_at THEN
      v_meta:=v_meta||'{"late":true,"submitted_after_due":true}'::jsonb;
    END IF;
    IF a.integrity_policy IN ('exam_warn','exam_block') AND NOT v_staff THEN
      v_meta:=v_meta||jsonb_build_object('identity',jsonb_build_object('teacher_attested',true,'checked_at',clock_timestamp()));
    END IF;
    INSERT INTO public.submissions(user_id,assignment_id,code_text,code_hash,metadata,request_key)
      VALUES(p_user_id,a.id,p_code_text,encode(sha256(convert_to(p_code_text,'UTF8')),'hex'),v_meta,p_request_key)
      RETURNING * INTO s;
  END IF;
  INSERT INTO public.gradings(submission_id,status,config_snapshot,requested_by,request_key,created_at)
    VALUES(s.id,'queued',v_config,p_user_id,p_request_key,clock_timestamp()) RETURNING * INTO g;
  INSERT INTO public.grading_dispatches(grading_id) VALUES(g.id);
  IF p_submission_id IS NOT NULL THEN
    SELECT score INTO v_old FROM public.gradings WHERE submission_id=s.id AND status='done'
      AND score IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1;
    INSERT INTO public.grade_audits(grading_id,submission_id,actor_id,old_score,reason)
      VALUES(g.id,s.id,p_user_id,v_old,left(coalesce(p_reason,'教师复判'),500));
  END IF;
  RETURN jsonb_build_object('ok',true,'submission_id',s.id,'public_code',s.public_code,
    'attempt_no',s.attempt_no,'grading_id',g.id,'status',g.status,
    'late',coalesce((s.metadata->>'late')::boolean,false));
END;
$$;

CREATE FUNCTION public.lease_grading_dispatches(p_limit integer DEFAULT 10, p_grading_id uuid DEFAULT NULL)
RETURNS TABLE(grading_id uuid, submission_id uuid, problem_id text, grader_ref text, lease_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RETURN QUERY WITH ready AS (
    SELECT d.grading_id FROM public.grading_dispatches d JOIN public.gradings g ON g.id=d.grading_id
    WHERE g.status='queued' AND d.attempts<5 AND d.next_attempt_at<=clock_timestamp()
      AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp())
      AND (p_grading_id IS NULL OR d.grading_id=p_grading_id)
    ORDER BY g.created_at LIMIT least(greatest(p_limit,1),25) FOR UPDATE OF d SKIP LOCKED
  ), leased AS (
    UPDATE public.grading_dispatches d SET attempts=d.attempts+1,lease_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '2 minutes'
    FROM ready r WHERE d.grading_id=r.grading_id RETURNING d.grading_id,d.lease_token
  ) SELECT g.id,g.submission_id,g.config_snapshot->>'problem_id',g.config_snapshot->>'grader_ref',l.lease_token
    FROM leased l JOIN public.gradings g ON g.id=l.grading_id;
END;
$$;

CREATE FUNCTION public.finish_grading_dispatch(p_grading_id uuid,p_lease_token uuid,p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 UPDATE public.grading_dispatches SET lease_token=NULL,lease_until=NULL,last_error=left(p_error,500),
   dispatched_at=CASE WHEN p_error IS NULL THEN clock_timestamp() ELSE dispatched_at END,
   next_attempt_at=clock_timestamp()+CASE WHEN p_error IS NULL THEN interval '10 minutes'
     ELSE make_interval(secs=>least(300,15*(2^attempts)::integer)) END
 WHERE grading_id=p_grading_id AND lease_token=p_lease_token;
$$;

CREATE FUNCTION public.claim_grading(p_grading_id uuid,p_submission_id uuid,p_runner_ref text,p_legacy_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE g public.gradings%ROWTYPE; s public.submissions%ROWTYPE; a public.assignments%ROWTYPE; v_seed uuid;
BEGIN
  IF p_runner_ref IS NULL OR p_runner_ref !~ '^run_[0-9]+_[0-9]+$' THEN RAISE EXCEPTION 'INVALID_RUNNER_REF'; END IF;
  UPDATE public.gradings SET status='running',runner_ref=p_runner_ref,started_at=clock_timestamp()
    WHERE id=p_grading_id AND submission_id=p_submission_id AND status='queued'
    RETURNING * INTO g;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.submissions WHERE id=p_submission_id;
  -- Rolling deployment compatibility only: an old Edge may have accepted a job
  -- immediately before its replacement. Do not rewrite any historical grades.
  IF g.config_snapshot IS NULL THEN
    IF p_legacy_ref IS NULL OR p_legacy_ref !~ '^[0-9a-f]{40}$' THEN RAISE EXCEPTION 'MISSING_GRADING_SNAPSHOT'; END IF;
    SELECT * INTO a FROM public.assignments WHERE id=s.assignment_id;
    g.config_snapshot:=jsonb_build_object('schema_version',1,'legacy_at_claim',true,
      'grader_ref',p_legacy_ref,'problem_id',a.problem_id,'pass_score',a.pass_score,
      'n_instances',a.n_instances,'scoring_policy_version',a.scoring_policy_version,'test_set','server_private_v2');
    UPDATE public.gradings SET config_snapshot=g.config_snapshot WHERE id=g.id;
    INSERT INTO public.grading_dispatches(grading_id) VALUES(g.id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT instance_seed INTO v_seed FROM public.grading_dispatches WHERE grading_id=g.id;
  IF g.config_snapshot IS NULL OR v_seed IS NULL THEN RAISE EXCEPTION 'MISSING_GRADING_SNAPSHOT'; END IF;
  RETURN jsonb_build_object('submission_id',s.id,'grading_id',g.id,'code_text',s.code_text,
    'code_hash',s.code_hash,'config',g.config_snapshot,'instance_seed',v_seed);
END;
$$;

CREATE FUNCTION public.complete_grading(p_grading_id uuid,p_submission_id uuid,p_runner_ref text,
  p_status text,p_score integer,p_passed boolean,p_report jsonb,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE g public.gradings%ROWTYPE; v_pass boolean;
BEGIN
  IF p_runner_ref IS NULL OR p_runner_ref !~ '^run_[0-9]+(_[0-9]+)?$' THEN RAISE EXCEPTION 'INVALID_RUNNER_REF'; END IF;
  SELECT * INTO g FROM public.gradings WHERE id=p_grading_id AND submission_id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRADING_NOT_FOUND'; END IF;
  IF g.runner_ref IS NOT NULL AND g.runner_ref IS DISTINCT FROM p_runner_ref THEN RAISE EXCEPTION 'RUNNER_MISMATCH'; END IF;
  IF p_status NOT IN ('done','system_error') OR p_status IS NULL THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF g.status IN ('done','system_error') THEN
    IF g.status='done' AND (p_status<>'done' OR g.score IS DISTINCT FROM p_score) THEN
      RAISE EXCEPTION 'CALLBACK_CONFLICT';
    END IF;
    RETURN jsonb_build_object('ok',true,'duplicate',true,'grading_id',g.id);
  END IF;
  IF p_status='done' THEN
    IF g.status<>'running' OR g.runner_ref IS DISTINCT FROM p_runner_ref THEN RAISE EXCEPTION 'RUNNER_MISMATCH'; END IF;
    IF p_score IS NULL OR p_score NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
    v_pass:=CASE WHEN g.config_snapshot IS NOT NULL THEN p_score>=(g.config_snapshot->>'pass_score')::integer ELSE p_passed END;
  ELSE v_pass:=false;
  END IF;
  UPDATE public.gradings SET status=p_status,score=CASE WHEN p_status='done' THEN p_score END,
    passed=v_pass,report_json=p_report,error_message=CASE WHEN p_status='system_error' THEN left(coalesce(p_error,'评测基础设施故障'),500) END,
    finished_at=clock_timestamp() WHERE id=g.id;
  IF p_status='done' THEN
    WITH RECURSIVE lineage AS (
      SELECT id,retry_of FROM public.gradings WHERE id=g.id
      UNION ALL SELECT parent.id,parent.retry_of FROM public.gradings parent JOIN lineage child ON parent.id=child.retry_of
    ) UPDATE public.grade_audits SET new_score=p_score WHERE grading_id IN (SELECT id FROM lineage) AND new_score IS NULL;
  END IF;
  RETURN jsonb_build_object('ok',true,'grading_id',g.id);
END;
$$;

CREATE FUNCTION public.recover_grading_jobs() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_job public.gradings%ROWTYPE; v_child uuid; v_retried integer:=0; v_closed integer;
BEGIN
  -- Serialize recovery passes. Dispatch consumers still lease independently.
  IF NOT pg_try_advisory_xact_lock(641494) THEN RETURN jsonb_build_object('busy',true); END IF;
  UPDATE public.gradings g SET status='system_error',score=NULL,passed=false,
    error_message='评测任务超时或派发重试耗尽',finished_at=clock_timestamp()
  FROM public.grading_dispatches d WHERE d.grading_id=g.id AND
    ((g.status='queued' AND d.attempts>=5 AND d.next_attempt_at<clock_timestamp()
      AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp()))
     OR (g.status='running' AND g.started_at<clock_timestamp()-interval '20 minutes'));
  GET DIAGNOSTICS v_closed=ROW_COUNT;
  FOR v_job IN SELECT x.* FROM public.gradings x JOIN public.grading_dispatches d ON d.grading_id=x.id
      WHERE x.status='system_error' AND x.retry_depth<2 AND x.config_snapshot IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.gradings n WHERE n.retry_of=x.id)
      AND NOT EXISTS(SELECT 1 FROM public.gradings n WHERE n.submission_id=x.submission_id
        AND (n.created_at,n.id)>(x.created_at,x.id))
      ORDER BY x.created_at LIMIT 25 FOR UPDATE OF x SKIP LOCKED
  LOOP
    INSERT INTO public.gradings(submission_id,status,config_snapshot,retry_of,retry_depth,created_at)
      VALUES(v_job.submission_id,'queued',v_job.config_snapshot,v_job.id,v_job.retry_depth+1,clock_timestamp()) RETURNING id INTO v_child;
    INSERT INTO public.grading_dispatches(grading_id,instance_seed)
      SELECT v_child,instance_seed FROM public.grading_dispatches WHERE grading_id=v_job.id;
    v_retried:=v_retried+1;
  END LOOP;
  RETURN jsonb_build_object('closed',v_closed,'retried',v_retried);
END;
$$;

-- Revoke browser writes: every accepted submission now has a transactional job.
REVOKE INSERT,UPDATE,DELETE ON public.submissions,public.gradings,public.grade_audits FROM authenticated;
REVOKE ALL ON FUNCTION public.enqueue_grading(uuid,uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lease_grading_dispatches(integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_grading_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_grading(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_grading(uuid,uuid,text,text,integer,boolean,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recover_grading_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_grading(uuid,uuid,uuid,text,uuid,text,jsonb,text),
  public.lease_grading_dispatches(integer,uuid),public.finish_grading_dispatch(uuid,uuid,text),
  public.claim_grading(uuid,uuid,text,text),public.complete_grading(uuid,uuid,text,text,integer,boolean,jsonb,text),
  public.recover_grading_jobs() TO service_role;
NOTIFY pgrst, 'reload schema';
