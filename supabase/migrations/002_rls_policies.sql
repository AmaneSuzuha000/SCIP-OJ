-- ============================================================
-- 002_rls_policies.sql
-- SCIP-OJ 行级安全策略 (Row Level Security)
-- ============================================================
-- 策略设计原则:
--   1. 学生只能看到自己的数据
--   2. 教师可以看到其授课课程中所有学生的数据
--   3. 评分写入仅通过 service_role（后端/评测器），前端不可写
--   4. 提交记录不可修改（通过触发器 + 无 UPDATE 策略保证）
--   5. 使用 SECURITY DEFINER 辅助函数避免 RLS 策略内部递归
-- ============================================================

-- =========================
-- 辅助函数: 校验当前用户是否为指定课程的教师
-- =========================
-- 使用 SECURITY DEFINER 绕过 enrollments 的 RLS，防止自身递归
CREATE OR REPLACE FUNCTION public.is_teacher_of(cid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments
        WHERE course_id = cid
          AND user_id = auth.uid()
          AND role = 'teacher'
    );
$$;

COMMENT ON FUNCTION public.is_teacher_of(UUID)
    IS '判断当前认证用户是否为某课程的教师，用于 RLS 策略判定';

-- =========================
-- profiles: 用户资料
-- =========================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 用户可以读取自己的资料
CREATE POLICY profiles_select_own ON profiles
    FOR SELECT
    USING (user_id = auth.uid());

-- 用户可以更新自己的显示名称或学号
CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND role = 'student');

-- 教师可以读取其授课课程中选课学生的资料
CREATE POLICY profiles_select_teacher ON profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM enrollments se
            WHERE se.user_id = profiles.user_id
              AND is_teacher_of(se.course_id)
        )
    );

-- =========================
-- courses: 课程
-- =========================
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户均可读取课程信息
CREATE POLICY courses_select_authenticated ON courses
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- =========================
-- enrollments: 选课/授课关系
-- =========================
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

-- 用户可以读取自己的选课记录
CREATE POLICY enrollments_select_own ON enrollments
    FOR SELECT
    USING (user_id = auth.uid());

-- 教师可以读取其授课课程的所有选课记录
CREATE POLICY enrollments_select_teacher ON enrollments
    FOR SELECT
    USING (is_teacher_of(course_id));

-- =========================
-- assignments: 作业/题目
-- =========================
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户均可读取作业信息
CREATE POLICY assignments_select_authenticated ON assignments
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- =========================
-- submissions: 提交记录
-- =========================
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- 学生可以读取自己的提交记录
CREATE POLICY submissions_select_own ON submissions
    FOR SELECT
    USING (user_id = auth.uid());

-- 教师可以读取其授课课程中的所有提交记录
CREATE POLICY submissions_select_teacher ON submissions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM assignments a
            WHERE a.id = submissions.assignment_id
              AND is_teacher_of(a.course_id)
        )
    );

-- 已认证用户可以插入自己的提交（user_id 必须等于当前用户）
CREATE POLICY submissions_insert_own ON submissions
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- 注意: 没有 UPDATE 策略 —— 提交记录不可通过前端修改
-- 不可变性由触发器 trg_submissions_prevent_immutable_update 额外保证

-- =========================
-- gradings: 评分记录
-- =========================
ALTER TABLE gradings ENABLE ROW LEVEL SECURITY;

-- 学生可以读取自己提交的评分结果
CREATE POLICY gradings_select_own ON gradings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM submissions AS s
            WHERE s.id = gradings.submission_id
              AND s.user_id = auth.uid()
        )
    );

-- 教师可以读取其授课课程中的所有评分结果
CREATE POLICY gradings_select_teacher ON gradings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM submissions AS s
            JOIN assignments AS a ON a.id = s.assignment_id
            WHERE s.id = gradings.submission_id
              AND is_teacher_of(a.course_id)
        )
    );

-- 注意: 评分的 INSERT/UPDATE 仅通过 service_role 执行（评测后端）
-- 前端用户（含教师）不可直接写入评分记录

-- =========================
-- grade_audits: 评分审计日志
-- =========================
ALTER TABLE grade_audits ENABLE ROW LEVEL SECURITY;

-- 教师可以读取其授课课程的审计日志
CREATE POLICY grade_audits_select_teacher ON grade_audits
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM gradings AS g
            JOIN submissions AS s ON s.id = g.submission_id
            JOIN assignments AS a ON a.id = s.assignment_id
            WHERE g.id = grade_audits.grading_id
              AND is_teacher_of(a.course_id)
        )
    );

-- 注意: 审计日志的 INSERT 仅通过 service_role 执行
-- 前端用户不可直接写入审计日志
