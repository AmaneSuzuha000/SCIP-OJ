"""Submission quota must be enforced in PostgreSQL, not a spoofable browser."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SubmissionQuotaContract(unittest.TestCase):
    def test_trigger_serializes_rate_limits_and_unique_attempts(self):
        sql = (ROOT / "supabase/migrations/010_submission_atomic_quota.sql").read_text()
        for required in [
            "CREATE OR REPLACE FUNCTION public.compute_submission_attempt_no()",
            "pg_advisory_xact_lock(", "NEW.created_at := v_now",
            "SUBMISSION_RATE_LIMIT_COOLDOWN",
            "SUBMISSION_RATE_LIMIT_HOURLY",
            "SUBMISSION_RATE_LIMIT_DAILY",
            "coalesce(max(s.attempt_no),0) + 1",
            "UNIQUE INDEX IF NOT EXISTS uq_submissions_user_assignment_attempt",
        ]:
            self.assertIn(required, sql)
        self.assertNotIn("COUNT(*) + 1", sql)

    def test_submit_api_returns_429_for_database_quota_failure(self):
        edge = (ROOT / "supabase/functions/submit-assignment/index.ts").read_text()
        shared = (ROOT / "supabase/functions/_shared/grading.ts").read_text()
        self.assertIn("errorResponse(message, 429, quotaReason)", shared)
        self.assertIn("new TextEncoder().encode(code_text).byteLength", edge)


if __name__ == "__main__":
    unittest.main()
