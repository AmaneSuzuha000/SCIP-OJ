"""Problem-local entry; delegates to shared knapsack grader."""
from judge.common import grade_knapsack


def grade(result, instance, meta):
    return grade_knapsack(result, instance, meta)
