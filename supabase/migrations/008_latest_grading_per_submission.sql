-- 008: Regrading must replace the prior grading of the same submission.
-- Manual deployment required: GitHub Pages Actions does not execute Supabase migrations.
-- Preserve view shape and ACLs via CREATE OR REPLACE; do not DROP dependent RPCs.

CREATE OR REPLACE VIEW public.course_gradebook AS
WITH latest_grading_per_submission AS (
    -- Choose the most recent successful grading for each submission first.
    -- A newer successful regrade supersedes its older higher score; queued/
    -- failed attempts do not erase the last valid result.
    SELECT DISTINCT ON (g.submission_id)
        g.submission_id, g.score, g.created_at, g.id
    FROM public.gradings g
    WHERE g.status = 'done' AND g.score IS NOT NULL
    ORDER BY g.submission_id, g.created_at DESC, g.id DESC
),
ranked_scores AS (
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
    JOIN latest_grading_per_submission g ON g.submission_id = s.id
    WHERE (
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
  '课程成绩簿：每个提交仅采用最新已完成评分，然后依作业计分策略选取有效成绩';

-- Existing get_teacher_gradebook(UUID) RPC and grants continue to read this view.
-- This migration does not normalize legacy 90-point scores to the new 100-point rubric.
