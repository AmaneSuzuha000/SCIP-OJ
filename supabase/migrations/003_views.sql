-- ============================================================
-- 003_views.sql
-- SCIP-OJ 视图定义
-- ============================================================

-- =========================
-- 视图: course_gradebook (课程成绩簿)
-- =========================
-- 展示每个课程中每位学生的每道作业的最优成绩
-- 根据作业的 score_policy 决定取分逻辑：
--   - highest_before_due: 截止时间前提交中的最高分（默认）
--   - highest:            所有提交中的最高分（忽略截止时间）
--   - latest:             最新一次提交的分数
-- ============================================================

CREATE OR REPLACE VIEW course_gradebook AS
WITH ranked_scores AS (
    -- 将每个学生对每道作业的所有已评测提交汇总
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
        -- 按计分策略排序：
        --   highest / highest_before_due → 分数降序
        --   latest → 提交时间降序
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
                END DESC NULLS LAST
        ) AS rn
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN gradings g ON g.submission_id = s.id
    WHERE g.status = 'done'
      -- 根据 score_policy 过滤：highest_before_due 仅取截止前的提交
      AND (
          a.score_policy != 'highest_before_due'
          OR a.due_at IS NULL
          OR s.created_at <= a.due_at
      )
),
-- 汇总统计
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
    AND rs.rn = 1                                -- 仅取排名第一的成绩
LEFT JOIN submission_stats ss
    ON  ss.user_id = e.user_id
    AND ss.assignment_id = a.id
WHERE e.role = 'student'                         -- 仅学生（非教师）
  AND a.course_id = e.course_id;                 -- 匹配同一课程

COMMENT ON VIEW course_gradebook IS
    '课程成绩簿视图：展示每位学生每道作业的最优成绩、最高分对应提交 ID、提交次数、最近提交时间';
