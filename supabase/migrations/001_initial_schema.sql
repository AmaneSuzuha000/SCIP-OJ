-- ============================================================
-- 001_initial_schema.sql
-- SCIP-OJ 平台初始数据库模式
-- 包含所有核心表、触发器、函数
-- ============================================================

-- =========================
-- 表: profiles (用户资料)
-- =========================
-- 存储用户扩展信息，与 auth.users 一一对应
CREATE TABLE profiles (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id),
    student_no   TEXT UNIQUE,                                        -- 学号，可为空（教师无学号）
    display_name TEXT NOT NULL,                                      -- 显示名称
    role         TEXT NOT NULL DEFAULT 'student'
                     CHECK (role IN ('student', 'teacher', 'admin')),-- 全局角色
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  profiles             IS '用户资料表，与 auth.users 一一对应';
COMMENT ON COLUMN profiles.student_no  IS '学号，教师可为空';
COMMENT ON COLUMN profiles.role        IS '全局角色：student / teacher / admin';

-- =========================
-- 表: courses (课程)
-- =========================
CREATE TABLE courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,                                       -- 课程名称
    code        TEXT UNIQUE NOT NULL,                                -- 课程代码，如 SCIP2026A
    created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  courses      IS '课程表';
COMMENT ON COLUMN courses.code IS '课程代码，全局唯一';

-- =========================
-- 表: enrollments (选课/授课)
-- =========================
-- 记录用户与课程的关系，区分学生和教师
CREATE TABLE enrollments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID NOT NULL REFERENCES courses(id),
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    role        TEXT NOT NULL DEFAULT 'student'
                     CHECK (role IN ('student', 'teacher')),         -- 在该课程中的角色
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, user_id)
);

COMMENT ON TABLE  enrollments      IS '选课/授课关系表';
COMMENT ON COLUMN enrollments.role IS '课程角色：student 选课 / teacher 授课';

-- =========================
-- 表: assignments (作业/题目)
-- =========================
CREATE TABLE assignments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id               UUID NOT NULL REFERENCES courses(id),
    problem_id              TEXT NOT NULL,                            -- 题目编号，如 P001
    due_at                  TIMESTAMPTZ,                             -- 截止时间
    scoring_policy_version  TEXT NOT NULL DEFAULT 'v1',              -- 评分策略版本
    pass_score              INTEGER NOT NULL DEFAULT 90,             -- 及格分数线
    n_instances             INTEGER NOT NULL DEFAULT 3,              -- 测试实例数
    score_policy            TEXT NOT NULL DEFAULT 'highest_before_due'
                                 CHECK (score_policy IN (
                                     'highest_before_due',           -- 截止前最高分（默认）
                                     'latest',                       -- 最新提交
                                     'highest'                       -- 全局最高分（忽略截止时间）
                                 )),
    created_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, problem_id)
);

COMMENT ON TABLE  assignments                IS '作业/题目表';
COMMENT ON COLUMN assignments.problem_id     IS '题目编号，如 P001';
COMMENT ON COLUMN assignments.score_policy   IS '计分策略：highest_before_due / latest / highest';
COMMENT ON COLUMN assignments.pass_score     IS '及格分数线，默认 90 分';
COMMENT ON COLUMN assignments.n_instances    IS '测试实例数量';

-- =========================
-- 函数: 生成提交公开编号
-- =========================
-- 格式: SUB-XXXXXXXX（UUID 前8位大写十六进制）
CREATE OR REPLACE FUNCTION generate_submission_public_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.public_code IS NULL OR NEW.public_code = '' THEN
        NEW.public_code := 'SUB-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
    ELSIF NOT NEW.public_code LIKE 'SUB-%' THEN
        NEW.public_code := 'SUB-' || NEW.public_code;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_submission_public_code()
    IS '自动生成提交的公开编号，格式为 SUB-XXXXXXXX';

-- =========================
-- 函数: 自动计算提交序号
-- =========================
-- 同一用户对同一作业的第 N 次提交
CREATE OR REPLACE FUNCTION compute_submission_attempt_no()
RETURNS TRIGGER AS $$
BEGIN
    NEW.attempt_no := (
        SELECT COUNT(*) + 1
        FROM submissions
        WHERE user_id = NEW.user_id
          AND assignment_id = NEW.assignment_id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_submission_attempt_no()
    IS '自动计算提交序号：同一用户对同一作业的第 N 次提交';

-- =========================
-- 表: submissions (提交记录)
-- =========================
CREATE TABLE submissions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_code    TEXT UNIQUE NOT NULL,                              -- 公开编号，SUB-XXXXXXXX
    user_id        UUID NOT NULL REFERENCES auth.users(id),
    assignment_id  UUID NOT NULL REFERENCES assignments(id),
    code_text      TEXT NOT NULL,                                    -- 提交的代码内容
    code_hash      TEXT NOT NULL,                                    -- 代码 SHA256 哈希
    attempt_no     INTEGER NOT NULL DEFAULT 1,                       -- 提交序号（自动计算）
    metadata       JSONB DEFAULT '{}'::jsonb,                        -- 额外元数据（如迟交标记）
    created_at     TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT fk_submissions_profile FOREIGN KEY (user_id) REFERENCES profiles(user_id)
);

