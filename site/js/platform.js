/**
 * SCIP-OJ 平台层 — Supabase 鉴权、提交作业、查询成绩
 * 依赖: window.SCIP_OJ_CONFIG (from config.js)
 * 注意: 绝不写正式分到 localStorage；anon key 进前端，service_role 严禁进前端
 */

const ScipOJPlatform = (() => {
  let supabase = null;
  let currentUser = null;
  let currentProfile = null;
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
      // 检查当前会话
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUser = session.user;
        await refreshProfile();
      }

      // 监听认证状态变化
      supabase.auth.onAuthStateChange(async (event, session) => {
        currentUser = session?.user || null;
        if (currentUser) {
          await refreshProfile();
        } else {
          currentProfile = null;
        }
        updateAuthUI();
        notifyAuthListeners();
      });
    } catch (e) {
      console.warn('[Platform] 会话恢复异常:', e);
    }

    updateAuthUI();
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
          display_name: meta.display_name || meta.user_name || meta.preferred_username || (currentUser.email ? currentUser.email.split('@')[0] : 'GitHub User'),
          role: meta.role || 'student',
        };
      }
    } catch (e) {
      console.warn('[Platform] 加载用户资料异常:', e);
    }
    return currentProfile;
  }

  function getUser() { return currentUser; }
  function getProfile() { return currentProfile; }
  function getSupabase() { return supabase; }

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
    updateAuthUI();
    notifyAuthListeners();
  }

  // --- 作业与提交 ---
  async function getAssignmentForProblem(problemId) {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('assignments')
        .select('id, course_id, problem_id, due_at, pass_score, n_instances, score_policy')
        .eq('problem_id', problemId)
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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('登录会话已过期，请重新登录');

    const cfg = window.SCIP_OJ_CONFIG;

    if (cfg.MOCK_MODE) {
      // 本地 Mock 模式（前端无后端环境时）
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
    if (!supabase || !currentUser) return [];
    try {
      const { data, error } = await supabase
        .from('enrollments')
        .select('course_id, role, courses(id, name, code)')
        .eq('user_id', currentUser.id);

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[Platform] getMyCourses error:', e);
      return [];
    }
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
      body: JSON.stringify({ submission_id: submissionId, reason }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (!resp.ok) {
      throw new Error(json.error || '复判请求失败');
    }
    return json;
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
      const name = currentProfile?.display_name || meta.display_name || meta.user_name || meta.preferred_username || currentUser.email || 'GitHub 用户';
      const sNo = currentProfile?.student_no || meta.student_no;
      const role = currentProfile?.role || meta.role || 'student';
      const tip = currentUser.email || meta.user_name || currentUser.id;

      let roleBadge = '';
      if (role === 'teacher') {
        roleBadge = '<span class="user-badge" style="background:#8957e533;color:#d2a8ff">教师</span>';
      } else if (role === 'admin') {
        roleBadge = '<span class="user-badge" style="background:#da363333;color:#f85149">管理员</span>';
      }

      authArea.innerHTML = `
        <span class="user-info" title="${escapeHtml(tip)}">
          👤 ${escapeHtml(name)}${sNo ? ` (${escapeHtml(sNo)})` : ''}${roleBadge}
        </span>
        <button id="btn-signout" type="button" class="btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem">登出</button>
      `;
      const btnOut = document.getElementById('btn-signout');
      if (btnOut) btnOut.onclick = () => signOut();

      const teacherLink = document.getElementById('teacher-link');
      if (teacherLink) {
        teacherLink.hidden = (role !== 'teacher' && role !== 'admin');
      }
    } else {
      authArea.innerHTML = `<button id="btn-signin" type="button" style="font-size:0.85rem;padding:0.35rem 0.8rem">用 GitHub 登录</button>`;
      const btnIn = document.getElementById('btn-signin');
      if (btnIn) btnIn.onclick = () => showLoginDialog();

      const teacherLink = document.getElementById('teacher-link');
      if (teacherLink) teacherLink.hidden = true;
    }
  }

  function showLoginDialog() {
    if (!isConfigured()) {
      alert('平台未配置云端服务（未找到 config.js 或未设置 SUPABASE_URL）。当前处于离线练习模式，无需登录即可使用「L1 练习评分」。');
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
          <p style="color:#8b949e;font-size:0.9rem;margin:0.5rem 0 1rem">使用 GitHub 账号登录（无需提交 PR，仅用于身份认证）。</p>
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
          // Browser redirects away on success
        } catch (err) {
          errEl.textContent = err.message || '登录失败';
          errEl.className = 'fail';
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
    onAuthChange,
    signInWithGitHub,
    signInWithEmail,
    signUp,
    signOut,
    submitAssignment,
    getMySubmissions,
    getAssignmentForProblem,
    getMyCourses,
    getTeacherRoster,
    requestRegrade,
    updateAuthUI,
    showLoginDialog,
    escapeHtml,
  };
})();

window.ScipOJPlatform = ScipOJPlatform;
