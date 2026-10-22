-- ============================================================
-- 006_security_hardening_and_leaderboard.sql
-- 目的：
--   1. 修复 course_gradebook 视图绕过 RLS 导致的全站成绩泄露；
--   2. 提供受控的教师成绩簿 RPC 与脱敏课程排行榜 RPC；
--   3. 修复邀请码/课程代码泄露与选课函数注入面；
--   4. 补齐 platform_secrets 表（Edge Function 密钥回退链）；
--   5. 收紧提交写入、匿名读取与 SECURITY DEFINER search_path。
-- 说明：本迁移为增量、可重复执行（幂等）脚本。
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_teacher_of：支持 ta / admin，并固定 search_path
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_teacher_of(cid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments
        WHERE course_id = cid
          AND user_id = auth.uid()
          AND role IN ('teacher', 'ta', 'admin')
    );
$$;

COMMENT ON FUNCTION public.is_teacher_of(UUID)
    IS '判断当前认证用户是否为某课程的教师/助教/管理员，用于 RLS 策略判定';

-- ------------------------------------------------------------
-- 2. enrollments 角色约束：允许 ta / admin（Edge Function 与邀请码已使用该角色）
-- ------------------------------------------------------------
ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_role_check;
ALTER TABLE public.enrollments
    ADD CONSTRAINT enrollments_role_check
    CHECK (role IN ('student', 'teacher', 'ta', 'admin'));

-- ------------------------------------------------------------
-- 3. 新用户资料：角色固定为 student，绝不信任客户端 metadata 中的 role
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (user_id, student_no, display_name, role)
    VALUES (
        NEW.id,
        NULL,
        COALESCE(
            NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
            NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
            NULLIF(TRIM(NEW.raw_user_meta_data->>'user_name'), ''),
            NEW.email,
            '新用户'
        ),
        'student'
    )
    -- 重复登录不覆盖用户已填写的真实姓名与学号
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 4. 角色提权防护：固定 search_path
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF auth.role() = 'authenticated' AND OLD.role != 'admin' THEN
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 5. 成绩簿视图：修正 latest 策略在复判后的排序不确定问题
--    并撤销 authenticated 直接 SELECT，改为只允许受控 RPC 访问。
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.course_gradebook AS
WITH ranked_scores AS (
    SELECT
        a.course_id,
        s.user_id,
        s.assignment_id,
        s.id AS submission_id,
        a.problem_id,
        a.score_policy,
        a.pass_score,
        a.due_at,
        g.score,
        s.created_at AS submitted_at,
        ROW_NUMBER() OVER (
            PARTITION BY s.user_id, s.assignment_id
            ORDER BY
                CASE
                    WHEN a.score_policy IN ('highest_before_due', 'highest')
                        THEN g.score
                    ELSE NULL
                END DESC NULLS LAST,
                CASE
                    WHEN a.score_policy = 'latest'
                        THEN EXTRACT(EPOCH FROM s.created_at)
                    ELSE NULL
                END DESC NULLS LAST,
                -- 同一提交存在多次复判时，取最新一次 grading，避免分数随机
                g.created_at DESC
        ) AS rn
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN gradings g ON g.submission_id = s.id
    WHERE g.status = 'done'
      AND (
          a.score_policy != 'highest_before_due'
          OR a.due_at IS NULL
          OR s.created_at <= a.due_at
      )
),
submission_stats AS (
    SELECT
        s.user_id,
        s.assignment_id,
        COUNT(*)            AS submission_count,
        MAX(s.created_at)   AS latest_submission_at
    FROM submissions s
    GROUP BY s.user_id, s.assignment_id
)
SELECT
    e.course_id,
    e.user_id,
    p.student_no,
    p.display_name,
    a.id                                AS assignment_id,
    a.problem_id,
    a.pass_score,
    rs.submission_id                    AS best_submission_id,
    rs.score                            AS best_score,
    CASE
        WHEN rs.score IS NOT NULL
            THEN rs.score >= a.pass_score
        ELSE NULL
    END                                 AS passed,
    COALESCE(ss.submission_count, 0)    AS submission_count,
    COALESCE(ss.submission_count, 0)    AS attempt_count,
    ss.latest_submission_at,
    ss.latest_submission_at             AS last_submitted_at
FROM enrollments e
JOIN profiles p ON p.user_id = e.user_id
CROSS JOIN assignments a
LEFT JOIN ranked_scores rs
    ON  rs.user_id = e.user_id
    AND rs.assignment_id = a.id
    AND rs.rn = 1
LEFT JOIN submission_stats ss
    ON  ss.user_id = e.user_id
    AND ss.assignment_id = a.id
WHERE e.role = 'student'
  AND a.course_id = e.course_id;

COMMENT ON VIEW public.course_gradebook IS
    '课程成绩簿视图：展示每位学生每道作业的最优成绩、最高分对应提交 ID、提交次数、最近提交时间（仅通过受控 RPC 访问）';

REVOKE ALL ON public.course_gradebook FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_gradebook TO service_role;

