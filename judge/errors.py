"""Errors in trusted evaluation infrastructure, distinct from student failures."""
class SystemJudgeError(RuntimeError):
    """A system failure must not become a student's zero-point result."""


class JudgeConfigError(SystemJudgeError):
    """Problem configuration is self-contradictory or incomplete.

    Deriving from SystemJudgeError is deliberate: a misconfigured problem is an
    infrastructure fault, so it must surface as system_error and never be
    averaged into a submission's score.
    """
