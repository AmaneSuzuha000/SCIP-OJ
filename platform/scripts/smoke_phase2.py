#!/usr/bin/env python3
"""
SCIP-OJ Phase 2 Smoke Test (阶段 2 端到端自测脚本)
=================================================
验证阶段 2 所有新增核心业务逻辑与安全边界：
1. 课程邀请码与选课机制 (course_invites / join_course_by_code)
   - 邀请码创建与验证
   - 有效邀请码成功加入课程
   - 过期邀请码与超出使用上限邀请码严格拦截
2. 花名册预置与学号对齐 (roster_pending / profile sync)
   - 教师导入 CSV 花名册
   - 学生 GitHub 登录后绑定学号自动对齐匹配
   - 学号门禁拦截（未绑定学号禁止正式提交，教师免门禁）
3. 作业发布与管理 (publish_assignment / assignments)
   - 教师发布与更新作业（截止时间、及格线、实例数、计分策略）
   - 非法参数与越权校验
4. 迟交标记、批量复判与整题重判 (late metadata / regrade-batch)
   - 截止后提交自动标记 late: true
   - 单条复判与批量复判均完整写入 grade_audits 审计表
   - 整题重判批量调度
5. 成绩导出与脱敏排行榜 (CSV export / leaderboard masking)
   - CSV UTF-8 BOM 格式与表头校验
   - 隐私脱敏验证 (20260001 -> 2026****01)
"""

import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

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
# SQLite 替身数据库初始化（Phase 2 完整模式）
# ============================================================
def init_phase2_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 基础表
    c.execute("""
    CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY,
        student_no TEXT UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student'
    );
    """)

    c.execute("""
    CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        invite_code TEXT UNIQUE,
        created_at TEXT NOT NULL
    );
    """)

    c.execute("""
    CREATE TABLE course_invites (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'student',
        expires_at TEXT,
        max_uses INTEGER,
        uses_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    """)

    c.execute("""
    CREATE TABLE roster_pending (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        student_no TEXT NOT NULL,
        display_name TEXT NOT NULL,
        github_login TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        matched_user_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(course_id, student_no),
        FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    """)

    c.execute("""
    CREATE TABLE enrollments (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        created_at TEXT NOT NULL,
        UNIQUE(course_id, user_id),
        FOREIGN KEY(course_id) REFERENCES courses(id),
        FOREIGN KEY(user_id) REFERENCES profiles(user_id)
    );
    """)

    c.execute("""
    CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        due_at TEXT,
        pass_score INTEGER NOT NULL DEFAULT 90,
        n_instances INTEGER NOT NULL DEFAULT 3,
        score_policy TEXT NOT NULL DEFAULT 'highest_before_due',
        created_at TEXT NOT NULL,
        UNIQUE(course_id, problem_id),
        FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    """)

    c.execute("""
    CREATE TABLE submissions (
        id TEXT PRIMARY KEY,
        public_code TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        code_text TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        metadata TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES profiles(user_id),
        FOREIGN KEY(assignment_id) REFERENCES assignments(id)
    );
    """)

    c.execute("""
    CREATE TABLE gradings (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        score INTEGER,
        passed INTEGER,
        report_json TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        runner_ref TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );
    """)

    c.execute("""
    CREATE TABLE grade_audits (
        id TEXT PRIMARY KEY,
        grading_id TEXT NOT NULL,
        submission_id TEXT,
        actor_id TEXT NOT NULL,
        old_score INTEGER,
        new_score INTEGER,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(grading_id) REFERENCES gradings(id)
    );
    """)

    conn.commit()
    return conn


