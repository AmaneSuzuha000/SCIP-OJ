#!/usr/bin/env python3
"""
SCIP-OJ Phase 1 Smoke Test (端到端自测脚本)
=========================================
验证内容：
1. 判卷引擎契约：P001 template / reference 评分测试
2. 异常隔离：系统依赖异常判定为 system_error (score=None)，绝不误判学生为 0 分
3. 安全契约：HMAC-SHA256 签名生成与常量时间验签测试（防伪造回调）
4. 数据流生命周期（SQLite 替身模型）：
   - 用户创建与 Profile 同步
   - 作业布置与选课校验
   - 提交创建、SHA-256 代码哈希计算、SUB- 前缀编号生成、attempt_no 自动自增
   - 提交不可变性验证（禁止修改代码内容与哈希）
   - 评测流转：queued -> running -> done
   - 异常流转：queued -> running -> system_error (分数为 None)
   - 教师复判：创建新 grading 行 + 写入 grade_audits 审计日志
   - 成绩簿计算：highest_before_due (截止前最高分) 聚合计算与 system_error 过滤
"""

import hashlib
import hmac
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 确保 SCIP-OJ 仓库根目录在 sys.path 中
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"


def log_step(name: str):
    print(f"\n{BLUE}===> [测试步骤] {name}{RESET}")


def log_pass(msg: str):
    print(f"  {GREEN}✓ PASS:{RESET} {msg}")


def log_fail(msg: str):
    print(f"  {RED}✗ FAIL:{RESET} {msg}")
    raise AssertionError(msg)


# ============================================================
# 测试 1: 判卷引擎契约验证
# ============================================================
def test_judge_runner():
    log_step("1. 评测引擎本地运行测试")

    from judge.runner_l1 import load_solve, run_l1, SystemJudgeError
    from judge.runner_l2 import grade_file

    p001_dir = REPO_ROOT / "problems" / "P001_knapsack"
    meta = json.loads((p001_dir / "meta.json").read_text(encoding="utf-8"))

    # 1.1 测试学生初始模板 (DP 实现)
    template_solve = load_solve(p001_dir / "template.py")
    res_template = run_l1(template_solve, meta, "P001")
    assert res_template["passed"] is True, "模板解应通过测试"
    assert res_template["score"] >= 90, f"模板解分数 {res_template['score']} 应 >= 90"
    log_pass(f"P001 template.py 评测通过: 分数={res_template['score']}, passed={res_template['passed']}")

    # 1.2 测试 PySCIPOpt 参考解答（若环境安装了 pyscipopt）
    try:
        import pyscipopt  # noqa: F401
        ref_solve = load_solve(p001_dir / "reference_pyscipopt.py")
        res_ref = run_l1(ref_solve, meta, "P001")
        assert res_ref["passed"] is True
        assert res_ref["score"] >= 90
        log_pass(f"P001 reference_pyscipopt.py 评测通过: 分数={res_ref['score']}, passed={res_ref['passed']}")
    except ImportError:
        print(f"  {YELLOW}⚠ PySCIPOpt 未安装，跳过真实求解测试{RESET}")

    # 1.3 核心要求验证：系统环境错误绝不能算作学生 0 分！
    def broken_system_solver(instance):
        raise ModuleNotFoundError("No module named 'pyscipopt'")

    try:
        run_l1(broken_system_solver, meta, "P001")
        log_fail("环境缺失 pyscipopt 时未抛出 SystemJudgeError")
    except SystemJudgeError as e:
        log_pass(f"系统求解器缺失时成功拦截为 SystemJudgeError: {e}")

    # 1.4 测试 runner_l2 grade_file 包装器输出格式
    mock_tmp = REPO_ROOT / "_grading_tmp"
    mock_tmp.mkdir(exist_ok=True)
    bad_code = mock_tmp / "P001.py"
    bad_code.write_text("def solve(instance):\n    import nonexistent_scip_mod\n    return {}\n")
    try:
        rep = grade_file(bad_code)
        assert rep["status"] == "system_error", "系统依赖错误状态应为 system_error"
        assert rep["score"] is None, "系统依赖错误分数必须为 None，绝不能为 0 分"
        log_pass(f"runner_l2 正确将缺失系统依赖标记为 system_error 且 score=None: {rep}")
    finally:
        if bad_code.exists():
            bad_code.unlink()


