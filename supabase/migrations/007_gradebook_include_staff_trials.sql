-- 007: 成绩簿纳入教师/助教试交；排行榜仍仅学生
-- 已于 2026-10-22 应用到 scip-oj (epblgjexfkspizbbelbq)

DROP FUNCTION IF EXISTS public.get_teacher_gradebook(UUID);
DROP VIEW IF EXISTS public.course_gradebook;

CREATE VIEW public.course_gradebook AS
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
    e.role                              AS enroll_role,
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
WHERE a.course_id = e.course_id
  AND e.role IN ('student', 'teacher', 'ta', 'admin');

COMMENT ON VIEW public.course_gradebook IS
    '课程成绩簿：每位选课成员（含教师/助教试交）每道作业的最优成绩与提交统计；仅通过受控 RPC 访问';

REVOKE ALL ON public.course_gradebook FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_gradebook TO service_role;

CREATE OR REPLACE FUNCTION public.get_teacher_gradebook(p_course_id UUID)
RETURNS TABLE (
    course_id UUID,
    user_id UUID,
    enroll_role TEXT,
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
        g.enroll_role,
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
    IS '教师/助教读取本课程成绩簿（含教师试交）；非本课程教师返回空集';

-- 排行榜仍仅学生（见 apply 时同步的 get_course_leaderboard 过滤 enroll_role='student'）
-- 完整 leaderboard 定义已在线上与 006 同签名更新；此处保留注释以免重复大段 DDL 分叉。
-- 若全新环境从零 migrate，请确保 get_course_leaderboard 增加：AND g.enroll_role = 'student'
