-- ============================================================
-- seed.sql
-- SCIP-OJ 种子数据（开发/测试环境用）
-- ============================================================
-- 占位符 UUID 说明：
--   教师: 00000000-0000-0000-0000-000000000001
--   学生: 00000000-0000-0000-0000-000000000002
--
-- ⚠️ 部署至 Supabase 云端时：
--   请在 Supabase Dashboard -> Authentication 中先创建用户，
--   然后将下方的 UUID 替换为您实际账号的 ID。
--   在本地使用 `supabase start` 时，可通过直接写入 auth.users 初始化。
-- ============================================================

-- =========================
-- 本地开发环境：写入 auth.users 占位
-- =========================
DO $$
BEGIN
    -- 仅当处于支持直接写入 auth.users 的开发环境中执行
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud)
        VALUES 
            ('00000000-0000-0000-0000-000000000001', 'teacher@scip-oj.local', '', now(), '{"display_name": "张教授", "role": "teacher"}'::jsonb, 'authenticated', 'authenticated'),
            ('00000000-0000-0000-0000-000000000002', 'student@scip-oj.local', '', now(), '{"display_name": "李同学", "student_no": "20260001", "role": "student"}'::jsonb, 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '跳过 auth.users 插入，请确保在 Auth 管理面板预先创建对应用户: %', SQLERRM;
END $$;

-- =========================
-- 用户资料
-- =========================
INSERT INTO profiles (user_id, student_no, display_name, role) VALUES
    -- 教师（无学号）
    ('00000000-0000-0000-0000-000000000001', NULL,       '张教授', 'teacher'),
    -- 学生
    ('00000000-0000-0000-0000-000000000002', '20260001', '李同学', 'student')
ON CONFLICT (user_id) DO UPDATE SET
    student_no = EXCLUDED.student_no,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role;

-- =========================
-- 课程
-- =========================
INSERT INTO courses (id, name, code) VALUES
    ('a0000000-0000-0000-0000-000000000001', '系统建模与优化 2026秋', 'SCIP2026A')
ON CONFLICT (code) DO NOTHING;

-- =========================
-- 选课/授课关系
-- =========================
INSERT INTO enrollments (course_id, user_id, role) VALUES
    -- 教师授课
    ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'teacher'),
    -- 学生选课
    ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'student')
ON CONFLICT (course_id, user_id) DO NOTHING;

-- =========================
-- 作业: P001 (背包问题)
-- =========================
-- 截止时间设为两周后
INSERT INTO assignments (course_id, problem_id, due_at, pass_score, n_instances, score_policy) VALUES
    (
        'a0000000-0000-0000-0000-000000000001',  -- 课程: 系统建模与优化 2026秋
        'P001',                                    -- 题目编号
        now() + INTERVAL '14 days',                -- 截止时间: 两周后
        90,                                        -- 及格分: 90
        3,                                         -- 测试实例数: 3
        'highest_before_due'                       -- 计分策略: 截止前最高分
    )
ON CONFLICT (course_id, problem_id) DO NOTHING;

-- =========================
-- 作业: P002 (指派问题)
-- =========================
INSERT INTO assignments (course_id, problem_id, due_at, pass_score, n_instances, score_policy) VALUES
    (
        'a0000000-0000-0000-0000-000000000001',  -- 课程: 系统建模与优化 2026秋
        'P002',                                    -- 题目编号
        now() + INTERVAL '14 days',                -- 截止时间: 两周后
        90,                                        -- 及格分: 90
        3,                                         -- 测试实例数: 3
        'highest_before_due'                       -- 计分策略: 截止前最高分
    )
ON CONFLICT (course_id, problem_id) DO NOTHING;