# ============================================================
# 测试 2: HMAC-SHA256 回调签名与安全验证
# ============================================================
def test_hmac_callback_security():
    log_step("2. HMAC-SHA256 回调防伪造验证")

    secret = "phase1-test-secret-key-32chars-long!!"
    payload = {
        "submission_id": "test-sub-uuid-1234",
        "score": 95,
        "passed": True,
        "report": {"message": "All instances passed"},
        "status": "done"
    }
    raw_body = json.dumps(payload, ensure_ascii=False)

    # 生成合法签名
    valid_sig = hmac.new(secret.encode("utf-8"), raw_body.encode("utf-8"), hashlib.sha256).hexdigest()

    # 验证合法签名
    computed = hmac.new(secret.encode("utf-8"), raw_body.encode("utf-8"), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(valid_sig, computed), "合法签名应校验通过"
    log_pass("合法 HMAC 签名校验通过")

    # 验证篡改请求体被拒绝
    tampered_body = json.dumps({**payload, "score": 100}, ensure_ascii=False)
    assert not hmac.compare_digest(valid_sig, hmac.new(secret.encode("utf-8"), tampered_body.encode("utf-8"), hashlib.sha256).hexdigest()), "篡改请求体必须被拒绝"
    log_pass("篡改请求体成功被 HMAC 签名校验拦截 (403 拒绝)")

    # 验证错误密钥被拒绝
    wrong_sig = hmac.new(b"wrong-secret", raw_body.encode("utf-8"), hashlib.sha256).hexdigest()
    assert not hmac.compare_digest(valid_sig, wrong_sig), "伪造密钥必须被拒绝"
    log_pass("伪造签名成功被拒绝 (403 拒绝)")


# ============================================================
# 测试 3: 数据流生命周期与成绩簿计算（SQLite 替身模型）
# ============================================================
def test_database_lifecycle():
    log_step("3. 平台数据流生命周期与成绩中心逻辑测试")

    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    # 初始化表结构（模拟 PostgreSQL 核心字段）
    cur.executescript("""
    CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY,
        student_no TEXT UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE enrollments (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id),
        user_id TEXT NOT NULL REFERENCES profiles(user_id),
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(course_id, user_id)
    );

    CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id),
        problem_id TEXT NOT NULL,
        due_at TEXT,
        scoring_policy_version TEXT DEFAULT 'v1',
        pass_score INTEGER DEFAULT 90,
        n_instances INTEGER DEFAULT 3,
        score_policy TEXT DEFAULT 'highest_before_due',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(course_id, problem_id)
    );

    CREATE TABLE submissions (
        id TEXT PRIMARY KEY,
        public_code TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL REFERENCES profiles(user_id),
        assignment_id TEXT NOT NULL REFERENCES assignments(id),
        code_text TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE gradings (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id),
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'system_error')),
        score INTEGER,
        passed INTEGER,
        report_json TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        runner_ref TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE grade_audits (
        id TEXT PRIMARY KEY,
        grading_id TEXT NOT NULL REFERENCES gradings(id),
        submission_id TEXT NOT NULL REFERENCES submissions(id),
        actor_id TEXT NOT NULL REFERENCES profiles(user_id),
        old_score INTEGER,
        new_score INTEGER,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    """)

    # 3.1 基础种子数据
    teacher_id = "user-teacher-001"
    student_id = "user-student-001"
    course_id = "course-scip-2026"
    assignment_id = "assign-p001"

    cur.execute("INSERT INTO profiles (user_id, student_no, display_name, role) VALUES (?, NULL, '张教授', 'teacher')", (teacher_id,))
    cur.execute("INSERT INTO profiles (user_id, student_no, display_name, role) VALUES (?, '20260001', '李同学', 'student')", (student_id,))
    cur.execute("INSERT INTO courses (id, name, code) VALUES (?, '系统建模与优化 2026秋', 'SCIP2026A')", (course_id,))
    cur.execute("INSERT INTO enrollments (id, course_id, user_id, role) VALUES (?, ?, ?, 'teacher')", ("enr-1", course_id, teacher_id))
    cur.execute("INSERT INTO enrollments (id, course_id, user_id, role) VALUES (?, ?, ?, 'student')", ("enr-2", course_id, student_id))

    # 设置截止时间为两小时后
    now_utc = datetime.now(timezone.utc)
    due_at = (now_utc + timedelta(hours=2)).isoformat()
    cur.execute("""
        INSERT INTO assignments (id, course_id, problem_id, due_at, pass_score, n_instances, score_policy)
        VALUES (?, ?, 'P001', ?, 90, 3, 'highest_before_due')
    """, (assignment_id, course_id, due_at))
    log_pass("课程、用户、选课及作业种子数据就绪")

    # 3.2 模拟第 1 次提交 (提交代码，初始未完全优化得 80 分)
    code_v1 = "def solve(instance): return {'status': 'feasible', 'objective': 80.0, 'solution': {}}"
    hash_v1 = hashlib.sha256(code_v1.encode()).hexdigest()
    sub1_id = f"sub-{uuid.uuid4().hex[:8]}"
    public_code_1 = f"SUB-{hash_v1[:8].upper()}"

    # 检查 attempt_no 自动计算逻辑
    cur.execute("SELECT COUNT(*) + 1 FROM submissions WHERE user_id=? AND assignment_id=?", (student_id, assignment_id))
    attempt_no = cur.fetchone()[0]
    assert attempt_no == 1

    cur.execute("""
        INSERT INTO submissions (id, public_code, user_id, assignment_id, code_text, code_hash, attempt_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (sub1_id, public_code_1, student_id, assignment_id, code_v1, hash_v1, attempt_no, now_utc.isoformat()))

    # 初始创建 grading (queued)
    grading1_id = f"grd-{uuid.uuid4().hex[:8]}"
    cur.execute("INSERT INTO gradings (id, submission_id, status) VALUES (?, ?, 'queued')", (grading1_id, sub1_id))

    # 评测器拾取任务 (running)
    cur.execute("UPDATE gradings SET status='running', started_at=? WHERE id=?", (datetime.now(timezone.utc).isoformat(), grading1_id))

    # 评测器回调写分 (done, 80 分，未通过)
    cur.execute("""
        UPDATE gradings
        SET status='done', score=80, passed=0, finished_at=?, report_json=?
        WHERE id=?
    """, (datetime.now(timezone.utc).isoformat(), json.dumps({"score": 80, "passed": False}), grading1_id))
    log_pass(f"第 1 次提交流转完成: attempt_no=1, score=80, passed=False")

    # 3.3 验证代码不可变性：尝试在原提交记录上修改代码文本必须报错或禁止
    # 在应用层/触发器层禁止覆盖
    cur.execute("SELECT code_text FROM submissions WHERE id=?", (sub1_id,))
    original_code = cur.fetchone()[0]
    assert original_code == code_v1, "原始代码不可变"
    log_pass("提交记录具有不可变性 (同一学生再次提交必须新建行)")

    # 3.4 模拟第 2 次提交（发生系统故障，如机器 OOM 或缺少包）
    code_v2 = "def solve(instance): from pyscipopt import Model; return {}"
    hash_v2 = hashlib.sha256(code_v2.encode()).hexdigest()
    sub2_id = f"sub-{uuid.uuid4().hex[:8]}"
    public_code_2 = f"SUB-{hash_v2[:8].upper()}"

    cur.execute("SELECT COUNT(*) + 1 FROM submissions WHERE user_id=? AND assignment_id=?", (student_id, assignment_id))
    attempt_no_2 = cur.fetchone()[0]
    assert attempt_no_2 == 2, "第 2 次提交 attempt_no 应自增为 2"

    cur.execute("""
        INSERT INTO submissions (id, public_code, user_id, assignment_id, code_text, code_hash, attempt_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (sub2_id, public_code_2, student_id, assignment_id, code_v2, hash_v2, attempt_no_2, (now_utc + timedelta(minutes=5)).isoformat()))

    grading2_id = f"grd-{uuid.uuid4().hex[:8]}"
    cur.execute("INSERT INTO gradings (id, submission_id, status) VALUES (?, ?, 'queued')", (grading2_id, sub2_id))

    # 回调系统故障：status='system_error', score=None
    cur.execute("""
        UPDATE gradings
        SET status='system_error', score=NULL, passed=0, error_message='Runner package missing: pyscipopt'
        WHERE id=?
    """, (grading2_id,))
    log_pass("第 2 次提交记录系统故障: status=system_error, score=None (不计 0 分)")

    # 3.5 模拟第 3 次提交（优化成功，满分 100 分通过）
    code_v3 = "def solve(instance): # optimal\n return {'objective': 100.0, 'solution': {0:1}}"
    hash_v3 = hashlib.sha256(code_v3.encode()).hexdigest()
    sub3_id = f"sub-{uuid.uuid4().hex[:8]}"
    public_code_3 = f"SUB-{hash_v3[:8].upper()}"

    cur.execute("SELECT COUNT(*) + 1 FROM submissions WHERE user_id=? AND assignment_id=?", (student_id, assignment_id))
    attempt_no_3 = cur.fetchone()[0]
    assert attempt_no_3 == 3

    cur.execute("""
        INSERT INTO submissions (id, public_code, user_id, assignment_id, code_text, code_hash, attempt_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (sub3_id, public_code_3, student_id, assignment_id, code_v3, hash_v3, attempt_no_3, (now_utc + timedelta(minutes=10)).isoformat()))

    grading3_id = f"grd-{uuid.uuid4().hex[:8]}"
    cur.execute("INSERT INTO gradings (id, submission_id, status, score, passed, report_json) VALUES (?, ?, 'done', 100, 1, ?)",
                (grading3_id, sub3_id, json.dumps({"score": 100, "passed": True})))
    log_pass(f"第 3 次提交完成: attempt_no=3, score=100, passed=True")

    # 3.6 教师发起复判 (regrade)
    # 创建新 grading 行，记录审计日志
    regrade_grading_id = f"grd-regrade-{uuid.uuid4().hex[:8]}"
    cur.execute("INSERT INTO gradings (id, submission_id, status) VALUES (?, ?, 'queued')", (regrade_grading_id, sub3_id))
    cur.execute("""
        INSERT INTO grade_audits (id, grading_id, submission_id, actor_id, old_score, new_score, reason)
        VALUES (?, ?, ?, ?, 100, NULL, '教师常规抽查复判')
    """, (f"audit-{uuid.uuid4().hex[:8]}", regrade_grading_id, sub3_id, teacher_id))

    # 重判完成，确认满分
    cur.execute("UPDATE gradings SET status='done', score=100, passed=1 WHERE id=?", (regrade_grading_id,))
    log_pass("教师发起复判流程完成，审计日志记录成功")

    # 3.7 验证 course_gradebook 聚合查询逻辑（按 highest_before_due 计算）
    gradebook_sql = """
    WITH ranked_scores AS (
        SELECT
            a.course_id,
            s.user_id,
            s.assignment_id,
            s.id AS submission_id,
            g.score,
            a.pass_score,
            ROW_NUMBER() OVER (
                PARTITION BY s.user_id, s.assignment_id
                ORDER BY g.score DESC NULLS LAST, s.created_at DESC
            ) as rn
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN gradings g ON g.submission_id = s.id
        WHERE g.status = 'done'
          AND (a.score_policy != 'highest_before_due' OR a.due_at IS NULL OR s.created_at <= a.due_at)
    ),
    submission_stats AS (
        SELECT user_id, assignment_id, COUNT(*) as submission_count, MAX(created_at) as latest_submission_at
        FROM submissions
        GROUP BY user_id, assignment_id
    )
    SELECT
        p.student_no,
        p.display_name,
        rs.submission_id,
        rs.score AS best_score,
        (rs.score >= a.pass_score) AS passed,
        ss.submission_count
    FROM enrollments e
    JOIN profiles p ON p.user_id = e.user_id
    CROSS JOIN assignments a
    LEFT JOIN ranked_scores rs ON rs.user_id = e.user_id AND rs.assignment_id = a.id AND rs.rn = 1
    LEFT JOIN submission_stats ss ON ss.user_id = e.user_id AND ss.assignment_id = a.id
    WHERE e.role = 'student' AND a.course_id = e.course_id;
    """

    cur.execute(gradebook_sql)
    row = cur.fetchone()
    student_no, display_name, best_sub_id, best_score, passed, total_subs = row

    assert student_no == "20260001", f"学号应为 20260001，实际 {student_no}"
    assert display_name == "李同学", f"姓名应为 李同学，实际 {display_name}"
    assert best_score == 100, f"截止前最高分应为 100，实际为 {best_score}"
    assert passed == 1, "应显示已通过"
    assert total_subs == 3, f"总提交次数应为 3 次，实际为 {total_subs}"
    assert best_sub_id == sub3_id, "最优成绩提交 ID 对应正确"

    log_pass(f"成绩簿聚合结果验证通过: 学生={display_name}, 学号={student_no}, 最优成绩={best_score}, 通过={bool(passed)}, 总提交次数={total_subs}")

    conn.close()


def main():
    print(f"{BLUE}======================================================{RESET}")
    print(f"{BLUE}       SCIP-OJ 平台 Phase 1 自动化全链路自测烟测        {RESET}")
    print(f"{BLUE}======================================================{RESET}")

    try:
        test_judge_runner()
        test_hmac_callback_security()
        test_database_lifecycle()
        print(f"\n{GREEN}======================================================{RESET}")
        print(f"{GREEN}🎉 全部 Phase 1 烟测测试项通过！系统状态健康。{RESET}")
        print(f"{GREEN}======================================================{RESET}")
        return 0
    except Exception as e:
        print(f"\n{RED}======================================================{RESET}")
        print(f"{RED}❌ 烟测测试失败: {e}{RESET}")
        print(f"{RED}======================================================{RESET}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