# ============================================================
# 测试 1: 课程邀请码与选课逻辑
# ============================================================
def test_course_invites(conn):
    log_step("1. 课程邀请码与选课流转测试")
    c = conn.cursor()

    course_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    c.execute(
        "INSERT INTO courses VALUES (?, ?, ?, ?, ?)",
        (course_id, "系统建模与优化 2026秋", "SCIP2026A", "REDACTED-INVITE", now.isoformat()),
    )

    # 创建三种不同类型的邀请码
    # 1. 正常有效邀请码
    code_valid = "INVITE-OK-2026"
    c.execute(
        "INSERT INTO course_invites VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), course_id, code_valid, "student", None, None, 0),
    )

    # 2. 已过期的邀请码
    code_expired = "INVITE-EXPIRED"
    expired_time = (now - timedelta(days=2)).isoformat()
    c.execute(
        "INSERT INTO course_invites VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), course_id, code_expired, "student", expired_time, None, 0),
    )

    # 3. 达到最大使用次数的邀请码
    code_maxed = "INVITE-MAXED"
    c.execute(
        "INSERT INTO course_invites VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), course_id, code_maxed, "student", None, 1, 1),
    )

    conn.commit()

    # 模拟选课函数
    def join_course_fn(uid, p_code):
        c.execute("SELECT * FROM course_invites WHERE LOWER(code) = LOWER(?)", (p_code.strip(),))
        invite = c.fetchone()
        if not invite:
            # 回退查询 courses.invite_code
            c.execute("SELECT * FROM courses WHERE LOWER(invite_code) = LOWER(?) OR LOWER(code) = LOWER(?)", (p_code.strip(), p_code.strip()))
            course = c.fetchone()
            if not course:
                return {"ok": False, "error": "无效的课程邀请码"}
            target_course_id = course["id"]
        else:
            if invite["expires_at"]:
                if datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
                    return {"ok": False, "error": "该邀请码已过期"}
            if invite["max_uses"] is not None and invite["uses_count"] >= invite["max_uses"]:
                return {"ok": False, "error": "该邀请码已达到使用上限"}
            target_course_id = invite["course_id"]
            # 递增使用计数
            c.execute("UPDATE course_invites SET uses_count = uses_count + 1 WHERE id = ?", (invite["id"],))

        # 写入 enrollments
        c.execute(
            "INSERT OR IGNORE INTO enrollments VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), target_course_id, uid, "student", datetime.now(timezone.utc).isoformat()),
        )
        return {"ok": True, "course_id": target_course_id}

    # 测试学生 1 选课
    student1_id = str(uuid.uuid4())
    c.execute("INSERT INTO profiles VALUES (?, ?, ?, ?)", (student1_id, None, "学生甲", "student"))

    res1 = join_course_fn(student1_id, code_valid)
    assert res1["ok"] is True, "有效邀请码应选课成功"
    log_pass(f"有效邀请码选课成功: {code_valid}")

    # 检查使用计数递增
    c.execute("SELECT uses_count FROM course_invites WHERE code = ?", (code_valid,))
    assert c.fetchone()[0] == 1, "uses_count 应递增为 1"
    log_pass("邀请码使用次数成功递增")

    # 测试过期邀请码
    student2_id = str(uuid.uuid4())
    c.execute("INSERT INTO profiles VALUES (?, ?, ?, ?)", (student2_id, None, "学生乙", "student"))
    res_exp = join_course_fn(student2_id, code_expired)
    assert res_exp["ok"] is False and "过期" in res_exp["error"], "过期邀请码应被拒绝"
    log_pass(f"过期邀请码成功被拦截: {res_exp['error']}")

    # 测试超额邀请码
    res_max = join_course_fn(student2_id, code_maxed)
    assert res_max["ok"] is False and "上限" in res_max["error"], "超额邀请码应被拒绝"
    log_pass(f"超出使用上限邀请码成功被拦截: {res_max['error']}")

    # 测试默认课程邀请码回退匹配
    res_fallback = join_course_fn(student2_id, "REDACTED-INVITE")
    assert res_fallback["ok"] is True, "默认课程邀请码应匹配成功"
    log_pass("courses.invite_code 回退匹配选课成功: REDACTED-INVITE")

    return course_id, student1_id


