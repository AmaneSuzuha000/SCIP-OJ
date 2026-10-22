"""Tests for the conservative, offline manual-review candidate finder."""
import importlib.util
from pathlib import Path
import unittest


PATH = Path(__file__).resolve().parents[1] / "platform/scripts/audit_similarity.py"
spec = importlib.util.spec_from_file_location("similarity_audit", PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_exact_same_code_different_students_flagged(self):
        code = "def solve(x):\n    return x * 2\n"
        rows = [
            {"id": "s1", "user_id": "u1", "assignment_id": "a1", "code_text": code},
            {"id": "s2", "user_id": "u2", "assignment_id": "a1", "code_text": code},
        ]
        flags = audit.candidates(rows)
        self.assertEqual(len(flags), 1)
        self.assertTrue(flags[0]["same_code_sha256"])
        self.assertEqual(flags[0]["review_status"], "manual_review_only")

    def test_not_compare_between_assignments_or_same_student(self):
        code = "def solve(x):\n    return x\n"
        rows = [
            {"id": "s1", "user_id": "u1", "assignment_id": "a1", "code_text": code},
            {"id": "s2", "user_id": "u1", "assignment_id": "a1", "code_text": code},
            {"id": "s3", "user_id": "u2", "assignment_id": "a2", "code_text": code},
        ]
        self.assertEqual(audit.candidates(rows), [])

    def test_identifier_changes_are_normalized(self):
        left = "def solve(item):\n    total = 0\n    for value in item:\n        if value > 2:\n            total += value\n    return total\n"
        right = "def solve(data):\n    answer = 0\n    for num in data:\n        if num > 2:\n            answer += num\n    return answer\n"
        self.assertEqual(audit.tokens(left), audit.tokens(right))
        rows = [
            {"id": "s1", "user_id": "u1", "assignment_id": "a1", "code_text": left},
            {"id": "s2", "user_id": "u2", "assignment_id": "a1", "code_text": right},
        ]
        self.assertEqual(len(audit.candidates(rows)), 1)

    def test_short_common_starter_not_used_as_similarity_proof(self):
        left = "def solve(instance):\n    return None\n"
        right = "def solve(data):\n    return 1\n"
        self.assertEqual(audit.candidates([
            {"id": "s1", "user_id": "u1", "assignment_id": "a1", "code_text": left},
            {"id": "s2", "user_id": "u2", "assignment_id": "a1", "code_text": right},
        ]), [])


if __name__ == "__main__":
    unittest.main()
