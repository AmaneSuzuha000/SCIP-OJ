"""Problem-local entry; delegates to shared assignment grader."""
from judge.common import grade_assignment


def grade(result, instance, meta):
    return grade_assignment(result, instance, meta)
