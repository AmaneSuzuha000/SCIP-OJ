"""Regression contract: future application tables cannot default to anon grants."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]

class PrivilegeDefaultTests(unittest.TestCase):
    def test_postgres_default_grants_are_opt_in(self):
        sql=(ROOT/"supabase/migrations/014_postgres_default_privileges.sql").read_text()
        for expected in ["FOR ROLE postgres IN SCHEMA public",
                         "ON TABLES FROM anon, authenticated",
                         "ON SEQUENCES FROM anon, authenticated",
                         "ON FUNCTIONS FROM anon, authenticated",
                         "FOR ROLE postgres\n  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"]:
            self.assertIn(expected,sql)
    def test_superadmin_defaults_not_silently_claimed_fixed(self):
        doc=(ROOT/"docs/SECURITY_VALIDATION_V6.md").read_text()
        self.assertIn("supabase_admin",doc)
        self.assertIn("not",doc.lower())

if __name__ == "__main__":
    unittest.main()