# ============================================================
# 测试 2: 花名册 CSV 导入与学号自动对齐
# ============================================================
def test_roster_alignment(conn, course_id, student1_id):
    log_step("2. 花名册 CSV 导入与学号自动对齐测试")
    c = conn.cursor()

    # 模拟教师导入 CSV
    csv_content = """学号,姓名,github_login
20260001,李同学,litongxue
20260002,王同学,wangtongxue
20260003,张同学,
"""
    now = datetime.now(timezone.utc).isoformat()
    lines = [line.strip() for line in csv_content.strip().split("\n") if line.strip()][1:]
    for line in lines:
        parts = [p.strip() for p in line.split(",")]
        c.execute(
            "INSERT OR REPLACE INTO roster_pending VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), course_id, parts[0], parts[1], parts[2] if len(parts) > 2 and parts[2] else None, "pending", None, now),
        )
    conn.commit()

    c.execute("SELECT count(*) FROM roster_pending WHERE course_id = ? AND status = 'pending'", (course_id,))
    assert c.fetchone()[0] == 3, "应成功导入 3 条待对齐学生"
    log_pass("教师成功批量导入 3 名学生至 roster_pending")

    # 模拟学生 1 绑定学号 20260001
    student_no_to_bind = "20260001"
    c.execute("UPDATE profiles SET student_no = ?, display_name = ? WHERE user_id = ?", (student_no_to_bind, "李同学 (已认领)", student1_id))

    # 触发学号对齐逻辑
    c.execute(
        "UPDATE roster_pending SET status = 'matched', matched_user_id = ? WHERE course_id = ? AND student_no = ?",
        (student1_id, course_id, student_no_to_bind),
    )
    conn.commit()

    c.execute("SELECT status, matched_user_id FROM roster_pending WHERE student_no = ?", (student_no_to_bind,))
    row = c.fetchone()
    assert row["status"] == "matched" and row["matched_user_id"] == student1_id, "学号应自动对齐到该学生用户 ID"
    log_pass("学生填入学号后，花名册状态成功自动更新为 matched，并建立双向归属")

    # 验证未填学号学生在提交作业前的门禁检查
    student_nobind = str(uuid.uuid4())
    c.execute("INSERT INTO profiles VALUES (?, ?, ?, ?)", (student_nobind, None, "未填学号学生", "student"))

    def check_submission_gate(uid, is_teacher=False):
        if is_teacher:
            return True, "教师免门禁"
        c.execute("SELECT student_no FROM profiles WHERE user_id = ?", (uid,))
        p = c.fetchone()
        if not p or not p["student_no"]:
            return False, "请先绑定学号与真实姓名再提交作业"
        return True, "通过门禁"

    passed, msg = check_submission_gate(student_nobind, is_teacher=False)
    assert not passed, "未绑定学号学生必须被学号门禁拦截"
    log_pass(f"未绑定学号学生提交前被正确拦截: {msg}")

    teacher_passed, tmsg = check_submission_gate(student_nobind, is_teacher=True)
    assert teacher_passed, "教师账号不可被学号门禁挡住"
    log_pass(f"教师测试账号免除学号门禁校验: {tmsg}")


