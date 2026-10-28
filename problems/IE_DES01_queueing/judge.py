"""Problem-local entry; delegates to shared ie_des01 grader."""
from judge.common import grade_ie_des01


def grade(result, instance, meta):
    return grade_ie_des01(result, instance, meta)
