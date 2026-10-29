-- ============================================================
-- 004_course_invites_roster_assignments.sql
-- SCIP-OJ 平台阶段 2 增强模式：
-- 1. 课程邀请码 (courses.invite_code & course_invites 表)
-- 2. 待匹配花名册 (roster_pending 表) 与学号关联
-- 3. 教师作业发布与 RLS 增强 (assignments & courses)
-- 4. 选课 RPC 函数 (join_course_by_code)
-- ============================================================

-- 1. courses 增加 invite_code 字段
ALTER TABLE courses ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- 邀请码由任课教师在控制台发放，迁移不写入可公开的默认码。

-- 2. 表: course_invites (支持多邀请码、有效期与限额)
CREATE TABLE IF NOT EXISTS course_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'ta')),
    expires_at  TIMESTAMPTZ,
    max_uses    INTEGER,
    uses_count  INTEGER NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE course_invites IS '课程邀请码管理表，支持有效期与使用上限';

-- 3. 表: roster_pending (教师导入的待绑定花名册)
CREATE TABLE IF NOT EXISTS roster_pending (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_no      TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    github_login    TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched')),
    matched_user_id UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, student_no)
);

COMMENT ON TABLE roster_pending IS '教师预先导入的花名册表，学生用 GitHub 登录填入同学号后自动匹配对齐';

-- 4. RLS 权限增强
ALTER TABLE course_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_pending ENABLE ROW LEVEL SECURITY;

-- course_invites 策略
CREATE POLICY course_invites_select_authenticated ON course_invites
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY course_invites_manage_teacher ON course_invites
    FOR ALL USING (is_teacher_of(course_id))
    WITH CHECK (is_teacher_of(course_id));

-- roster_pending 策略
CREATE POLICY roster_pending_select_teacher ON roster_pending
    FOR SELECT USING (is_teacher_of(course_id));

CREATE POLICY roster_pending_insert_teacher ON roster_pending
    FOR INSERT WITH CHECK (is_teacher_of(course_id));

CREATE POLICY roster_pending_update_teacher ON roster_pending
    FOR UPDATE USING (is_teacher_of(course_id)) WITH CHECK (is_teacher_of(course_id));

CREATE POLICY roster_pending_delete_teacher ON roster_pending
    FOR DELETE USING (is_teacher_of(course_id));

-- courses 更新策略（允许任课教师修改邀请码等信息）
CREATE POLICY courses_update_teacher ON courses
    FOR UPDATE USING (is_teacher_of(id)) WITH CHECK (is_teacher_of(id));

-- assignments 允许教师插入和更新作业
CREATE POLICY assignments_insert_teacher ON assignments
    FOR INSERT WITH CHECK (is_teacher_of(course_id));

CREATE POLICY assignments_update_teacher ON assignments
    FOR UPDATE USING (is_teacher_of(course_id)) WITH CHECK (is_teacher_of(course_id));

-- profiles 更新策略修正：允许更新 student_no 与 display_name
DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 5. RPC 函数: join_course_by_code
CREATE OR REPLACE FUNCTION public.join_course_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid UUID;
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
        RETURN jsonb_build_object('ok', false, 'error', '未登录用户无法选课');
    END IF;

    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', '请输入有效的邀请码');
    END IF;

    -- 1. 尝试从 course_invites 匹配
    SELECT ci.id, ci.course_id, c.name, c.code, ci.role, ci.expires_at, ci.max_uses, ci.uses_count
    INTO v_invite_id, v_course_id, v_course_name, v_course_code, v_role, v_expires_at, v_max_uses, v_uses_count
    FROM course_invites ci
    JOIN courses c ON c.id = ci.course_id
    WHERE LOWER(TRIM(ci.code)) = LOWER(TRIM(p_code))
    LIMIT 1;

    -- 2. 回退从 courses.invite_code 或 courses.code 匹配
    IF v_course_id IS NULL THEN
        SELECT c.id, c.name, c.code, 'student'
        INTO v_course_id, v_course_name, v_course_code, v_role
        FROM courses c
        WHERE LOWER(TRIM(COALESCE(c.invite_code, ''))) = LOWER(TRIM(p_code))
           OR LOWER(TRIM(c.code)) = LOWER(TRIM(p_code))
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
    IF v_student_no IS NOT NULL AND v_student_no != '' THEN
        UPDATE roster_pending
        SET status = 'matched', matched_user_id = v_uid
        WHERE course_id = v_course_id
          AND LOWER(TRIM(student_no)) = LOWER(TRIM(v_student_no));
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'course_id', v_course_id,
        'course_name', v_course_name,
        'course_code', v_course_code
    );
END;
$$;

COMMENT ON FUNCTION public.join_course_by_code(TEXT) IS '根据邀请码加入课程，并与待匹配花名册自动对齐';

-- 6. 学号更新后自动与 roster_pending 关联
CREATE OR REPLACE FUNCTION public.handle_profile_student_no_sync()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.student_no IS NOT NULL AND NEW.student_no != '' AND (OLD.student_no IS NULL OR OLD.student_no != NEW.student_no) THEN
        UPDATE roster_pending
        SET status = 'matched', matched_user_id = NEW.user_id
        WHERE LOWER(TRIM(student_no)) = LOWER(TRIM(NEW.student_no));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profile_student_no_sync ON profiles;
CREATE TRIGGER trg_profile_student_no_sync
    AFTER UPDATE OF student_no ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profile_student_no_sync();