COMMENT ON TABLE  submissions              IS '代码提交记录表（不可变）';
COMMENT ON COLUMN submissions.public_code  IS '公开编号，格式 SUB-XXXXXXXX';
COMMENT ON COLUMN submissions.code_text    IS '提交的代码内容，插入后不可修改';
COMMENT ON COLUMN submissions.code_hash    IS '代码内容的 SHA256 哈希值';
COMMENT ON COLUMN submissions.attempt_no   IS '提交序号，同一用户对同一作业的第 N 次提交';
COMMENT ON COLUMN submissions.metadata     IS '额外元数据，如是否迟交等';

-- 触发器: 插入前自动生成 public_code
CREATE TRIGGER trg_submissions_generate_public_code
    BEFORE INSERT ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION generate_submission_public_code();

-- 触发器: 插入前自动计算 attempt_no
CREATE TRIGGER trg_submissions_compute_attempt_no
    BEFORE INSERT ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION compute_submission_attempt_no();

-- =========================
-- 函数: 防止修改提交的不可变字段
-- =========================
-- code_text, code_hash, user_id 一旦插入不可修改
CREATE OR REPLACE FUNCTION prevent_submission_immutable_update()
RETURNS TRIGGER AS $$
BEGIN
    -- 检查不可变字段是否被修改
    IF NEW.code_text IS DISTINCT FROM OLD.code_text THEN
        RAISE EXCEPTION '提交代码内容（code_text）不可修改';
    END IF;

    IF NEW.code_hash IS DISTINCT FROM OLD.code_hash THEN
        RAISE EXCEPTION '代码哈希值（code_hash）不可修改';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION '提交者（user_id）不可修改';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_submission_immutable_update()
    IS '防止修改提交记录中的不可变字段：code_text, code_hash, user_id';

-- 触发器: 更新前检查不可变字段
CREATE TRIGGER trg_submissions_prevent_immutable_update
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_submission_immutable_update();

-- =========================
-- 表: gradings (评分记录)
-- =========================
CREATE TABLE gradings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES submissions(id),
    status          TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'done', 'system_error')),
    score           INTEGER,                                         -- 评分（0-100）
    passed          BOOLEAN,                                         -- 是否通过
    report_json     JSONB,                                           -- 评测详细报告
    error_message   TEXT,                                            -- 系统错误信息
    started_at      TIMESTAMPTZ,                                     -- 评测开始时间
    finished_at     TIMESTAMPTZ,                                     -- 评测结束时间
    runner_ref      TEXT,                                            -- 运行器引用（如 GitHub Action Run ID）
    created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  gradings               IS '评分/评测记录表';
COMMENT ON COLUMN gradings.status        IS '评测状态：queued / running / done / system_error';
COMMENT ON COLUMN gradings.report_json   IS '评测详细报告（JSON 格式）';
COMMENT ON COLUMN gradings.runner_ref    IS '运行器引用，如 GitHub Actions Run ID';

-- =========================
-- 表: grade_audits (评分审计日志)
-- =========================
-- 记录教师手动修改评分或发起重判的操作
CREATE TABLE grade_audits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grading_id     UUID NOT NULL REFERENCES gradings(id),
    submission_id  UUID REFERENCES submissions(id),
    actor_id       UUID NOT NULL REFERENCES auth.users(id),             -- 操作人
    old_score      INTEGER,                                             -- 修改前分数
    new_score      INTEGER,                                             -- 修改后分数
    reason         TEXT NOT NULL,                                       -- 修改原因
    created_at     TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  grade_audits               IS '评分审计日志，记录手动修改评分或重判操作';
COMMENT ON COLUMN grade_audits.grading_id    IS '关联的评分记录';
COMMENT ON COLUMN grade_audits.submission_id IS '关联的提交记录';
COMMENT ON COLUMN grade_audits.actor_id      IS '执行修改操作的用户';
COMMENT ON COLUMN grade_audits.reason        IS '修改原因（必填）';

-- =========================
-- 触发器: profiles.updated_at 自动更新
-- =========================
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_profiles_updated_at();

-- =========================
-- 索引: 提升常见查询性能
-- =========================
-- 按用户查找提交
CREATE INDEX idx_submissions_user_id ON submissions(user_id);
-- 按作业查找提交
CREATE INDEX idx_submissions_assignment_id ON submissions(assignment_id);
-- 按用户+作业查找提交（覆盖 attempt_no 计算）
CREATE INDEX idx_submissions_user_assignment ON submissions(user_id, assignment_id);
-- 按提交查找评分
CREATE INDEX idx_gradings_submission_id ON gradings(submission_id);
-- 按课程查找作业
CREATE INDEX idx_assignments_course_id ON assignments(course_id);
-- 按课程查找选课关系
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
-- 按用户查找选课关系
CREATE INDEX idx_enrollments_user_id ON enrollments(user_id);

-- =========================
-- 触发器: 新注册用户自动创建 profiles 记录
-- =========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, student_no, display_name, role)
    VALUES (
        NEW.id,
        NULLIF(TRIM(NEW.raw_user_meta_data->>'student_no'), ''),
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''), NEW.email, '新用户'),
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'student')
    )
    ON CONFLICT (user_id) DO UPDATE SET
        student_no = COALESCE(EXCLUDED.student_no, profiles.student_no),
        display_name = COALESCE(EXCLUDED.display_name, profiles.display_name);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 关联到 auth.users 表
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

