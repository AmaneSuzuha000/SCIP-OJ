"""Errors in trusted evaluation infrastructure, distinct from student failures."""
class SystemJudgeError(RuntimeError):
    """A system failure must not become a student's zero-point result."""