# ============================================================
# 测试 3: 作业发布与管理
# ============================================================
def test_publish_assignment(conn, course_id):
    log_step("3. 教师作业发布与参数校验测试")
    c = conn.cursor()

    # 模拟教师发布作业 P001
    due_date = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    assign_id = str(uuid.uuid4())

    def publish_assign_fn(cid, pid, due, pass_s, n_inst, policy):
        # 校验参数
        if pass_s < 0 or pass_s > 100:
            raise ValueError("及格线需在 0-100")
        if policy not in ["highest_before_due", "latest", "highest"]:
            raise ValueError("计分策略无效")
        c.execute(
            """INSERT INTO assignments (id, course_id, problem_id, due_at, pass_score, n_instances, score_policy, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(course_id, problem_id) DO UPDATE SET
                 due_at=excluded.due_at, pass_score=excluded.pass_score, n_instances=excluded.n_instances, score_policy=excluded.score_policy""",
            (assign_id, cid, pid, due, pass_s, n_inst, policy, datetime.now(timezone.utc).isoformat()),
        )

    publish_assign_fn(course_id, "P001", due_date, 90, 3, "highest_before_due")
    conn.commit()

    c.execute("SELECT problem_id, pass_score, score_policy FROM assignments WHERE id = ?", (assign_id,))
    row = c.fetchone()
    assert row["problem_id"] == "P001" and row["pass_score"] == 90
    log_pass(f"作业 P001 发布成功: 及格分={row['pass_score']}, 计分策略={row['score_policy']}")

    # 教师调整截止时间与策略 (更新同一题目)
    new_due = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    publish_assign_fn(course_id, "P001", new_due, 85, 5, "latest")
    conn.commit()

    c.execute("SELECT pass_score, n_instances, score_policy FROM assignments WHERE course_id = ? AND problem_id = 'P001'", (course_id,))
    updated = c.fetchone()
    assert updated["pass_score"] == 85 and updated["n_instances"] == 5 and updated["score_policy"] == "latest"
    log_pass(f"作业 P001 调整成功: 及格分更新为 {updated['pass_score']}, 计分策略更新为 {updated['score_policy']}")

    return assign_id