-- ------------------------------------------------------------
-- 6. 教师成绩簿 RPC：校验课程教师身份后返回成绩簿
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_teacher_gradebook(UUID);

-- 显式声明返回列，避免依赖视图复合类型的 SELECT 权限
CREATE OR REPLACE FUNCTION public.get_teacher_gradebook(p_course_id UUID)
RETURNS TABLE (
    course_id UUID,
    user_id UUID,
    student_no TEXT,
    display_name TEXT,
    assignment_id UUID,
    problem_id TEXT,
    pass_score INTEGER,
    best_submission_id UUID,
    best_score INTEGER,
    passed BOOLEAN,
    submission_count BIGINT,
    attempt_count BIGINT,
    latest_submission_at TIMESTAMPTZ,
    last_submitted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        g.course_id,
        g.user_id,
        g.student_no,
        g.display_name,
        g.assignment_id,
        g.problem_id,
        g.pass_score,
        g.best_submission_id,
        g.best_score,
        g.passed,
        g.submission_count,
        g.attempt_count,
        g.latest_submission_at,
        g.last_submitted_at
    FROM public.course_gradebook g
    WHERE g.course_id = p_course_id
      AND public.is_teacher_of(p_course_id);
$$;

REVOKE ALL ON FUNCTION public.get_teacher_gradebook(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_gradebook(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_teacher_gradebook(UUID)
    IS '教师/助教读取本课程成绩簿；非本课程教师返回空集';

-- ------------------------------------------------------------
-- 7. 学生排行榜 RPC：仅返回本课程脱敏学号，浏览器拿不到完整学号
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_course_leaderboard(UUID, TEXT);

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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_problem TEXT;
BEGIN
    IF p_course_id IS NULL THEN
        RETURN;
    END IF;

    -- 仅本课程师生可读；未选课用户返回空集，避免跨课程窥探成绩
    IF NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = p_course_id
          AND e.user_id = auth.uid()
    ) THEN
        RETURN;
    END IF;

    v_problem := NULLIF(UPPER(TRIM(COALESCE(p_problem_id, ''))), '');

    IF v_problem IS NULL THEN
        -- 未指定题目：按学生聚合，避免 100 行 LIMIT 把同分学生截断
        RETURN QUERY
        SELECT
            g.course_id,
            NULL::TEXT AS problem_id,
            CASE
                WHEN g.student_no IS NULL OR LENGTH(g.student_no) < 6 THEN '***'
                ELSE LEFT(g.student_no, 4) || '****' || RIGHT(g.student_no, 2)
            END AS student_no_masked,
            g.display_name,
            MAX(g.best_score)::INTEGER AS best_score,
            BOOL_OR(g.passed) AS passed,
            COALESCE(SUM(g.attempt_count), 0)::BIGINT AS attempt_count,
            MAX(g.last_submitted_at) AS last_submitted_at
        FROM public.course_gradebook g
        WHERE g.course_id = p_course_id
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
                WHEN g.student_no IS NULL OR LENGTH(g.student_no) < 6 THEN '***'
                ELSE LEFT(g.student_no, 4) || '****' || RIGHT(g.student_no, 2)
            END AS student_no_masked,
            g.display_name,
            g.best_score,
            g.passed,
            COALESCE(g.attempt_count, 0)::BIGINT AS attempt_count,
            g.last_submitted_at
        FROM public.course_gradebook g
        WHERE g.course_id = p_course_id
          AND g.problem_id = v_problem
          AND g.best_score IS NOT NULL
        ORDER BY g.best_score DESC, g.last_submitted_at ASC
        LIMIT 100;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_leaderboard(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_course_leaderboard(UUID, TEXT)
    IS '课程排行榜：仅本课程师生可读，学号在服务端脱敏；未指定题目时按学生聚合';

-- ------------------------------------------------------------
-- 8. 邀请码策略：不再向所有登录用户暴露全部邀请码
-- ------------------------------------------------------------
DROP POLICY IF EXISTS course_invites_select_authenticated ON public.course_invites;
DROP POLICY IF EXISTS course_invites_select_teacher ON public.course_invites;
CREATE POLICY course_invites_select_teacher ON public.course_invites
    FOR SELECT USING (public.is_teacher_of(course_id));

-- ------------------------------------------------------------
-- 9. 收紧匿名读取与客户端直接写提交
-- ------------------------------------------------------------
REVOKE SELECT ON public.courses FROM anon;
REVOKE SELECT ON public.assignments FROM anon;
REVOKE INSERT ON public.submissions FROM authenticated;
DROP POLICY IF EXISTS submissions_insert_own ON public.submissions;

-- 课程表列级权限：所有登录用户只需 id/name/code，邀请码只允许本课程教师读取。
-- 否则任何登录用户都能 SELECT 出全部课程的 invite_code，邀请码形同虚设。
REVOKE SELECT ON public.courses FROM authenticated;
GRANT SELECT (id, name, code, created_at) ON public.courses TO authenticated;
GRANT UPDATE (invite_code) ON public.courses TO authenticated;

CREATE OR REPLACE FUNCTION public.get_course_invite_code(p_course_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN public.is_teacher_of(p_course_id)
            THEN (SELECT c.invite_code FROM public.courses c WHERE c.id = p_course_id)
        ELSE NULL
    END;
$$;

REVOKE ALL ON FUNCTION public.get_course_invite_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_invite_code(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_course_invite_code(UUID)
    IS '本课程教师读取邀请码；其他用户返回 NULL';

-- ------------------------------------------------------------
-- 10. 选课 RPC：只匹配真正的邀请码，且重复加入不重复计数
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_course_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_clean_code TEXT;
    v_course_id UUID;
    v_course_name TEXT;
    v_course_code TEXT;
    v_role TEXT := 'student';
    v_invite_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_max_uses INTEGER;
    v_uses_count INTEGER;
    v_student_no TEXT;
    v_inserted INTEGER := 0;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', '未登录用户无法选课，请先登录 GitHub 账号');
    END IF;

    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', '请输入有效的课程邀请码');
    END IF;

    IF p_code !~ '^[A-Za-z0-9_-]{2,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', '邀请码格式不正确');
    END IF;

    v_clean_code := LOWER(TRIM(p_code));

    -- 1. 从 course_invites 匹配
    SELECT ci.id, ci.course_id, c.name, c.code, ci.role, ci.expires_at, ci.max_uses, ci.uses_count
    INTO v_invite_id, v_course_id, v_course_name, v_course_code, v_role, v_expires_at, v_max_uses, v_uses_count
    FROM public.course_invites ci
    JOIN public.courses c ON c.id = ci.course_id
    WHERE LOWER(TRIM(ci.code)) = v_clean_code
    LIMIT 1;

    -- 2. 回退仅匹配 courses.invite_code（不再把公开的课程代码当邀请码）
    IF v_course_id IS NULL THEN
        SELECT c.id, c.name, c.code, 'student'
        INTO v_course_id, v_course_name, v_course_code, v_role
        FROM public.courses c
        WHERE LOWER(TRIM(COALESCE(c.invite_code, ''))) = v_clean_code
        LIMIT 1;
    END IF;

    IF v_course_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', '邀请码无效，未找到对应课程');
    END IF;

    IF v_expires_at IS NOT NULL AND now() > v_expires_at THEN
        RETURN jsonb_build_object('ok', false, 'error', '该课程邀请码已过期');
    END IF;

    IF v_max_uses IS NOT NULL AND v_uses_count >= v_max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', '该课程邀请码已达到使用上限');
    END IF;

    INSERT INTO public.enrollments (course_id, user_id, role)
    VALUES (v_course_id, v_uid, COALESCE(v_role, 'student'))
    ON CONFLICT (course_id, user_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- 只有真正新选课才递增使用次数，避免重复点击把邀请码次数刷满
    IF v_invite_id IS NOT NULL AND v_inserted > 0 THEN
        UPDATE public.course_invites
        SET uses_count = uses_count + 1
        WHERE id = v_invite_id;
    END IF;

    SELECT student_no INTO v_student_no FROM public.profiles WHERE user_id = v_uid;
    IF v_student_no IS NOT NULL AND TRIM(v_student_no) != '' THEN
        UPDATE public.roster_pending
        SET status = 'matched', matched_user_id = v_uid
        WHERE course_id = v_course_id
          AND LOWER(TRIM(student_no)) = LOWER(TRIM(v_student_no));
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'already_enrolled', v_inserted = 0,
        'message', CASE WHEN v_inserted = 0 THEN '您已在该课程中' ELSE '选课成功' END,
        'course_id', v_course_id,
        'course_name', v_course_name,
        'course_code', v_course_code,
        'role', COALESCE(v_role, 'student')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.join_course_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_course_by_code(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 11. 学号变更后只对齐“该用户已选课程”的花名册，避免跨课程误匹配
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_profile_student_no_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.student_no IS NOT NULL AND NEW.student_no != ''
       AND (OLD.student_no IS NULL OR OLD.student_no != NEW.student_no) THEN
        UPDATE public.roster_pending rp
        SET status = 'matched', matched_user_id = NEW.user_id
        WHERE LOWER(TRIM(rp.student_no)) = LOWER(TRIM(NEW.student_no))
          AND rp.course_id IN (
              SELECT e.course_id FROM public.enrollments e WHERE e.user_id = NEW.user_id
          );
    END IF;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 12. Edge Function 密钥回退表（此前文档提到但从未创建）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_secrets (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_secrets IS 'Edge Function 密钥回退表（仅 service_role 可读；优先使用 Deno.env）';

ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_secrets TO service_role;

-- ------------------------------------------------------------
-- 13. 补充表级权限：RLS 策略存在但缺少表权限时，教师操作会报 42501
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roster_pending TO authenticated;
-- 教师发布作业的直写回退路径（RLS 仍限制为本课程教师）
GRANT INSERT, UPDATE ON public.assignments TO authenticated;

-- ------------------------------------------------------------
-- 14. 通知 PostgREST 立即刷新 schema 缓存（新 RPC 立刻可用）
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
