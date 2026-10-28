import {state} from './state.js';
import {readPages} from './pagination.js';
import {refreshEnrollments} from './auth.js';
import {showToast} from './dialogs.js';
export // ── 课程选课与邀请码 ──
function notifyEnrollmentsChanged() {
    try {
        document.dispatchEvent(new CustomEvent("scipoj:enrollments-changed"));
    }
    catch (e) { /* CustomEvent 不可用时忽略 */ }
}
export async function joinCourse(inviteCode) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录平台账号");
    const code = (inviteCode || "").trim();
    if (!code)
        throw new Error("请输入有效的课程邀请码");
    if (code.length > 64)
        throw new Error("邀请码格式不正确");
    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await state.supabase.auth.getSession();
    if (!session)
        throw new Error("登录会话已失效，请重新登录");
    let lastError = null;
    // 1. 优先调用 Edge Function: join-course
    try {
        const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/join-course`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ invite_code: code }),
        });
        if (resp.ok) {
            const json = await resp.json();
            await refreshEnrollments();
            notifyEnrollmentsChanged();
            showToast(json.message || "选课成功！", "success");
            return json;
        }
        // 404 = Edge Function 未部署，继续尝试 RPC；其余错误直接呈现给用户
        if (resp.status !== 404) {
            const errJson = await resp.json().catch(() => ({}));
            throw new Error(errJson.error || `选课失败 (HTTP ${resp.status})`);
        }
    }
    catch (e) {
        if (e.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(e.message || "")) {
            lastError = e; // 网络/CORS 问题，继续尝试 RPC
        }
        else {
            throw e;
        }
    }
    // 2. 回退 Supabase RPC: join_course_by_code（SECURITY DEFINER，受服务端校验）
    try {
        const { data, error } = await state.supabase.rpc("join_course_by_code", { p_code: code });
        if (error) {
            lastError = new Error(error.message || "选课服务调用失败");
        }
        else if (data) {
            if (!data.ok)
                throw new Error(data.error || "加入课程失败");
            await refreshEnrollments();
            notifyEnrollmentsChanged();
            showToast(data.message || "加入课程成功！", "success");
            return data;
        }
    }
    catch (rpcErr) {
        // 函数不存在（未执行 004/005 迁移）时给出明确提示，而不是误报“邀请码无效”
        if (/function .* does not exist|not found/i.test(rpcErr.message || "")) {
            lastError = rpcErr;
        }
        else {
            throw rpcErr;
        }
    }
    // 3. 不再直接写 enrollments 表：RLS 未开放学生 INSERT，直写必然失败且会
    //    把“服务未部署/网络异常”误报成“邀请码无效”。
    if (lastError) {
        throw new Error("选课服务暂不可用，请联系任课教师或管理员检查后端部署（join-course / join_course_by_code）。");
    }
    throw new Error("邀请码无效或已过期，请向任课教师确认后重试");
}
export // ── 作业查询与正式提交 ──
async function getAssignmentForProblem(problemId, courseId = null) {
    if (!state.supabase)
        return null;
    try {
        let query = state.supabase.from("assignments")
            .select("*")
            .eq("problem_id", problemId);
        if (courseId) {
            query = query.eq("course_id", courseId);
        }
        else {
            // 只查询“我所在班级”的作业；否则会把他校/他班的作业误判为可提交，
            // 直到服务端返回 NOT_ENROLLED 才报错，体验与预期不符。
            const courseIds = state.currentEnrollments.map(e => e.course_id).filter(Boolean);
            if (courseIds.length === 0)
                return null;
            query = query.in("course_id", courseIds);
        }
        const { data, error } = await query
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            console.warn("[Platform] getAssignmentForProblem error:", error);
            return null;
        }
        return data;
    }
    catch (e) {
        console.warn("[Platform] getAssignmentForProblem exception:", e);
        return null;
    }
}
export // ── 教师功能 ──
async function getMyCourses() {
    return await refreshEnrollments();
}
export function isMissingRpcError(err) {
    const msg = String(err?.message || err || "");
    const code = String(err?.code || "");
    return code === "PGRST202" || code === "42883" || code === "404" ||
        /could not find the function|does not exist|schema cache/i.test(msg);
}
export function describeRpcError(err, action) {
    if (isMissingRpcError(err)) {
        const e = new Error(`服务端缺少「${action}」所需的数据库函数，请管理员执行 ${state.MIGRATION_006} 后重试`);
        e.missingRpc = true;
        e.code = err?.code;
        return e;
    }
    const e = new Error(`${action}失败：${err?.message || err || "未知错误"}`);
    e.code = err?.code;
    return e;
}
export async function getTeacherRoster(courseId) {
    if (!state.supabase)
        return [];
    // 通过受控 RPC 读取：006 起 course_gradebook 已撤销 authenticated 直接 SELECT，
    // 由数据库函数校验 is_teacher_of(course_id) 后返回本课程数据。
    let error;
    try {
        return await readPages(() => state.supabase.rpc('get_teacher_gradebook', {p_course_id:courseId})
            .order('user_id').order('assignment_id'));
    } catch (failure) { error = failure; }
    // 迁移 006 尚未执行时的兼容回退：旧版视图对 authenticated 仍可读。
    // 006 执行后 RPC 存在，不会再走这里。
    if (isMissingRpcError(error)) {
        console.warn("[Platform] get_teacher_gradebook 缺失，回退旧版视图查询（请尽快执行 006）");
        const legacy = await state.supabase.from("course_gradebook")
            .select("*")
            .eq("course_id", courseId);
        if (!legacy.error)
            return legacy.data || [];
        throw describeRpcError(error, "加载班级成绩簿");
    }
    throw describeRpcError(error, "加载班级成绩簿");
}
export async function getCourseInviteCode(courseId) {
    if (!state.supabase)
        return null;
    const { data, error } = await state.supabase.rpc("get_course_invite_code", { p_course_id: courseId });
    if (!error)
        return data || null;
    if (isMissingRpcError(error)) {
        // 006 之前 invite_code 列对 authenticated 可读；006 之后此回退会因列权限失败，
        // 但那时 RPC 已经存在，正常路径不会走到这里。
        const legacy = await state.supabase.from("courses")
            .select("invite_code")
            .eq("id", courseId)
            .maybeSingle();
        if (!legacy.error)
            return legacy.data?.invite_code || null;
    }
    throw describeRpcError(error, "读取课程邀请码");
}
export async function getLeaderboard(courseId, problemId = null, limit = 30) {
    if (!state.supabase)
        throw new Error("平台未配置云端服务");
    // 服务端 RPC 负责校验“本课程师生”并在返回前脱敏学号
    const { data, error } = await state.supabase.rpc("get_course_leaderboard", {
        p_course_id: courseId,
        p_problem_id: problemId || null,
    });
    if (!error) {
        return (data || []).slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
    }
    if (isMissingRpcError(error)) {
        // 006 未执行时的兼容回退：旧视图可读，前端脱敏后再展示。
        const legacy = await state.supabase.from("course_gradebook")
            .select("course_id, student_no, display_name, problem_id, best_score, passed, attempt_count, last_submitted_at")
            .eq("course_id", courseId)
            .not("best_score", "is", null)
            .order("best_score", { ascending: false })
            .limit(100);
        if (!legacy.error) {
            const rows = (legacy.data || []);
            const filtered = problemId
                ? rows.filter((r) => r.problem_id === problemId)
                : rows;
            const mask = (sno) => {
                const v = String(sno || "");
                return v.length < 6 ? "***" : v.slice(0, 4) + "****" + v.slice(-2);
            };
            return filtered.slice(0, Math.max(1, Math.min(100, Number(limit) || 30))).map((r) => ({
                course_id: r.course_id,
                problem_id: problemId ? r.problem_id : null,
                student_no_masked: mask(r.student_no),
                display_name: r.display_name,
                best_score: r.best_score,
                passed: r.passed,
                attempt_count: r.attempt_count,
                last_submitted_at: r.last_submitted_at,
            }));
        }
    }
    const err = describeRpcError(error, "查询排行榜");
    err.code = error.code;
    throw err;
}
export async function getPendingRoster(courseId) {
    if (!state.supabase)
        return [];
    try {
        const { data, error } = await state.supabase.from("roster_pending")
            .select("*")
            .eq("course_id", courseId)
            .order("student_no", { ascending: true });
        if (error) {
            console.warn("[Platform] getPendingRoster error:", error);
            throw new Error("加载花名册失败：" + (error.message || "数据库查询错误"));
        }
        return data || [];
    }
    catch (e) {
        if (e instanceof Error && e.message.startsWith("加载花名册失败"))
            throw e;
        console.warn("[Platform] getPendingRoster exception:", e);
        throw new Error("加载花名册失败，请稍后重试");
    }
}
export async function getVerifiedRoster(courseId) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录");
    const { data, error } = await state.supabase.rpc("get_course_verified_roster", { p_course_id: courseId });
    if (error)
        throw new Error("读取教师核验记录失败；请检查迁移 013 是否部署");
    return data || [];
}
export async function confirmRosterIdentity(rosterId, userId) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录");
    const { data, error } = await state.supabase.rpc("confirm_student_identity", {
        p_roster_id: rosterId, p_user_id: userId,
    });
    if (error || !data?.ok)
        throw new Error("身份核验失败：检查是否为本课程教师，学生是否已匹配并选课");
    return data;
}
export async function importRosterCSV(courseId, csvText) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录教师账号");
    if (!csvText || !csvText.trim())
        throw new Error("CSV 内容不能为空");
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0)
        throw new Error("未解析到任何有效数据行");
    const rows = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0 && (line.includes("学号") || line.toLowerCase().includes("student_no"))) {
            continue;
        }
        const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ""));
        if (parts.length < 2)
            continue;
        const student_no = parts[0];
        const display_name = parts[1];
        const github_login = parts[2] || null;
        if (student_no && display_name && !seen.has(student_no)) {
            seen.add(student_no);
            // 注意：不要携带 status，重复导入时保留已 matched 的状态
            rows.push({
                course_id: courseId,
                student_no,
                display_name,
                github_login,
            });
        }
    }
    if (rows.length === 0) {
        throw new Error("未从 CSV 中解析出有效学生记录（格式：学号, 真实姓名, 可选GitHub登录名）");
    }
    const { data, error } = await state.supabase.from("roster_pending")
        .upsert(rows, { onConflict: "course_id,student_no" })
        .select();
    if (error) {
        throw new Error("导入花名册失败: " + error.message);
    }
    return { total: rows.length, inserted: data ? data.length : rows.length };
}
export async function publishAssignment(params) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录教师账号");
    const { course_id, problem_id, due_at, pass_score = 90, n_instances = 3, score_policy = "highest_before_due", integrity_policy = "standard" } = params;
    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await state.supabase.auth.getSession();
    if (!session)
        throw new Error("登录会话已失效");
    try {
        const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/publish-assignment`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(params),
        });
        if (resp.ok) {
            const result = await resp.json();
            if (integrity_policy !== "standard" && result?.assignment?.integrity_policy !== integrity_policy) {
                throw new Error("服务器未保存考试模式。请先部署数据库迁移 009 和新版 publish-assignment 函数。");
            }
            return result;
        }
        else if (resp.status !== 404) {
            const json = await resp.json().catch(() => ({}));
            throw new Error(json.error || `发布失败 HTTP ${resp.status}`);
        }
    }
    catch (e) {
        if (!e.message.includes("HTTP 404") && !e.message.includes("Failed to fetch")) {
            throw e;
        }
    }
    // Exam policy requires the server-authorized Edge Function; no legacy fallback.
    if (integrity_policy !== "standard") {
        throw new Error("考试模式仅允许通过新版服务端发布接口，请管理员部署迁移 009 与 Edge Functions。");
    }
    // 回退直接写入 assignments 表
    const { data, error } = await state.supabase.from("assignments")
        .upsert({
        course_id,
        problem_id: problem_id.toUpperCase(),
        due_at: due_at ? new Date(due_at).toISOString() : null,
        pass_score: parseInt(pass_score, 10),
        n_instances: parseInt(n_instances, 10),
        score_policy,
    }, { onConflict: "course_id,problem_id" })
        .select()
        .single();
    if (error) {
        throw new Error("保存作业配置失败: " + error.message);
    }
    return { ok: true, assignment: data };
}
export async function rotateCourseInviteCode(courseId, newCode = null) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录");
    const requested = typeof newCode === "string" && newCode.trim()
        ? newCode.trim().toUpperCase() : null;
    if (requested && !/^[A-Z0-9_-]{4,32}$/.test(requested)) {
        throw new Error("邀请码格式必须为 4–32 位字母、数字、下划线或短横线");
    }
    // The RPC atomically revokes older student invitations and installs a
    // new, server-generated high-entropy code. Never fall back to direct
    // UPDATE/INSERT; a split request would re-enable revoked codes.
    const { data, error } = await state.supabase.rpc("rotate_course_invite_code", {
        p_course_id: courseId, p_new_code: requested,
    });
    if (error) {
        if (error.code === "23505")
            throw new Error("该邀请码已被使用，请更换后重试");
        if (error.code === "42501")
            throw new Error("只有本课程教师可以轮换邀请码");
        throw new Error("邀请码轮换失败（请检查数据库迁移 012 是否已部署）");
    }
    if (typeof data !== "string" || !data) {
        throw new Error("服务器没有返回新的邀请码，轮换结果不可确认");
    }
    await refreshEnrollments();
    return data;
}