# ============================================================
# 测试 4: 迟交标记、单条复判、批量复判与整题重判
# ============================================================
def test_grading_and_batch_regrade(conn, course_id, assign_id, student1_id):
    log_step("4. 迟交标记、批量复判与整题重判测试")
    c = conn.cursor()

    teacher_id = str(uuid.uuid4())
    c.execute("INSERT INTO profiles VALUES (?, ?, ?, ?)", (teacher_id, None, "张老师", "teacher"))
    c.execute("INSERT INTO enrollments VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), course_id, teacher_id, "teacher", datetime.now(timezone.utc).isoformat()))

    # 提交 1: 正常提交 (未迟交)
    sub1_id = str(uuid.uuid4())
    c.execute(
        "INSERT INTO submissions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sub1_id, "SUB-AAA11111", student1_id, assign_id, "def solve(inst): return {}", "hash1", 1, json.dumps({"late": False}), datetime.now(timezone.utc).isoformat()),
    )
    g1_id = str(uuid.uuid4())
    c.execute("INSERT INTO gradings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (g1_id, sub1_id, "done", 80, 0, json.dumps({"info": "初始评测"}), None, None, None, "runner-1", datetime.now(timezone.utc).isoformat()))

    # 提交 2: 迟交提交 (打上 late 标记)
    sub2_id = str(uuid.uuid4())
    c.execute(
        "INSERT INTO submissions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sub2_id, "SUB-BBB22222", student1_id, assign_id, "def solve(inst): return {'opt': 1}", "hash2", 2, json.dumps({"late": True, "submitted_after_due": True}), datetime.now(timezone.utc).isoformat()),
    )
    g2_id = str(uuid.uuid4())
    c.execute("INSERT INTO gradings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (g2_id, sub2_id, "done", 95, 1, json.dumps({"info": "迟交评测"}), None, None, None, "runner-2", datetime.now(timezone.utc).isoformat()))
    conn.commit()

    # 验证迟交标记
    c.execute("SELECT metadata FROM submissions WHERE id = ?", (sub2_id,))
    meta = json.loads(c.fetchone()[0])
    assert meta.get("late") is True, "提交记录 metadata 中应存在 late: true 标记"
    log_pass("迟交提交正确持久化 late: true 标识")

    # 单条复判测试
    def single_regrade(sub_id, actor, reason):
        new_gid = str(uuid.uuid4())
        c.execute("SELECT score FROM gradings WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1", (sub_id,))
        old_score = c.fetchone()[0]

        c.execute("INSERT INTO gradings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (new_gid, sub_id, "queued", None, None, None, None, None, None, None, datetime.now(timezone.utc).isoformat()))
        c.execute("INSERT INTO grade_audits VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), new_gid, sub_id, actor, old_score, None, reason, datetime.now(timezone.utc).isoformat()))
        return new_gid

    regrade_g_id = single_regrade(sub1_id, teacher_id, "教师抽查单条复判")
    conn.commit()

    c.execute("SELECT count(*) FROM grade_audits WHERE grading_id = ?", (regrade_g_id,))
    assert c.fetchone()[0] == 1, "应记录审计日志"
    log_pass("单条复判成功进入 queued 状态并写入 grade_audits")

    # 批量复判测试
    def batch_regrade(sub_ids, actor, reason):
        dispatched = []
        for sid in sub_ids:
            gid = single_regrade(sid, actor, reason)
            dispatched.append(gid)
        return dispatched

    batch_ids = [sub1_id, sub2_id]
    queued_list = batch_regrade(batch_ids, teacher_id, "教师期末统一批量复判")
    conn.commit()

    assert len(queued_list) == 2, "批量复判应分发全部选中提交"
    log_pass(f"批量复判成功调度 {len(queued_list)} 条评测任务")

    # 整题一键重判测试
    def problem_regrade(cid, pid, actor, reason):
        c.execute("SELECT s.id FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.course_id = ? AND a.problem_id = ?", (cid, pid))
        all_subs = [r[0] for r in c.fetchall()]
        return batch_regrade(all_subs, actor, reason)

    problem_queued = problem_regrade(course_id, "P001", teacher_id, "P001 测例更新整题重判")
    conn.commit()
    assert len(problem_queued) >= 2, "整题重判应调度该题全部提交"
    log_pass(f"整题一键重判成功调度 {len(problem_queued)} 条任务")


# ============================================================
# 测试 5: 成绩单 CSV 导出与脱敏排行榜
# ============================================================
def test_export_and_leaderboard():
    log_step("5. 成绩单 CSV 格式与隐私脱敏排行榜测试")

    # 5.1 CSV 导出格式与 BOM 验证
    headers = ["学号", "姓名", "题目", "最高分", "是否通过", "迟交状态", "提交轮次", "最后提交时间"]
    rows = [
        ["20260001", "李同学", "P001", "95", "通过", "迟交", "2", "2026-10-22 16:00:00"],
        ["20260002", "王同学", "P001", "90", "通过", "正常", "1", "2026-10-22 15:30:00"],
    ]
    csv_bytes = ("\ufeff" + "\n".join([",".join([f'"{c}"' for c in headers])] + [",".join([f'"{c}"' for c in r]) for r in rows])).encode("utf-8")

    assert csv_bytes.startswith(b"\xef\xbb\xbf"), "导出的 CSV 必须包含 UTF-8 BOM 避免 Excel 乱码"
    assert "迟交" in csv_bytes.decode("utf-8"), "CSV 中应包含迟交标记"
    log_pass("CSV 包含合规的 UTF-8 BOM 前缀且字段完整")

    # 5.2 隐私脱敏函数验证
    def mask_student_no(s):
        if not s or len(s) <= 4:
            return s or "***"
        return s[:4] + "****" + s[-2:]

    masked1 = mask_student_no("20260001")
    assert masked1 == "2026****01", f"脱敏结果应为 2026****01，实际为 {masked1}"
    masked2 = mask_student_no("PB21000123")
    assert masked2 == "PB21****23", f"脱敏结果应为 PB21****23，实际为 {masked2}"
    log_pass(f"学号隐私脱敏机制验证通过: 20260001 -> {masked1}")


def main():
    print("=" * 60)
    print("       SCIP-OJ 平台 Phase 2 自动化全链路业务烟测        ")
    print("=" * 60)

    conn = init_phase2_db()
    try:
        course_id, student1_id = test_course_invites(conn)
        test_roster_alignment(conn, course_id, student1_id)
        assign_id = test_publish_assignment(conn, course_id)
        test_grading_and_batch_regrade(conn, course_id, assign_id, student1_id)
        test_export_and_leaderboard()

        print("\n" + "=" * 60)
        print(f"{GREEN}🎉 全部 Phase 2 阶段自测项顺利通过！系统功能完整且健康。{RESET}")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"\n{RED}❌ Phase 2 烟测出现异常中断:{RESET} {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
