/**
 * SCIP-OJ 平台层 — Supabase 鉴权、选课、学号绑定、提交作业、成绩中心与教师管理
 * 依赖: window.SCIP_OJ_CONFIG (from config.js)
 * 安全硬边界:
 *   1. 绝不把正式分写到 localStorage，正式分必须来自服务端评测；
 *   2. 前端仅使用 anon key，严禁将 service_role / PAT / HMAC 密钥注入前端；
 *   3. 登录仅使用 GitHub OAuth；
 *   4. 学生无需自己开 PR / 看 Actions。
 */

const ScipOJPlatform = (() => {
  let supabase = null;
  let currentUser = null;
  let currentProfile = null;
  let currentEnrollments = [];
  let authListeners = [];

  function isConfigured() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function isMockMode() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.MOCK_MODE);
  }

  async function init() {
    if (!isConfigured()) {
      console.log('[Platform] 未检测到 Supabase 配置，平台运行于离线练习模式（L1 WASM 正常可用）');
      updateAuthUI();
      return false;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('[Platform] 未检测到 @supabase/supabase-js 库');
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

      // 监听认证状态变化
      supabase.auth.onAuthStateChange(async (event, session) => {
        currentUser = session?.user || null;
        if (currentUser) {
          await refreshProfile();
          await refreshEnrollments();
          checkStudentGates();
        } else {
          currentProfile = null;
          currentEnrollments = [];
        }
        updateAuthUI();
        notifyAuthListeners();
      });
    } catch (e) {
      console.warn('[Platform] 会话恢复异常:', e);
    }

    updateAuthUI();
    if (currentUser) {
      checkStudentGates();
    }
    return true;
  }

  async function refreshProfile() {
    if (!supabase || !currentUser) {
      currentProfile = null;
      return null;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, student_no, display_name, role')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (!error && data) {
        currentProfile = data;
      } else {
        const meta = currentUser.user_metadata || {};
        currentProfile = {
          user_id: currentUser.id,
          student_no: meta.student_no || null,
          display_name: meta.display_name || meta.user_name || meta.preferred_username || (currentUser.email ? currentUser.email.split('@')[0] : 'GitHub 用户'),
          role: meta.role || 'student',
        };
      }
    } catch (e) {
      console.warn('[Platform] 加载用户资料异常:', e);
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
        .from('enrollments')
        .select('id, course_id, role, courses(id, name, code, invite_code)')
        .eq('user_id', currentUser.id);

      if (!error && data) {
        currentEnrollments = data;
      } else {
        currentEnrollments = [];
      }
    } catch (e) {
      console.warn('[Platform] 加载选课关系异常:', e);
      currentEnrollments = [];
    }
    return currentEnrollments;
  }

  function getUser() { return currentUser; }
  function getProfile() { return currentProfile; }
  function getSupabase() { return supabase; }
  function getEnrollments() { return currentEnrollments; }

  function isTeacher() {
    if (!currentUser) return false;
    if (currentProfile?.role === 'teacher' || currentProfile?.role === 'admin') return true;
    return currentEnrollments.some(e => e.role === 'teacher' || e.role === 'admin' || e.role === 'ta');
  }

  function onAuthChange(fn) {
    if (typeof fn === 'function') {
      authListeners.push(fn);
    }
  }

  function notifyAuthListeners() {
    authListeners.forEach((fn) => {
      try { fn(currentUser, currentProfile); } catch (e) { console.error(e); }
    });
  }

  // --- 身份认证（GitHub OAuth only） ---
  async function signInWithGitHub() {
    if (!supabase) throw new Error('平台未配置');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.href.split('#')[0],
        scopes: 'read:user user:email',
      },
    });
    if (error) throw error;
    return data;
  }

  /** @deprecated email/password disabled — github-only */
  async function signInWithEmail() {
    throw new Error('已改为 GitHub 登录，请使用「用 GitHub 登录」');
  }

  /** @deprecated */
  async function signUp() {
    throw new Error('已改为 GitHub 登录，请使用「用 GitHub 登录」');
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
  }

  // --- 学号绑定与资料更新 ---
  async function updateProfile({ student_no, display_name }) {
    if (!supabase || !currentUser) throw new Error('请先登录');
    const updateData = {};
    if (student_no !== undefined) updateData.student_no = student_no.trim();
    if (display_name !== undefined) updateData.display_name = display_name.trim();

    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('user_id', currentUser.id);

    if (error) {
      throw new Error(error.message || '更新个人资料失败');
    }

    await refreshProfile();
    updateAuthUI();
    notifyAuthListeners();
    return currentProfile;
  }

  // --- 选课与邀请码 ---
  async function joinCourse(inviteCode) {
    if (!supabase || !currentUser) throw new Error('请先登录平台账号');
    const code = (inviteCode || '').trim();
    if (!code) throw new Error('请输入有效的课程邀请码');

    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('登录会话已失效，请重新登录');

    // 1. 优先调用 Edge Function: join-course
    try {
      const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/join-course`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ invite_code: code }),
      });

      if (resp.ok) {
        const json = await resp.json();
        await refreshEnrollments();
        return json;
      } else if (resp.status !== 404) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || `选课失败 (HTTP ${resp.status})`);
      }
    } catch (e) {
      if (!e.message.includes('HTTP 404') && !e.message.includes('Failed to fetch')) {
        throw e;
      }
      // Edge Function 404 则继续尝试 RPC / 直接查询方案
    }

    // 2. 尝试 Supabase RPC: join_course_by_code
    try {
      const { data, error } = await supabase.rpc('join_course_by_code', { p_code: code });
      if (!error && data) {
        if (!data.ok) throw new Error(data.error || '加入课程失败');
        await refreshEnrollments();
        return data;
      }
    } catch (rpcErr) {
      if (rpcErr.message && !rpcErr.message.includes('function') && !rpcErr.message.includes('not found')) {
        throw rpcErr;
      }
    }

    // 3. 回退查询 courses 表（若公开可读）
    const { data: matchedCourses } = await supabase
      .from('courses')
      .select('id, name, code, invite_code')
      .or(`code.ilike.${code},invite_code.ilike.${code}`)
      .limit(1);

    if (matchedCourses && matchedCourses.length > 0) {
      const c = matchedCourses[0];
      const { error: insErr } = await supabase
        .from('enrollments')
        .insert({ course_id: c.id, user_id: currentUser.id, role: 'student' });

      if (!insErr) {
        await refreshEnrollments();
        return { ok: true, message: `成功选修课程 ${c.code} ${c.name}`, course_name: c.name, course_code: c.code };
      }
    }

    throw new Error('未找到匹配的课程，或邀请码不存在/已过期');
  }

  // --- 作业与提交 ---
  async function getAssignmentForProblem(problemId, courseId = null) {
    if (!supabase) return null;
    try {
      let query = supabase
        .from('assignments')
        .select('id, course_id, problem_id, due_at, pass_score, n_instances, score_policy, created_at')
        .eq('problem_id', problemId);

      if (courseId) {
        query = query.eq('course_id', courseId);
      } else if (currentEnrollments.length > 0) {
        const courseIds = currentEnrollments.map(e => e.course_id);
        query = query.in('course_id', courseIds);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('[Platform] getAssignmentForProblem error:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[Platform] getAssignmentForProblem exception:', e);
      return null;
    }
  }

  async function submitAssignment(assignmentId, codeText) {
    if (!isConfigured()) {
      throw new Error('未配置平台后端服务');
    }
    if (!currentUser || !supabase) {
      throw new Error('请先登录平台账号再提交正式作业');
    }

    // 学号门禁校验
    if (!isTeacher() && (!currentProfile?.student_no || !currentProfile.student_no.trim())) {
      throw new Error('提交正式作业前，请先在右上角绑定您的真实学号与姓名！');
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('登录会话已过期，请重新登录');

    const cfg = window.SCIP_OJ_CONFIG;

    if (cfg.MOCK_MODE) {
      return {
        submission_id: 'mock-' + Date.now(),
        public_code: 'SUB-MOCK' + Math.floor(Math.random() * 9000 + 1000),
        status: 'queued',
        warning: '（Mock 模式提交测试）',
      };
    }

    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/submit-assignment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ assignment_id: assignmentId, code_text: codeText }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status} ${resp.statusText}` }));
    if (!resp.ok) {
      // 翻译友好文案
      if (resp.status === 403 && json.error?.includes('未选修')) {
        throw new Error('您未选修本门课程，请先输入课程邀请码选课！');
      }
      throw new Error(json.error || '提交作业失败');
    }
    return json;
  }

  async function getMySubmissions(assignmentId) {
    if (!supabase || !currentUser) return [];
    try {
      let query = supabase
        .from('submissions')
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
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (assignmentId) {
        query = query.eq('assignment_id', assignmentId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('[Platform] getMySubmissions error:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('[Platform] getMySubmissions exception:', e);
      return [];
    }
  }

  // --- 教师功能 ---
  async function getMyCourses() {
    return await refreshEnrollments();
  }

  async function getTeacherRoster(courseId) {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('course_gradebook')
      .select('*')
      .eq('course_id', courseId);

    if (error) throw error;
    return data || [];
  }

  async function getPendingRoster(courseId) {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('roster_pending')
        .select('*')
        .eq('course_id', courseId)
        .order('student_no', { ascending: true });

      if (error) {
        console.warn('[Platform] getPendingRoster error:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('[Platform] getPendingRoster exception:', e);
      return [];
    }
  }

  async function importRosterCSV(courseId, csvText) {
    if (!supabase || !currentUser) throw new Error('请先登录教师账号');
    if (!csvText || !csvText.trim()) throw new Error('CSV 内容不能为空');

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new Error('未解析到有效行');

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过纯表头
      if (i === 0 && (line.includes('学号') || line.toLowerCase().includes('student_no'))) {
        continue;
      }
      const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 2) continue;
      const student_no = parts[0];
      const display_name = parts[1];
      const github_login = parts[2] || null;
      if (student_no && display_name) {
        rows.push({
          course_id: courseId,
          student_no,
          display_name,
          github_login,
          status: 'pending',
        });
      }
    }

    if (rows.length === 0) {
      throw new Error('未从 CSV 中解析出有效记录（格式：学号,姓名,可选GitHub用户名）');
    }

    // 尝试写入 roster_pending
    const { data, error } = await supabase
      .from('roster_pending')
      .upsert(rows, { onConflict: 'course_id,student_no' })
      .select();

    if (error) {
      throw new Error('导入花名册失败: ' + error.message);
    }

    return { total: rows.length, inserted: data ? data.length : rows.length };
  }

  async function publishAssignment(params) {
    if (!supabase || !currentUser) throw new Error('请先登录教师账号');
    const { course_id, problem_id, due_at, pass_score = 90, n_instances = 3, score_policy = 'highest_before_due' } = params;

    const cfg = window.SCIP_OJ_CONFIG;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('登录会话已失效');

    // 优先调用 Edge Function: publish-assignment
    try {
      const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/publish-assignment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
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
      if (!e.message.includes('HTTP 404') && !e.message.includes('Failed to fetch')) {
        throw e;
      }
    }

    // 回退直接写入 assignments 表
    const { data, error } = await supabase
      .from('assignments')
      .upsert({
        course_id,
        problem_id: problem_id.toUpperCase(),
        due_at: due_at ? new Date(due_at).toISOString() : null,
        pass_score: parseInt(pass_score, 10),
        n_instances: parseInt(n_instances, 10),
        score_policy,
      }, { onConflict: 'course_id,problem_id' })
      .select()
      .single();

    if (error) {
      throw new Error('保存作业配置失败: ' + error.message);
    }
    return { ok: true, assignment: data };
  }

  async function requestRegrade(submissionId, reason) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('请先登录');

    const cfg = window.SCIP_OJ_CONFIG;
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ submission_id: submissionId, reason: reason || '教师手动复判' }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (!resp.ok) {
      throw new Error(json.error || '复判请求失败');
    }
    return json;
  }

  async function requestBatchRegrade(submissionIds, reason, onProgress) {
    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      throw new Error('未选择任何待复判记录');
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('请先登录');

    const cfg = window.SCIP_OJ_CONFIG;
    // 优先调用 Edge Function: regrade-batch
    try {
      const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ submission_ids: submissionIds, reason }),
      });

      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('[Platform] regrade-batch 端点不可用，回退并发/排队单条复判:', e);
    }

    // 回退循坏调用单条 regrade
    let successCount = 0;
    const results = [];
    for (let i = 0; i < submissionIds.length; i++) {
      const subId = submissionIds[i];
      try {
        await requestRegrade(subId, reason);
        successCount++;
        results.push({ id: subId, success: true });
      } catch (err) {
        results.push({ id: subId, success: false, error: err.message });
      }
      if (typeof onProgress === 'function') {
        onProgress(i + 1, submissionIds.length);
      }
    }
    return { ok: true, total: submissionIds.length, success_count: successCount, results };
  }

  async function requestProblemRegrade(courseId, problemId, reason, onProgress) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('请先登录');

    const cfg = window.SCIP_OJ_CONFIG;
    try {
      const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ course_id: courseId, problem_id: problemId, reason }),
      });

      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('[Platform] regrade-batch 整题重判不可用，回退获取提交列表:', e);
    }

    // 回退：查询该作业下的提交 ID
    const { data: assignments } = await supabase
      .from('assignments')
      .select('id')
      .eq('course_id', courseId)
      .eq('problem_id', problemId)
      .maybeSingle();

    if (!assignments) throw new Error('未找到该作业');

    const { data: subs } = await supabase
      .from('submissions')
      .select('id')
      .eq('assignment_id', assignments.id);

    const ids = (subs || []).map(s => s.id);
    if (ids.length === 0) throw new Error('该题目暂无任何学生提交记录');

    return await requestBatchRegrade(ids, reason || `整题重判 (${problemId})`, onProgress);
  }

  async function rotateCourseInviteCode(courseId, newCode = null) {
    if (!supabase || !currentUser) throw new Error('请先登录');
    const code = newCode ? newCode.trim().toUpperCase() : 'SCIP-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // 更新 courses.invite_code
    await supabase.from('courses').update({ invite_code: code }).eq('id', courseId);

    // 写入 course_invites 表
    await supabase.from('course_invites').insert({
      course_id: courseId,
      code,
      role: 'student',
    });

    await refreshEnrollments();
    return code;
  }

  // --- UI 渲染与弹窗 ---
  function updateAuthUI() {
    const authArea = document.getElementById('auth-area');
    if (!authArea) return;

    if (!isConfigured()) {
      authArea.innerHTML = `<span class="user-info" style="color:#8b949e" title="未配置 Supabase 服务端。力扣壳处于离线练习模式，L1 WASM 正常工作。">🌿 离线练习模式</span>`;
      const teacherLink = document.getElementById('teacher-link');
      if (teacherLink) teacherLink.hidden = true;
      return;
    }

    if (currentUser) {
      const meta = currentUser.user_metadata || {};
      const name = currentProfile?.display_name || meta.display_name || meta.user_name || meta.preferred_username || (currentUser.email ? currentUser.email.split('@')[0] : 'GitHub 用户');
      const sNo = currentProfile?.student_no;
      const role = currentProfile?.role || meta.role || 'student';
      const isTeach = isTeacher();

      let roleBadge = '';
      if (isTeach) {
        roleBadge = '<span class="user-badge" style="background:#8957e533;color:#d2a8ff">教师</span>';
      }

      let studentBadge = '';
      if (!isTeach) {
        if (sNo) {
          studentBadge = `<span class="user-badge" style="background:#23863633;color:#3fb950" title="已绑定学号">${escapeHtml(sNo)}</span>`;
        } else {
          studentBadge = `<button id="btn-bind-sno-quick" type="button" class="btn-secondary" style="font-size:0.72rem;padding:0.15rem 0.45rem;color:#f85149;border:1px solid #da363366;" title="未绑定学号，点击填写">⚠️ 未填学号</button>`;
        }
      }

      authArea.innerHTML = `
        <span class="user-info">
          👤 <strong>${escapeHtml(name)}</strong> ${studentBadge} ${roleBadge}
        </span>
        <button id="btn-edit-profile" type="button" class="btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.6rem" title="修改学号与姓名">资料</button>
        <button id="btn-join-course-nav" type="button" class="btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.6rem" title="加入新课程">选课</button>
        <button id="btn-signout" type="button" class="btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.6rem">登出</button>
      `;

      const btnOut = document.getElementById('btn-signout');
      if (btnOut) btnOut.onclick = () => signOut();

      const btnEdit = document.getElementById('btn-edit-profile');
      if (btnEdit) btnEdit.onclick = () => showStudentNoDialog();

      const btnJoin = document.getElementById('btn-join-course-nav');
      if (btnJoin) btnJoin.onclick = () => showJoinCourseDialog();

      const btnQuick = document.getElementById('btn-bind-sno-quick');
      if (btnQuick) btnQuick.onclick = () => showStudentNoDialog();

      const teacherLink = document.getElementById('teacher-link');
      if (teacherLink) {
        teacherLink.hidden = !isTeach;
      }
    } else {
      authArea.innerHTML = `<button id="btn-signin" type="button" style="font-size:0.85rem;padding:0.35rem 0.8rem">用 GitHub 登录</button>`;
      const btnIn = document.getElementById('btn-signin');
      if (btnIn) btnIn.onclick = () => showLoginDialog();

      const teacherLink = document.getElementById('teacher-link');
      if (teacherLink) teacherLink.hidden = true;
    }
  }

  // --- 学生门禁检查（未填学号/未选课引导） ---
  function checkStudentGates() {
    if (!currentUser || isTeacher()) return;

    // 门禁 1：若未绑定学号，引导绑定
    if (!currentProfile?.student_no) {
      setTimeout(() => {
        showStudentNoDialog({
          forced: true,
          onComplete: () => {
            // 门禁 2：学号填完后，若未选修任何课程，引导输入邀请码
            if (currentEnrollments.length === 0) {
              showJoinCourseDialog({ forced: true });
            }
          }
        });
      }, 400);
      return;
    }

    // 门禁 2：若已填学号但未选修任何课程，引导选课
    if (currentEnrollments.length === 0) {
      setTimeout(() => {
        showJoinCourseDialog({ forced: true });
      }, 400);
    }
  }

  // --- 弹窗: 登录 ---
  function showLoginDialog() {
    if (!isConfigured()) {
      alert('平台未配置云端服务。当前处于离线练习模式，无需登录即可使用「⚡ L1 练习评分」。');
      return;
    }

    let dialog = document.getElementById('login-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'login-dialog';
      dialog.className = 'modal-overlay';
      dialog.innerHTML = `
        <div class="modal-content">
          <h3>登录 SCIP-OJ 作业平台</h3>
          <p style="color:#8b949e;font-size:0.9rem;margin:0.5rem 0 1rem">使用 GitHub 账号登录（无需提交 PR，仅用于身份认证与成绩归属）。</p>
          <p id="login-error" class="fail" style="font-size:0.85rem;margin:0.5rem 0" hidden></p>
          <div class="modal-actions" style="justify-content:flex-end;gap:0.5rem">
            <button type="button" id="login-cancel" class="btn-secondary">取消</button>
            <button type="button" id="login-github">用 GitHub 登录</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);

      document.getElementById('login-cancel').onclick = () => {
        dialog.hidden = true;
      };

      document.getElementById('login-github').onclick = async () => {
        const errEl = document.getElementById('login-error');
        const btn = document.getElementById('login-github');
        errEl.hidden = true;
        btn.disabled = true;
        btn.textContent = '跳转 GitHub…';
        try {
          await signInWithGitHub();
        } catch (err) {
          errEl.textContent = err.message || '登录失败';
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = '用 GitHub 登录';
        }
      };
    }

    dialog.hidden = false;
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.hidden = true;
  }

  // --- 弹窗: 学号与姓名绑定 ---
  function showStudentNoDialog(options = {}) {
    const forced = !!options.forced;
    let dialog = document.getElementById('student-no-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'student-no-dialog';
      dialog.className = 'modal-overlay';
      dialog.innerHTML = `
        <div class="modal-content" style="max-width:440px;">
          <h3>👤 绑定课程学号与真实姓名</h3>
          <p style="color:#8b949e;font-size:0.85rem;margin:0.5rem 0 1rem">
            为了确保您的正式作业成绩能准确录入教师成绩册，请核对并绑定您的<strong>学号</strong>与<strong>真实姓名</strong>。
          </p>
          <div style="margin-bottom:0.75rem;">
            <label style="font-size:0.85rem;color:#8b949e;display:block;margin-bottom:0.25rem;">学号（例如 20260001）：</label>
            <input type="text" id="input-student-no" placeholder="输入学号" style="width:100%;box-sizing:border-box;" />
          </div>
          <div style="margin-bottom:0.75rem;">
            <label style="font-size:0.85rem;color:#8b949e;display:block;margin-bottom:0.25rem;">真实姓名 / 显示名：</label>
            <input type="text" id="input-display-name" placeholder="输入真实姓名" style="width:100%;box-sizing:border-box;" />
          </div>
          <p id="sno-error" class="fail" style="font-size:0.85rem;margin:0.5rem 0" hidden></p>
          <div class="modal-actions">
            <button type="button" id="btn-sno-cancel" class="btn-secondary">取消</button>
            <button type="button" id="btn-sno-save" class="btn-blue">保存资料</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    const inputNo = document.getElementById('input-student-no');
    const inputName = document.getElementById('input-display-name');
    const errEl = document.getElementById('sno-error');
    const btnCancel = document.getElementById('btn-sno-cancel');
    const btnSave = document.getElementById('btn-sno-save');

    inputNo.value = currentProfile?.student_no || '';
    inputName.value = currentProfile?.display_name || '';
    errEl.hidden = true;
    btnCancel.hidden = forced && !currentProfile?.student_no; // 若强门禁且从未填写过学号，隐藏取消

    btnCancel.onclick = () => { dialog.hidden = true; };

    btnSave.onclick = async () => {
      const sNo = inputNo.value.trim();
      const sName = inputName.value.trim();
      if (!sNo) {
        errEl.textContent = '学号不能为空';
        errEl.hidden = false;
        return;
      }
      if (!sName) {
        errEl.textContent = '姓名不能为空';
        errEl.hidden = false;
        return;
      }
      btnSave.disabled = true;
      btnSave.textContent = '保存中…';
      try {
        await updateProfile({ student_no: sNo, display_name: sName });
        dialog.hidden = true;
        if (typeof options.onComplete === 'function') {
          options.onComplete();
        }
      } catch (err) {
        errEl.textContent = err.message || '保存失败';
        errEl.hidden = false;
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存资料';
      }
    };

    dialog.hidden = false;
  }

  // --- 弹窗: 输入课程邀请码选课 ---
  function showJoinCourseDialog(options = {}) {
    const forced = !!options.forced;
    let dialog = document.getElementById('join-course-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'join-course-dialog';
      dialog.className = 'modal-overlay';
      dialog.innerHTML = `
        <div class="modal-content" style="max-width:440px;">
          <h3>🎓 输入课程邀请码</h3>
          <p style="color:#8b949e;font-size:0.85rem;margin:0.5rem 0 1rem">
            请输入任课教师提供的<strong>课程邀请码</strong>（例如 <code>REDACTED-INVITE</code>），加入对应班级后方可提交正式作业。
          </p>
          <div style="margin-bottom:0.75rem;">
            <input type="text" id="input-invite-code" placeholder="输入课程邀请码，如 REDACTED-INVITE" style="width:100%;box-sizing:border-box;" />
          </div>
          <p id="join-course-error" class="fail" style="font-size:0.85rem;margin:0.5rem 0" hidden></p>
          <div class="modal-actions">
            <button type="button" id="btn-join-cancel" class="btn-secondary">稍后再说</button>
            <button type="button" id="btn-join-submit" class="btn-blue">加入课程</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    const inputCode = document.getElementById('input-invite-code');
    const errEl = document.getElementById('join-course-error');
    const btnCancel = document.getElementById('btn-join-cancel');
    const btnSubmit = document.getElementById('btn-join-submit');

    inputCode.value = '';
    errEl.hidden = true;
    btnCancel.onclick = () => { dialog.hidden = true; };

    btnSubmit.onclick = async () => {
      const code = inputCode.value.trim();
      if (!code) {
        errEl.textContent = '请输入邀请码';
        errEl.hidden = false;
        return;
      }
      btnSubmit.disabled = true;
      btnSubmit.textContent = '校验加入中…';
      try {
        const res = await joinCourse(code);
        alert(res.message || '选课成功！');
        dialog.hidden = true;
        if (typeof options.onComplete === 'function') {
          options.onComplete(res);
        }
      } catch (err) {
        errEl.textContent = err.message || '加入课程失败';
        errEl.hidden = false;
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '加入课程';
      }
    };

    dialog.hidden = false;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[c] || c));
  }

  return {
    init,
    isConfigured,
    isMockMode,
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
    checkStudentGates,
    escapeHtml,
  };
})();

window.ScipOJPlatform = ScipOJPlatform;
