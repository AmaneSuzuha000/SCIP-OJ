-- 009 / Opt-in exam-mode policy (source of truth: database, not browser).
-- Apply to Supabase before deploying updated Edge Functions.
-- Existing assignments remain 'standard'; historical scores are not touched.
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS integrity_policy TEXT NOT NULL DEFAULT 'standard'
  CHECK (integrity_policy IN ('standard', 'exam_warn', 'exam_block'));

COMMENT ON COLUMN public.assignments.integrity_policy IS
  'Exam UX deterrence (standard/exam_warn/exam_block). Client-reported signals are untrusted, never automatic misconduct proof.';
