/**
 * SCIP-OJ 平台层 — Supabase 鉴权、选课、学号绑定、提交作业、成绩中心与教师管理
 * 依赖: window.SCIP_OJ_CONFIG (from config.js)
 * 核心安全边界:
 *   1. 绝不把正式成绩写到 localStorage，正式成绩只由服务端评测 + Postgres 持久化；
 *   2. 前端仅使用 anon key，严禁将 service_role / PAT / HMAC 密钥注入前端；
 *   3. 登录仅使用 GitHub OAuth；
 *   4. 学生无需自己开 PR / 看 Actions，仅通过平台交互。
 */

const ScipOJPlatform = (() => {
  let supabase = null;
  let currentUser = null;
  let currentProfile = null;
  let currentEnrollments = [];
  let enrollmentsLoadFailed = false;
  const authListeners = [];

  function isConfigured() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function isMockMode() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.MOCK_MODE);
  }

  // ── 初始化平台服务 ──
  async function init() {
    if (!isConfigured()) {
      console.log("[Platform] 未检测到 Supabase 配置，平台运行于离线练习模式（L1 WASM 练习正常可用）");
      updateAuthUI();
      showConfigWarning();
      return false;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      console.warn("[Platform] 未检测到 @supabase/supabase-js 库");
      updateAuthUI();
      showToast("平台脚本加载失败（supabase-js 未加载），正式作业功能暂不可用", "error");
      return false;
    }

    const cfg = window.SCIP_OJ_CONFIG;
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    try {
      // 恢复会话
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUser = session.user;
        await refreshProfile();
        await refreshEnrollments();
      }

      // 监听认证状态变更
      // 注意：Supabase 官方要求不要在 onAuthStateChange 回调内直接 await 其他
      // Supabase 查询（会持有 auth 锁导致死锁），这里用 setTimeout 跳出回调再刷新。
      supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        setTimeout(async () => {
          if (currentUser) {
            await refreshProfile();
            await refreshEnrollments();
            if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
              checkStudentGates();
            }
          } else {
            currentProfile = null;
            currentEnrollments = [];
          }
          updateAuthUI();
          notifyAuthListeners();
        }, 0);
      });
    } catch (e) {
      console.warn("[Platform] 会话恢复异常:", e);
    }

    updateAuthUI();
    if (currentUser) {
      checkStudentGates();
    }
    return true;
  }

  // ── 资料与选课刷新 ──
  async function refreshProfile() {
    if (!supabase || !currentUser) {
      currentProfile = null;
      return null;
    }
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, student_no, display_name, role")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (!error && data) {
        currentProfile = data;
      } else {
        const meta = currentUser.user_metadata || {};
        currentProfile = {
          user_id: currentUser.id,
          student_no: meta.student_no || null,
          display_name: meta.display_name || meta.user_name || meta.preferred_username || (currentUser.email ? currentUser.email.split("@")[0] : "GitHub 用户"),
          // 角色绝不从用户可控的 metadata 读取（GitHub OAuth 元数据不可信）
          role: "student",
        };
      }
    } catch (e) {
      console.warn("[Platform] 加载个人资料异常:", e);
    }
    return currentProfile;
  }

  async function refreshEnrollments() {
    if (!supabase || !currentUser) {
      currentEnrollments = [];
      return [];
    }
    try {
      const { data, error } = await supabase
        .from("enrollments")
        .select("id, course_id, role, courses(id, name, code)")
        .eq("user_id", currentUser.id);

      if (!error && data) {
        currentEnrollments = data;
        enrollmentsLoadFailed = false;
      } else {
        console.warn("[Platform] 加载选课关系失败:", error);
        currentEnrollments = [];
        enrollmentsLoadFailed = true;
      }
    } catch (e) {
      console.warn("[Platform] 加载选课关系异常:", e);
      currentEnrollments = [];
      enrollmentsLoadFailed = true;
    }
    return currentEnrollments;
  }

  function getUser() { return currentUser; }
  function getProfile() { return currentProfile; }
  function getSupabase() { return supabase; }
  function getEnrollments() { return currentEnrollments; }

  function isTeacher() {
    if (!currentUser) return false;
    if (currentProfile?.role === "teacher" || currentProfile?.role === "admin") return true;
    return currentEnrollments.some(e => e.role === "teacher" || e.role === "admin" || e.role === "ta");
  }

  function onAuthChange(fn) {
    if (typeof fn === "function") {
      authListeners.push(fn);
    }
  }

  function notifyAuthListeners() {
    authListeners.forEach((fn) => {
      try { fn(currentUser, currentProfile); } catch (e) { console.error(e); }
    });
  }

  // ── 身份认证（GitHub OAuth only） ──
  async function signInWithGitHub() {
    if (!supabase) throw new Error("平台未配置云端后端服务");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.href.split("#")[0],
        scopes: "read:user user:email",
      },
    });
    if (error) throw error;
    return data;
  }

  /** @deprecated 仅保留兼容性存根 */
  async function signInWithEmail() {
    throw new Error("平台已全面切换为 GitHub OAuth 登录，请点击「用 GitHub 登录」");
  }
  async function signUp() {
    throw new Error("平台已全面切换为 GitHub OAuth 登录，请点击「用 GitHub 登录」");
  }

  async function signOut() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    currentUser = null;
    currentProfile = null;
    currentEnrollments = [];
    updateAuthUI();
    notifyAuthListeners();
    showToast("已退出当前账号", "info");
  }

  // ── 学号与姓名绑定 ──
  async function updateProfile({ student_no, display_name }) {
    if (!supabase || !currentUser) throw new Error("请先登录平台账号");
    const updateData = {};
    if (student_no !== undefined) updateData.student_no = student_no.trim();
    if (display_name !== undefined) updateData.display_name = display_name.trim();

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("user_id", currentUser.id);

    if (error) {
      // 学号全局唯一：给出可操作的中文提示，而不是裸露的 Postgres 错误
      if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message || "")) {
        throw new Error("该学号已被其他账号绑定，请联系任课教师核对处理");
      }
      if (error.code === "42501" || /row-level security|permission denied/i.test(error.message || "")) {
        throw new Error("没有权限修改个人资料，请确认登录状态后重试");
      }
      throw new Error(error.message || "更新个人资料失败");
    }

    await refreshProfile();
    updateAuthUI();
    notifyAuthListeners();
    showToast("个人资料已更新成功！", "success");
    return currentProfile;
  }

  // ── 课程选课与邀请码 ──
  function notifyEnrollmentsChanged() {
    try {
      document.dispatchEvent(new CustomEvent("scipoj:enrollments-changed"));
    } catch (e) { /* CustomEvent 不可用时忽略 */ }
  }

  async function joinCourse(inviteCode) {
    if (!supabase || !currentUser) throw new Error("请先登录平台账号");
    const code = (inviteCode || "").trim();
    if (!code) throw new Error("请输入有效的课程邀请码");
    if (code.length > 64) throw new Error("邀请码格式不正确");

    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登录会话已失效，请重新登录");

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
    } catch (e) {
      if (e.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(e.message || "")) {
        lastError = e; // 网络/CORS 问题，继续尝试 RPC
      } else {
        throw e;
      }
    }

    // 2. 回退 Supabase RPC: join_course_by_code（SECURITY DEFINER，受服务端校验）
    try {
      const { data, error } = await supabase.rpc("join_course_by_code", { p_code: code });
      if (error) {
        lastError = new Error(error.message || "选课服务调用失败");
      } else if (data) {
        if (!data.ok) throw new Error(data.error || "加入课程失败");
        await refreshEnrollments();
        notifyEnrollmentsChanged();
        showToast(data.message || "加入课程成功！", "success");
        return data;
      }
    } catch (rpcErr) {
      // 函数不存在（未执行 004/005 迁移）时给出明确提示，而不是误报“邀请码无效”
      if (/function .* does not exist|not found/i.test(rpcErr.message || "")) {
        lastError = rpcErr;
      } else {
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

  // ── 作业查询与正式提交 ──
  async function getAssignmentForProblem(problemId, courseId = null) {
    if (!supabase) return null;
    try {
      let query = supabase
        .from("assignments")
        .select("*")
        .eq("problem_id", problemId);

      if (courseId) {
        query = query.eq("course_id", courseId);
      } else {
        // 只查询“我所在班级”的作业；否则会把他校/他班的作业误判为可提交，
        // 直到服务端返回 NOT_ENROLLED 才报错，体验与预期不符。
        const courseIds = currentEnrollments.map(e => e.course_id).filter(Boolean);
        if (courseIds.length === 0) return null;
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
    } catch (e) {
      console.warn("[Platform] getAssignmentForProblem exception:", e);
      return null;
    }
  }

  async function submitAssignment(assignmentId, codeText, clientIntegrity = null) {
    if (!isConfigured()) {
      throw new Error("未配置平台后端服务，无法提交正式作业");
    }
    if (!currentUser || !supabase) {
      throw new Error("请先登录平台账号再提交正式作业");
    }

    // 学号门禁检查
    if (!isTeacher() && (!currentProfile?.student_no || !currentProfile.student_no.trim())) {
      throw new Error("提交正式作业前，请先在右上角绑定您的真实学号与姓名！");
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登录会话已失效，请重新登录");

    const cfg = window.SCIP_OJ_CONFIG;

    if (cfg.MOCK_MODE) {
      return {
        ok: true,
        submission_id: "mock-" + Date.now(),
        public_code: "SUB-MOCK" + Math.floor(Math.random() * 9000 + 1000),
        status: "queued",
        warning: "（本地 Mock 模式提交测试）",
      };
    }

    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/submit-assignment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ assignment_id: assignmentId, code_text: codeText, client_integrity: clientIntegrity }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status} ${resp.statusText}` }));
    if (!resp.ok) {
      const code = json.code || "";
      if (resp.status === 401 || code === "UNAUTHORIZED") {
        throw new Error("登录已过期，请重新登录后再提交作业");
      }
      if (code === "NOT_ENROLLED" || (resp.status === 403 && json.error?.includes("未选修"))) {
        throw new Error("您未选修本门课程，请先输入课程邀请码选课！");
      }
      if (code === "STUDENT_NO_REQUIRED") {
        throw new Error("请先在个人资料中绑定真实学号与姓名再提交作业");
      }
      if (code === "CODE_TOO_LARGE") {
        throw new Error("提交代码过长，请精简后重试（上限 200000 字符）");
      }
      throw new Error(json.error || `提交作业失败 (HTTP ${resp.status})`);
    }
    return json;
  }

  async function getMySubmissions(assignmentId) {
    if (!supabase || !currentUser) return [];
    try {
      let query = supabase
        .from("submissions")
        .select(`
          id,
          public_code,
          assignment_id,
          attempt_no,
          created_at,
          metadata,
          gradings (
            id,
            status,
            score,
            passed,
            report_json,
            error_message,
            finished_at
          )
        `)
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        // 关键：复判会新增 grading，必须让最新一次评分排在最前，否则前端会展示旧分数
        .order("created_at", { ascending: false, referencedTable: "gradings" });

      if (assignmentId) {
        query = query.eq("assignment_id", assignmentId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("[Platform] getMySubmissions error:", error);
        throw new Error("加载提交记录失败：" + (error.message || "数据库查询错误"));
      }
      return data || [];
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("加载提交记录失败")) throw e;
      console.warn("[Platform] getMySubmissions exception:", e);
      throw new Error("加载提交记录失败，请检查网络后重试");
    }
  }

  // ── 教师功能 ──
  async function getMyCourses() {
    return await refreshEnrollments();
  }

  /** 把「RPC 未部署」类错误翻译成可执行的提示，避免前端只看到 PGRST202 */
  const MIGRATION_006 = "supabase/migrations/006_security_hardening_and_leaderboard.sql";
  function isMissingRpcError(err) {
    const msg = String(err?.message || err || "");
    const code = String(err?.code || "");
    return code === "PGRST202" || code === "42883" || code === "404" ||
      /could not find the function|does not exist|schema cache/i.test(msg);
  }
  function describeRpcError(err, action) {
    if (isMissingRpcError(err)) {
      const e = new Error(`服务端缺少「${action}」所需的数据库函数，请管理员执行 ${MIGRATION_006} 后重试`);
      e.missingRpc = true;
      e.code = err?.code;
      return e;
    }
    const e = new Error(`${action}失败：${err?.message || err || "未知错误"}`);
    e.code = err?.code;
    return e;
  }

  async function getTeacherRoster(courseId) {
    if (!supabase) return [];
    // 通过受控 RPC 读取：006 起 course_gradebook 已撤销 authenticated 直接 SELECT，
    // 由数据库函数校验 is_teacher_of(course_id) 后返回本课程数据。
    const { data, error } = await supabase.rpc("get_teacher_gradebook", { p_course_id: courseId });

    if (!error) return data || [];

    // 迁移 006 尚未执行时的兼容回退：旧版视图对 authenticated 仍可读。
    // 006 执行后 RPC 存在，不会再走这里。
    if (isMissingRpcError(error)) {
      console.warn("[Platform] get_teacher_gradebook 缺失，回退旧版视图查询（请尽快执行 006）");
      const legacy = await supabase
        .from("course_gradebook")
        .select("*")
        .eq("course_id", courseId);

      if (!legacy.error) return legacy.data || [];
      throw describeRpcError(error, "加载班级成绩簿");
    }
    throw describeRpcError(error, "加载班级成绩簿");
  }

  async function getCourseInviteCode(courseId) {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("get_course_invite_code", { p_course_id: courseId });
    if (!error) return data || null;

    if (isMissingRpcError(error)) {
      // 006 之前 invite_code 列对 authenticated 可读；006 之后此回退会因列权限失败，
      // 但那时 RPC 已经存在，正常路径不会走到这里。
      const legacy = await supabase
        .from("courses")
        .select("invite_code")
        .eq("id", courseId)
        .maybeSingle();
      if (!legacy.error) return legacy.data?.invite_code || null;
    }
    throw describeRpcError(error, "读取课程邀请码");
  }

  async function getLeaderboard(courseId, problemId = null, limit = 30) {
    if (!supabase) throw new Error("平台未配置云端服务");
    // 服务端 RPC 负责校验“本课程师生”并在返回前脱敏学号
    const { data, error } = await supabase.rpc("get_course_leaderboard", {
      p_course_id: courseId,
      p_problem_id: problemId || null,
    });

    if (!error) {
      return (data || []).slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
    }

    if (isMissingRpcError(error)) {
      // 006 未执行时的兼容回退：旧视图可读，前端脱敏后再展示。
      const legacy = await supabase
        .from("course_gradebook")
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

  async function getPendingRoster(courseId) {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from("roster_pending")
        .select("*")
        .eq("course_id", courseId)
        .order("student_no", { ascending: true });

      if (error) {
        console.warn("[Platform] getPendingRoster error:", error);
        throw new Error("加载花名册失败：" + (error.message || "数据库查询错误"));
      }
      return data || [];
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("加载花名册失败")) throw e;
      console.warn("[Platform] getPendingRoster exception:", e);
      throw new Error("加载花名册失败，请稍后重试");
    }
  }

  async function importRosterCSV(courseId, csvText) {
    if (!supabase || !currentUser) throw new Error("请先登录教师账号");
    if (!csvText || !csvText.trim()) throw new Error("CSV 内容不能为空");

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new Error("未解析到任何有效数据行");

    const rows = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && (line.includes("学号") || line.toLowerCase().includes("student_no"))) {
        continue;
      }
      const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ""));
      if (parts.length < 2) continue;
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

    const { data, error } = await supabase
      .from("roster_pending")
      .upsert(rows, { onConflict: "course_id,student_no" })
      .select();

    if (error) {
      throw new Error("导入花名册失败: " + error.message);
    }

    return { total: rows.length, inserted: data ? data.length : rows.length };
  }

  async function publishAssignment(params) {
    if (!supabase || !currentUser) throw new Error("请先登录教师账号");
    const { course_id, problem_id, due_at, pass_score = 90, n_instances = 3, score_policy = "highest_before_due" } = params;

    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登录会话已失效");

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
        return await resp.json();
      } else if (resp.status !== 404) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json.error || `发布失败 HTTP ${resp.status}`);
      }
    } catch (e) {
      if (!e.message.includes("HTTP 404") && !e.message.includes("Failed to fetch")) {
        throw e;
      }
    }

    // 回退直接写入 assignments 表
    const { data, error } = await supabase
      .from("assignments")
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

  async function requestRegrade(submissionId, reason) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("请先登录教师账号");

    const cfg = window.SCIP_OJ_CONFIG;
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ submission_id: submissionId, reason: reason || "教师手动复判" }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (!resp.ok) {
      throw new Error(json.error || "复判请求失败");
    }
    return json;
  }

  const REGRADE_BATCH_LIMIT = 50;

  async function postRegradeBatch(payload, session, cfg) {
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    let json = null;
    try { json = await resp.json(); } catch (_) { /* 非 JSON 响应 */ }
    return { resp, json };
  }

  async function requestBatchRegrade(submissionIds, reason, onProgress) {
    if (!supabase || !currentUser) throw new Error("请先登录教师账号");
    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      throw new Error("未选择任何待复判记录");
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("请先登录");

    const cfg = window.SCIP_OJ_CONFIG;
    const ids = Array.from(new Set(submissionIds.filter(Boolean)));
    const chunks = [];
    for (let i = 0; i < ids.length; i += REGRADE_BATCH_LIMIT) {
      chunks.push(ids.slice(i, i + REGRADE_BATCH_LIMIT));
    }

    let endpointMissing = false;
    let totalSuccess = 0;
    const allResults = [];

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      try {
        const { resp, json } = await postRegradeBatch({ submission_ids: chunk, reason }, session, cfg);
        if (resp.ok && json) {
          totalSuccess += Number(json.success_count || 0);
          if (Array.isArray(json.results)) allResults.push(...json.results);
          if (typeof onProgress === "function") {
            onProgress(Math.min((c + 1) * REGRADE_BATCH_LIMIT, ids.length), ids.length);
          }
          continue;
        }
        if (resp.status === 404) {
          endpointMissing = true;
          break;
        }
        // 服务端明确拒绝（权限不足、参数错误等）时直接抛错，不再静默降级
        const msg = json?.error || `批量复判失败 (HTTP ${resp.status})`;
        const err = new Error(msg);
        err.code = json?.code;
        throw err;
      } catch (e) {
        if (e.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(e.message || "")) {
          endpointMissing = true;
          break;
        }
        throw e;
      }
    }

    if (!endpointMissing) {
      return { ok: true, total: ids.length, success_count: totalSuccess, results: allResults };
    }

    // 仅在端点未部署 / 网络不可达时回退为单条复判
    console.warn("[Platform] regrade-batch 端点不可用，回退单条循环复判");
    let successCount = 0;
    const results = [];
    for (let i = 0; i < ids.length; i++) {
      const subId = ids[i];
      try {
        await requestRegrade(subId, reason);
        successCount++;
        results.push({ id: subId, success: true });
      } catch (err) {
        results.push({ id: subId, success: false, error: err.message });
      }
      if (typeof onProgress === "function") {
        onProgress(i + 1, ids.length);
      }
    }
    return { ok: true, total: ids.length, success_count: successCount, results };
  }

  async function requestProblemRegrade(courseId, problemId, reason, onProgress) {
    if (!supabase || !currentUser) throw new Error("请先登录教师账号");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("请先登录");

    const cfg = window.SCIP_OJ_CONFIG;
    try {
      const { resp, json } = await postRegradeBatch(
        { course_id: courseId, problem_id: problemId, reason },
        session,
        cfg,
      );
      if (resp.ok && json) return json;
      if (resp.status !== 404) {
        // 超过单次上限时，前端改为按 50 条分片调用同一端点
        if (json?.code === "BATCH_LIMIT_EXCEEDED") {
          return await requestProblemRegradeChunked(courseId, problemId, reason, onProgress);
        }
        const err = new Error(json?.error || `整题复判失败 (HTTP ${resp.status})`);
        err.code = json?.code;
        throw err;
      }
    } catch (e) {
      if (!(e.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(e.message || ""))) {
        throw e;
      }
      console.warn("[Platform] regrade-batch 整题重判端点不可用，回退查询提交列表");
    }

    return await requestProblemRegradeChunked(courseId, problemId, reason, onProgress);
  }

  async function requestProblemRegradeChunked(courseId, problemId, reason, onProgress) {
    const { data: assignment, error: aErr } = await supabase
      .from("assignments")
      .select("id")
      .eq("course_id", courseId)
      .eq("problem_id", String(problemId).toUpperCase())
      .maybeSingle();

    if (aErr) throw new Error("查询作业失败：" + aErr.message);
    if (!assignment) throw new Error("未找到对应作业");

    const { data: subs, error: sErr } = await supabase
      .from("submissions")
      .select("id")
      .eq("assignment_id", assignment.id);

    if (sErr) throw new Error("查询提交记录失败：" + sErr.message);

    const ids = (subs || []).map(s => s.id);
    if (ids.length === 0) throw new Error("该题目暂无任何学生提交记录");

    return await requestBatchRegrade(ids, reason || `整题重判 (${problemId})`, onProgress);
  }

  async function rotateCourseInviteCode(courseId, newCode = null) {
    if (!supabase || !currentUser) throw new Error("请先登录");
    const code = newCode
      ? newCode.trim().toUpperCase()
      : "SCIP-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    if (!/^[A-Z0-9_-]{4,32}$/.test(code)) {
      throw new Error("邀请码只能包含字母、数字、下划线或短横线（4-32 位）");
    }

    const { error: updateErr } = await supabase
      .from("courses")
      .update({ invite_code: code })
      .eq("id", courseId);

    if (updateErr) {
      if (updateErr.code === "23505") throw new Error("该邀请码已被其他课程占用，请重试");
      throw new Error("更新课程邀请码失败：" + updateErr.message);
    }

    const { error: insertErr } = await supabase
      .from("course_invites")
      .insert({ course_id: courseId, code, role: "student" });

    if (insertErr && insertErr.code !== "23505") {
      throw new Error("写入邀请码记录失败：" + insertErr.message);
    }

    await refreshEnrollments();
    return code;
  }

  // ── UI 渲染与弹窗系统 ──
  function updateAuthUI() {
    const authArea = document.getElementById("auth-area");
    if (!authArea) return;

    if (!isConfigured()) {
      authArea.innerHTML = `
        <span class="user-info" style="color:var(--text-secondary); background:var(--bg-subtle); padding:0.35rem 0.65rem; border-radius:6px; font-size:0.82rem;" title="未配置 Supabase 服务端。力扣壳处于离线练习模式，L1 WASM 正常工作。">
          🌿 离线练习模式
        </span>
      `;
      const teacherLink = document.getElementById("teacher-link");
      if (teacherLink) teacherLink.hidden = true;
      return;
    }

    if (currentUser) {
      const meta = currentUser.user_metadata || {};
      const name = currentProfile?.display_name || meta.display_name || meta.user_name || meta.preferred_username || (currentUser.email ? currentUser.email.split("@")[0] : "GitHub 用户");
      const sNo = currentProfile?.student_no;
      const isTeach = isTeacher();

      let roleBadge = "";
      if (isTeach) {
        roleBadge = '<span class="user-badge" style="background:var(--color-purple-bg); color:var(--color-purple);">教师</span>';
      }

      let studentBadge = "";
      if (!isTeach) {
        if (sNo) {
          studentBadge = `<span class="user-badge" style="background:var(--color-pass-bg); color:var(--color-pass);" title="已对齐学号">${escapeHtml(sNo)}</span>`;
        } else {
          studentBadge = `<button id="btn-bind-sno-quick" type="button" class="btn-warning" style="font-size:0.72rem; padding:0.15rem 0.45rem; border-radius:4px;" title="未绑定学号，点击填写">⚠️ 未填学号</button>`;
        }
      }

      authArea.innerHTML = `
        <span class="user-info" style="font-size:0.85rem; color:var(--text-primary); display:inline-flex; align-items:center; gap:0.25rem;">
          👤 <strong>${escapeHtml(name)}</strong> ${studentBadge} ${roleBadge}
        </span>
        <button id="btn-edit-profile" type="button" class="btn-secondary" style="font-size:0.78rem; padding:0.3rem 0.6rem;" title="修改学号与显示姓名">资料</button>
        <button id="btn-join-course-nav" type="button" class="btn-secondary" style="font-size:0.78rem; padding:0.3rem 0.6rem;" title="加入新课程">选课</button>
        <button id="btn-signout" type="button" class="btn-secondary" style="font-size:0.78rem; padding:0.3rem 0.6rem;">登出</button>
      `;

      const btnOut = document.getElementById("btn-signout");
      if (btnOut) btnOut.onclick = () => signOut();

      const btnEdit = document.getElementById("btn-edit-profile");
      if (btnEdit) btnEdit.onclick = () => showStudentNoDialog();

      const btnJoin = document.getElementById("btn-join-course-nav");
      if (btnJoin) btnJoin.onclick = () => showJoinCourseDialog();

      const btnQuick = document.getElementById("btn-bind-sno-quick");
      if (btnQuick) btnQuick.onclick = () => showStudentNoDialog();

      const teacherLink = document.getElementById("teacher-link");
      if (teacherLink) {
        teacherLink.hidden = !isTeach;
      }
    } else {
      authArea.innerHTML = `
        <button id="btn-signin" type="button" class="btn-blue" style="font-size:0.82rem; padding:0.35rem 0.75rem;">
          用 GitHub 登录
        </button>
      `;
      const btnIn = document.getElementById("btn-signin");
      if (btnIn) btnIn.onclick = () => showLoginDialog();

      const teacherLink = document.getElementById("teacher-link");
      if (teacherLink) teacherLink.hidden = true;
    }
  }

  // ── 学生门禁检查 ──
  function checkStudentGates() {
    if (!currentUser || isTeacher()) return;
    // 已有弹窗打开时不要叠加第二个门禁弹窗
    if (document.querySelector(".modal-overlay:not([hidden])")) return;
    // 选课关系查询失败时不要误判为“未选课”而强制弹窗
    if (enrollmentsLoadFailed) return;

    // 门禁 1：未填学号，引导先填学号与真实姓名
    if (!currentProfile?.student_no) {
      setTimeout(() => {
        showStudentNoDialog({
          forced: true,
          onComplete: () => {
            if (currentEnrollments.length === 0) {
              showJoinCourseDialog({ forced: true });
            }
          }
        });
      }, 350);
      return;
    }

    // 门禁 2：已填学号但未选修任何课程，引导输入邀请码
    if (currentEnrollments.length === 0) {
      setTimeout(() => {
        showJoinCourseDialog({ forced: true });
      }, 350);
    }
  }

  // ── 通用弹窗管理：Escape 关闭 / 焦点圈定 / 背景滚动锁定 / 焦点恢复 ──
  const modalStack = [];
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])';

  function openModal(dialog, options = {}) {
    if (!dialog) return;
    const dismissible = options.dismissible !== false;
    dialog.dataset.dismissible = dismissible ? "true" : "false";
    dialog.__onClose = typeof options.onClose === "function" ? options.onClose : null;
    if (!dialog.__prevFocus) dialog.__prevFocus = document.activeElement;
    if (!modalStack.includes(dialog)) modalStack.push(dialog);
    dialog.hidden = false;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.classList.add("modal-open");
    setTimeout(() => {
      const target = dialog.querySelector("[data-autofocus]") ||
        dialog.querySelector(FOCUSABLE_SELECTOR);
      if (target && typeof target.focus === "function") {
        try { target.focus(); } catch (_) { /* ignore */ }
      }
    }, 30);
  }

  function closeModal(dialog, options = {}) {
    if (!dialog) return;
    if (dialog.dataset.dismissible === "false" && !options.force) return;
    dialog.hidden = true;
    const idx = modalStack.indexOf(dialog);
    if (idx >= 0) modalStack.splice(idx, 1);
    if (modalStack.length === 0) document.body.classList.remove("modal-open");
    const prev = dialog.__prevFocus;
    dialog.__prevFocus = null;
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch (_) { /* ignore */ }
    }
    const cb = dialog.__onClose;
    dialog.__onClose = null;
    if (cb) {
      try { cb(); } catch (e) { console.error(e); }
    }
  }

  function getTopModal() {
    return modalStack.length ? modalStack[modalStack.length - 1] : null;
  }

  document.addEventListener("keydown", (e) => {
    const top = getTopModal();
    if (!top) return;

    if (e.key === "Escape") {
      if (top.dataset.dismissible === "false") return; // 强制门禁弹窗不允许 Esc 绕过
      e.preventDefault();
      closeModal(top);
      return;
    }

    if (e.key === "Tab") {
      const nodes = Array.from(top.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // ── 弹窗: 登录 ──
  function showLoginDialog() {
    if (!isConfigured()) {
      showToast("平台未配置云端服务，无需登录即可使用「L1 练习评分」", "info");
      return;
    }

    let dialog = document.getElementById("login-dialog");
    if (!dialog) {
      dialog = document.createElement("div");
      dialog.id = "login-dialog";
      dialog.className = "modal-overlay";
      dialog.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>登录 SCIP-OJ 作业平台</h3>
            <button type="button" class="modal-close-btn" id="login-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0;">
              平台统一采用 <strong>GitHub OAuth</strong> 认证登录。<br/>
              无需提交 PR 或手动触发 Actions，GitHub 仅用于可信身份认证与作业成绩归属。
            </p>
            <div id="login-error" class="fail" style="font-size:0.85rem; margin:0.5rem 0;" hidden></div>
          </div>
          <div class="modal-actions">
            <button type="button" id="login-cancel" class="btn-secondary">取消</button>
            <button type="button" id="login-github" class="btn-blue" data-autofocus>使用 GitHub 账号登录</button>
          </div>
        </div>
      `;
      dialog.hidden = true;
      document.body.appendChild(dialog);

      const close = () => closeModal(dialog);
      document.getElementById("login-cancel").onclick = close;
      document.getElementById("login-modal-x").onclick = close;
      document.getElementById("login-modal-x").setAttribute("aria-label", "关闭登录弹窗");
      dialog.onclick = (e) => { if (e.target === dialog) close(); };

      document.getElementById("login-github").onclick = async () => {
        const errEl = document.getElementById("login-error");
        const btn = document.getElementById("login-github");
        errEl.hidden = true;
        btn.disabled = true;
        btn.textContent = "跳转 GitHub 中…";
        try {
          await signInWithGitHub();
        } catch (err) {
          errEl.textContent = err.message || "登录授权失败";
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = "使用 GitHub 账号登录";
        }
      };
    }

    openModal(dialog);
    const errEl = document.getElementById("login-error");
    if (errEl) errEl.hidden = true;
  }

  // ── 弹窗: 绑定学号与姓名 ──
  function showStudentNoDialog(options = {}) {
    const forced = !!options.forced;
    let dialog = document.getElementById("student-no-dialog");
    if (!dialog) {
      dialog = document.createElement("div");
      dialog.id = "student-no-dialog";
      dialog.className = "modal-overlay";
      dialog.innerHTML = `
        <div class="modal-content" style="max-width:460px;">
          <div class="modal-header">
            <h3>👤 绑定课程学号与真实姓名</h3>
            <button type="button" class="modal-close-btn" id="sno-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0; line-height:1.6;">
              为了确保您的正式作业成绩能准确计入教师成绩册，请核对并绑定您的<strong>真实学号</strong>与<strong>姓名</strong>。
            </p>
            <div class="form-group">
              <label for="input-student-no">学号 (如 20260001)：</label>
              <input type="text" id="input-student-no" placeholder="输入您的学号" data-autofocus />
            </div>
            <div class="form-group">
              <label for="input-display-name">真实姓名 / 显示名：</label>
              <input type="text" id="input-display-name" placeholder="输入真实姓名" />
            </div>
            <p id="sno-error" class="fail" style="font-size:0.85rem; margin-top:0.5rem;" hidden></p>
          </div>
          <div class="modal-actions">
            <button type="button" id="btn-sno-cancel" class="btn-secondary">取消</button>
            <button type="button" id="btn-sno-save" class="btn-blue">保存资料</button>
          </div>
        </div>
      `;
      dialog.hidden = true;
      document.body.appendChild(dialog);
    }

    const inputNo = document.getElementById("input-student-no");
    const inputName = document.getElementById("input-display-name");
    const errEl = document.getElementById("sno-error");
    const btnCancel = document.getElementById("btn-sno-cancel");
    const btnX = document.getElementById("sno-modal-x");
    const btnSave = document.getElementById("btn-sno-save");

    inputNo.value = currentProfile?.student_no || "";
    inputName.value = currentProfile?.display_name || "";
    errEl.hidden = true;

    // 强制门禁也保留“稍后填写（仅练习）”出口：
    // 关闭弹窗不会影响 L1 练习；正式提交仍由服务端门禁校验学号，安全边界不变。
    const isForcedBlocking = forced && !currentProfile?.student_no;
    btnCancel.hidden = false;
    btnCancel.textContent = isForcedBlocking ? "稍后填写（仅练习）" : "取消";
    btnX.hidden = false;
    btnX.setAttribute("aria-label", "关闭学号绑定弹窗");

    const close = () => closeModal(dialog);
    btnCancel.onclick = () => {
      close();
      if (isForcedBlocking) {
        showToast("已跳过学号绑定：可继续 L1 练习，提交正式作业前需补齐学号", "info");
      }
    };
    btnX.onclick = close;
    dialog.onclick = (e) => { if (e.target === dialog) close(); };

    // 支持回车保存
    inputNo.onkeydown = (e) => { if (e.key === "Enter") btnSave.click(); };
    inputName.onkeydown = (e) => { if (e.key === "Enter") btnSave.click(); };

    btnSave.onclick = async () => {
      const sNo = inputNo.value.trim();
      const sName = inputName.value.trim();
      if (!sNo) {
        errEl.textContent = "学号不能为空";
        errEl.hidden = false;
        inputNo.focus();
        return;
      }
      if (!sName) {
        errEl.textContent = "真实姓名不能为空";
        errEl.hidden = false;
        inputName.focus();
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = "保存中…";
      try {
        await updateProfile({ student_no: sNo, display_name: sName });
        closeModal(dialog, { force: true });
        if (typeof options.onComplete === "function") {
          options.onComplete();
        }
      } catch (err) {
        errEl.textContent = err.message || "保存资料失败";
        errEl.hidden = false;
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = "保存资料";
      }
    };

    openModal(dialog, { dismissible: true });
    setTimeout(() => { (inputNo.value ? inputName : inputNo).focus(); }, 100);
  }

  // ── 弹窗: 输入课程邀请码选课 ──
  function showJoinCourseDialog(options = {}) {
    let dialog = document.getElementById("join-course-dialog");
    if (!dialog) {
      dialog = document.createElement("div");
      dialog.id = "join-course-dialog";
      dialog.className = "modal-overlay";
      dialog.innerHTML = `
        <div class="modal-content" style="max-width:460px;">
          <div class="modal-header">
            <h3>🎓 输入课程邀请码加入班级</h3>
            <button type="button" class="modal-close-btn" id="join-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0; line-height:1.6;">
              请输入任课教师提供的<strong>选课邀请码</strong>（例如 <code>REDACTED-INVITE</code>），加入教学班级后方可提交课程正式作业。
            </p>
            <div class="form-group">
              <label for="input-invite-code">课程邀请码：</label>
              <input type="text" id="input-invite-code" placeholder="如 REDACTED-INVITE" data-autofocus />
            </div>
            <p id="join-course-error" class="fail" style="font-size:0.85rem; margin-top:0.5rem;" hidden></p>
          </div>
          <div class="modal-actions">
            <button type="button" id="btn-join-cancel" class="btn-secondary">稍后再说</button>
            <button type="button" id="btn-join-submit" class="btn-blue">确认加入课程</button>
          </div>
        </div>
      `;
      dialog.hidden = true;
      document.body.appendChild(dialog);
    }

    const inputCode = document.getElementById("input-invite-code");
    const errEl = document.getElementById("join-course-error");
    const btnCancel = document.getElementById("btn-join-cancel");
    const btnX = document.getElementById("join-modal-x");
    const btnSubmit = document.getElementById("btn-join-submit");

    inputCode.value = "";
    errEl.hidden = true;

    const close = () => closeModal(dialog);
    btnCancel.onclick = close;
    btnX.onclick = close;
    btnX.setAttribute("aria-label", "关闭选课弹窗");
    dialog.onclick = (e) => { if (e.target === dialog) close(); };

    inputCode.onkeydown = (e) => { if (e.key === "Enter") btnSubmit.click(); };

    btnSubmit.onclick = async () => {
      const code = inputCode.value.trim();
      if (!code) {
        errEl.textContent = "请输入邀请码";
        errEl.hidden = false;
        inputCode.focus();
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.textContent = "正在校验加入…";
      try {
        const res = await joinCourse(code);
        closeModal(dialog, { force: true });
        if (typeof options.onComplete === "function") {
          options.onComplete(res);
        }
      } catch (err) {
        errEl.textContent = err.message || "加入课程失败";
        errEl.hidden = false;
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "确认加入课程";
      }
    };

    openModal(dialog, { dismissible: true });
    setTimeout(() => inputCode.focus(), 100);
  }

  // ── Toast 轻量非阻塞通知 ──
  function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");

    // 最多保留 4 条，避免刷屏遮挡页面按钮
    while (container.children.length >= 4) {
      container.removeChild(container.firstElementChild);
    }

    const allowed = ["info", "success", "error", "warning"];
    const kind = allowed.includes(type) ? type : "info";

    const toast = document.createElement("div");
    toast.className = `toast toast-${kind}`;

    let icon = "ℹ️";
    if (kind === "success") icon = "✅";
    else if (kind === "error") icon = "❌";
    else if (kind === "warning") icon = "⚠️";

    toast.innerHTML = `<span>${icon}</span><span style="flex:1;">${escapeHtml(message)}</span>`;
    toast.title = "点击关闭";
    toast.onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // ── 通用输入 / 确认弹窗：替代原生 prompt/confirm（移动端不友好且会阻塞渲染） ──
  function ensurePromptDialog() {
    let dialog = document.getElementById("prompt-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "prompt-dialog";
    dialog.className = "modal-overlay";
    dialog.innerHTML = `
      <div class="modal-content" style="max-width:460px;">
        <div class="modal-header">
          <h3 id="prompt-title">请输入</h3>
          <button type="button" class="modal-close-btn" id="prompt-x" aria-label="关闭输入弹窗">✕</button>
        </div>
        <div class="modal-body">
          <p id="prompt-message" style="color:var(--text-secondary); margin-top:0; line-height:1.6;"></p>
          <div class="form-group">
            <input type="text" id="prompt-input" data-autofocus />
            <p id="prompt-error" class="fail" style="font-size:0.85rem; margin:0.4rem 0 0;" hidden></p>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="prompt-cancel" class="btn-secondary">取消</button>
          <button type="button" id="prompt-ok" class="btn-blue">确定</button>
        </div>
      </div>
    `;
    dialog.hidden = true;
    document.body.appendChild(dialog);
    return dialog;
  }

  function showPromptDialog(options = {}) {
    const dialog = ensurePromptDialog();
    const titleEl = document.getElementById("prompt-title");
    const msgEl = document.getElementById("prompt-message");
    const input = document.getElementById("prompt-input");
    const errEl = document.getElementById("prompt-error");
    const btnOk = document.getElementById("prompt-ok");
    const btnCancel = document.getElementById("prompt-cancel");
    const btnX = document.getElementById("prompt-x");

    titleEl.textContent = options.title || "请输入";
    msgEl.textContent = options.message || "";
    msgEl.hidden = !options.message;
    input.value = options.defaultValue ?? "";
    input.placeholder = options.placeholder || "";
    errEl.hidden = true;
    btnOk.textContent = options.confirmText || "确定";
    btnCancel.textContent = options.cancelText || "取消";

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeModal(dialog);
        resolve(value);
      };

      const submit = () => {
        const val = input.value.trim();
        if (options.required && !val) {
          errEl.textContent = options.requiredMessage || "内容不能为空";
          errEl.hidden = false;
          input.focus();
          return;
        }
        finish(val);
      };

      btnOk.onclick = submit;
      btnCancel.onclick = () => finish(null);
      btnX.onclick = () => finish(null);
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      };
      dialog.onclick = (e) => { if (e.target === dialog) finish(null); };

      openModal(dialog, {
        dismissible: true,
        onClose: () => { if (!settled) { settled = true; resolve(null); } },
      });
      setTimeout(() => {
        input.focus();
        if (options.selectAll !== false) input.select();
      }, 60);
    });
  }

  // 只读长文本弹窗：剪贴板 API 不可用（非 HTTPS / 权限被拒）时的兜底
  function showTextDialog(options = {}) {
    let dialog = document.getElementById("text-dialog");
    if (!dialog) {
      dialog = document.createElement("div");
      dialog.id = "text-dialog";
      dialog.className = "modal-overlay";
      dialog.innerHTML = `
        <div class="modal-content" style="max-width:680px;">
          <div class="modal-header">
            <h3 id="text-dialog-title">复制内容</h3>
            <button type="button" class="modal-close-btn" id="text-dialog-x" aria-label="关闭">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0;">
              浏览器不允许自动写入剪贴板，请点击下方文本框后按 <kbd>Ctrl/⌘ + C</kbd> 手动复制。
            </p>
            <textarea id="text-dialog-body" readonly rows="14"
              style="width:100%; font-family:var(--font-mono, monospace); font-size:0.82rem; resize:vertical;"></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" id="text-dialog-select" class="btn-secondary">全选内容</button>
            <button type="button" id="text-dialog-close" class="btn-blue">关闭</button>
          </div>
        </div>
      `;
      dialog.hidden = true;
      document.body.appendChild(dialog);
    }

    document.getElementById("text-dialog-title").textContent = options.title || "复制内容";
    const body = document.getElementById("text-dialog-body");
    body.value = options.text || "";
    const close = () => closeModal(dialog);
    document.getElementById("text-dialog-close").onclick = close;
    document.getElementById("text-dialog-x").onclick = close;
    document.getElementById("text-dialog-select").onclick = () => {
      body.focus();
      body.select();
    };
    dialog.onclick = (e) => { if (e.target === dialog) close(); };
    openModal(dialog);
    setTimeout(() => { body.focus(); body.select(); }, 80);
  }

  function ensureConfirmDialog() {
    let dialog = document.getElementById("confirm-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "confirm-dialog";
    dialog.className = "modal-overlay";
    dialog.innerHTML = `
      <div class="modal-content" style="max-width:440px;">
        <div class="modal-header">
          <h3 id="confirm-title">请确认</h3>
          <button type="button" class="modal-close-btn" id="confirm-x" aria-label="关闭确认弹窗">✕</button>
        </div>
        <div class="modal-body">
          <p id="confirm-message" style="margin:0; line-height:1.7; white-space:pre-line;"></p>
        </div>
        <div class="modal-actions">
          <button type="button" id="confirm-cancel" class="btn-secondary" data-autofocus>取消</button>
          <button type="button" id="confirm-ok" class="btn-blue">确定</button>
        </div>
      </div>
    `;
    dialog.hidden = true;
    document.body.appendChild(dialog);
    return dialog;
  }

  function showConfirmDialog(options = {}) {
    const dialog = ensureConfirmDialog();
    document.getElementById("confirm-title").textContent = options.title || "请确认";
    document.getElementById("confirm-message").textContent = options.message || "";
    const btnOk = document.getElementById("confirm-ok");
    const btnCancel = document.getElementById("confirm-cancel");
    const btnX = document.getElementById("confirm-x");
    btnOk.textContent = options.confirmText || "确定";
    btnCancel.textContent = options.cancelText || "取消";
    btnOk.className = options.danger ? "btn-danger" : "btn-blue";

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeModal(dialog);
        resolve(value);
      };
      btnOk.onclick = () => finish(true);
      btnCancel.onclick = () => finish(false);
      btnX.onclick = () => finish(false);
      dialog.onclick = (e) => { if (e.target === dialog) finish(false); };
      openModal(dialog, {
        dismissible: true,
        onClose: () => { if (!settled) { settled = true; resolve(false); } },
      });
    });
  }

  function showConfigWarning() {
    if (document.getElementById("config-warning")) return;
    const main = document.querySelector("main") || document.body;
    const el = document.createElement("div");
    el.id = "config-warning";
    el.className = "config-warning";
    el.innerHTML = `⚠️ <strong>离线练习模式</strong>：未检测到 <code>config.js</code>（Supabase 配置未注入）。L1 练习可正常使用；正式作业提交、选课与成绩功能暂不可用。管理员请检查部署 Secrets <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> 后重新部署。`;
    main.insertBefore(el, main.firstChild);
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    }[c] || c));
  }

  return {
    init,
    isConfigured,
    isMockMode,
    isMissingRpcError,
    getUser,
    getProfile,
    getSupabase,
    getEnrollments,
    isTeacher,
    onAuthChange,
    signInWithGitHub,
    signInWithEmail,
    signUp,
    signOut,
    updateProfile,
    joinCourse,
    submitAssignment,
    getMySubmissions,
    getAssignmentForProblem,
    getMyCourses,
    getTeacherRoster,
    getCourseInviteCode,
    getLeaderboard,
    getPendingRoster,
    importRosterCSV,
    publishAssignment,
    requestRegrade,
    requestBatchRegrade,
    requestProblemRegrade,
    rotateCourseInviteCode,
    updateAuthUI,
    showLoginDialog,
    showStudentNoDialog,
    showJoinCourseDialog,
    showPromptDialog,
    showConfirmDialog,
    showTextDialog,
    checkStudentGates,
    showToast,
    openModal,
    closeModal,
    escapeHtml,
  };
})();

window.ScipOJPlatform = ScipOJPlatform;
