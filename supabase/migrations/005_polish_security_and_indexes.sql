-- ============================================================
-- 005_polish_security_and_indexes.sql
-- SCIP-OJ 数据库安全防护、性能索引与视图优化（增量，非破坏性）
-- 1. profiles.role 权限提权防护（禁止普通用户自行篡改自身角色）
-- 2. 核心查询索引补齐（花名册对齐、邀请码匹配、评测流水、成绩中心）
-- 3. 增强 join_course_by_code RPC 函数（空值防御与格式归一化）
-- 4. 显式授予 public API 角色访问权限（遵循 RLS 策略）
-- ============================================================

-- 1. 防御 profiles.role 越权提权触发器
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
    -- 普通用户调用 UPDATE profiles 时，禁止将角色自行修改为 teacher 或 admin
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        -- 如果当前请求角色是 authenticated（前端普通用户），且旧角色不是 admin，则强制维持旧角色
        IF auth.role() = 'authenticated' AND OLD.role != 'admin' THEN
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_profile_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_role_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_profile_role_escalation();

-- 2. 补齐核心业务查询性能索引
-- 花名册对齐索引（加速 LOWER(TRIM(student_no)) 匹配）
CREATE INDEX IF NOT EXISTS idx_roster_pending_student_no_lookup
    ON public.roster_pending (course_id, LOWER(TRIM(student_no)));

CREATE INDEX IF NOT EXISTS idx_roster_pending_matched_user
    ON public.roster_pending (matched_user_id)
    WHERE matched_user_id IS NOT NULL;

-- 邀请码大小写不敏感快速检索
CREATE INDEX IF NOT EXISTS idx_course_invites_code_ci
    ON public.course_invites (LOWER(TRIM(code)));

-- 评测记录状态与时间线快速查询
CREATE INDEX IF NOT EXISTS idx_gradings_submission_status
    ON public.gradings (submission_id, status);

CREATE INDEX IF NOT EXISTS idx_gradings_created_at_desc
    ON public.gradings (created_at DESC);

-- 提交记录按作业与时间排序
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_created
    ON public.submissions (assignment_id, created_at DESC);

-- 审计日志查询索引
CREATE INDEX IF NOT EXISTS idx_grade_audits_grading
    ON public.grade_audits (grading_id);

CREATE INDEX IF NOT EXISTS idx_grade_audits_actor
    ON public.grade_audits (actor_id);

-- 3. 增强版 join_course_by_code 函数（健壮性升级）
CREATE OR REPLACE FUNCTION public.join_course_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', '未登录用户无法选课，请先登录 GitHub 账号');
    END IF;

    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', '请输入有效的课程邀请码');
    END IF;

    v_clean_code := LOWER(TRIM(p_code));

    -- 1. 尝试从 course_invites 表匹配
    SELECT ci.id, ci.course_id, c.name, c.code, ci.role, ci.expires_at, ci.max_uses, ci.uses_count
    INTO v_invite_id, v_course_id, v_course_name, v_course_code, v_role, v_expires_at, v_max_uses, v_uses_count
    FROM course_invites ci
    JOIN courses c ON c.id = ci.course_id
    WHERE LOWER(TRIM(ci.code)) = v_clean_code
    LIMIT 1;

    -- 2. 回退从 courses.invite_code 或 courses.code 匹配
    IF v_course_id IS NULL THEN
        SELECT c.id, c.name, c.code, 'student'
        INTO v_course_id, v_course_name, v_course_code, v_role
        FROM courses c
        WHERE LOWER(TRIM(COALESCE(c.invite_code, ''))) = v_clean_code
           OR LOWER(TRIM(c.code)) = v_clean_code
        LIMIT 1;
    END IF;

    IF v_course_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', '邀请码无效，未找到对应课程');
    END IF;

    -- 检查是否过期
    IF v_expires_at IS NOT NULL AND now() > v_expires_at THEN
        RETURN jsonb_build_object('ok', false, 'error', '该课程邀请码已过期');
    END IF;

    -- 检查是否超出最大使用次数
    IF v_max_uses IS NOT NULL AND v_uses_count >= v_max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', '该课程邀请码已达到使用上限');
    END IF;

    -- 写入选课关系（若已选课则不报错）
    INSERT INTO enrollments (course_id, user_id, role)
    VALUES (v_course_id, v_uid, COALESCE(v_role, 'student'))
    ON CONFLICT (course_id, user_id) DO NOTHING;

    -- 递增邀请码使用次数
    IF v_invite_id IS NOT NULL THEN
        UPDATE course_invites
        SET uses_count = uses_count + 1
        WHERE id = v_invite_id;
    END IF;

    -- 若学生已填写学号，尝试自动匹配预设花名册
    SELECT student_no INTO v_student_no FROM profiles WHERE user_id = v_uid;
    IF v_student_no IS NOT NULL AND TRIM(v_student_no) != '' THEN
        UPDATE roster_pending
        SET status = 'matched', matched_user_id = v_uid
        WHERE course_id = v_course_id
          AND LOWER(TRIM(student_no)) = LOWER(TRIM(v_student_no));
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'message', '选课成功',
        'course_id', v_course_id,
        'course_name', v_course_name,
        'course_code', v_course_code,
        'role', v_role
    );
END;
$$;

-- 4. 显式权限授权（确保 anon 与 authenticated 角色在 RLS 保护下正常工作）
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.courses TO anon, authenticated;
GRANT SELECT ON public.assignments TO anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.submissions TO authenticated;
GRANT SELECT ON public.gradings TO authenticated;
GRANT SELECT ON public.course_gradebook TO authenticated;
GRANT SELECT ON public.course_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roster_pending TO authenticated;
GRANT SELECT ON public.grade_audits TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_course_by_code(TEXT) TO authenticated;
