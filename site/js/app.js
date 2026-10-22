const BASE = new URL(".", location.href);

async function loadJSON(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("load failed " + path);
  return r.json();
}

async function loadText(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("load failed " + path);
  return r.text();
}

let activeProblemId = null;
let activeAssignment = null;
let pollTimer = null;

async function main() {
  // 1. 初始化平台层（Supabase 鉴权与配置检测）
  if (window.ScipOJPlatform) {
    try {
      await window.ScipOJPlatform.init();
    } catch (e) {
      console.warn('[App] 平台初始化异常:', e);
    }
  }

  // 2. 加载题目索引
  const listEl = document.getElementById("problem-list");
  const index = await loadJSON("problems/index.json");
  listEl.innerHTML =
    "<h2>题单</h2>" +
    index
      .map(
        (p) =>
          `<a class="card" href="#${p.id}" data-id="${p.id}" data-path="${p.path}"><strong>${p.id}</strong> ${p.title}<br/><small>${p.difficulty} · ${(p.tags || []).join(", ")}</small></a>`
      )
      .join("");

  listEl.querySelectorAll("a.card").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      location.hash = `#${a.dataset.id}`;
      await openProblem(a.dataset.path, a.dataset.id);
    })
  );

  window.addEventListener("hashchange", async () => {
    if (location.hash) {
      const id = location.hash.slice(1);
      const p = index.find((x) => x.id === id);
      if (p && p.id !== activeProblemId) await openProblem(p.path, p.id);
    }
  });

  if (location.hash) {
    const id = location.hash.slice(1);
    const p = index.find((x) => x.id === id);
    if (p) await openProblem(p.path, p.id);
  }

  // 预热 Python WASM 运行环境
  if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
    window.ScipOJRuntime.ensureReady().catch((e) => {
      console.log("Background Python pre-warm:", e);
    });
  }

  // 监听登录状态变化，自动刷新当前题目的提交列表
  if (window.ScipOJPlatform) {
    window.ScipOJPlatform.onAuthChange(() => {
      if (activeProblemId) {
        refreshSubmissionsList();
      }
    });
  }

  // 绑定排行榜按钮
  const btnLeaderboard = document.getElementById("btn-show-leaderboard");
  if (btnLeaderboard) {
    btnLeaderboard.onclick = () => showLeaderboardDialog();
  }
}

async function openProblem(path, id) {
  activeProblemId = id;
  const ws = document.getElementById("workspace");
  ws.hidden = false;

  const meta = await loadJSON(`${path}/meta.json`);
  const readme = await loadText(`${path}/README.md`);
  const template = await loadText(`${path}/template.py`);

  document.getElementById("title").textContent = `${meta.id} · ${meta.title || ''}（通过线 ${meta.pass_score} 分）`;
  document.getElementById("readme").innerHTML = window.marked ? marked.parse(readme) : `<pre>${escapeHtml(readme)}</pre>`;
  document.getElementById("code").value = template;
  document.getElementById("report").textContent = "";
  document.getElementById("status").textContent = "";

  const btnGradeL1 = document.getElementById("btn-grade");
  const btnSubmitFormal = document.getElementById("btn-submit-formal");
  const statusEl = document.getElementById("status");
  const reportEl = document.getElementById("report");
  const metaBar = document.getElementById("assignment-meta-bar");
  const btnRefreshSubmissions = document.getElementById("btn-refresh-submissions");

  // ── 检查平台作业信息 ──
  activeAssignment = null;
  if (window.ScipOJPlatform && window.ScipOJPlatform.isConfigured()) {
    try {
      activeAssignment = await window.ScipOJPlatform.getAssignmentForProblem(id);
    } catch (e) {
      console.warn('[App] 获取作业信息失败:', e);
    }
  }

  if (activeAssignment) {
    metaBar.hidden = false;
    const dueStr = activeAssignment.due_at ? new Date(activeAssignment.due_at).toLocaleString('zh-CN') : '长期有效';
    const policyMap = {
      highest_before_due: '截止前最高分 (默认)',
      highest: '历史最高分',
      latest: '最新提交分',
    };
    metaBar.innerHTML = `
      <span>📅 <strong>截止时间</strong>：${dueStr}</span>
      <span>🎯 <strong>及格分数</strong>：${activeAssignment.pass_score} 分</span>
      <span>⚖️ <strong>计分规则</strong>：${policyMap[activeAssignment.score_policy] || activeAssignment.score_policy}</span>
      <span>🧪 <strong>正式测例</strong>：${activeAssignment.n_instances || 3} 个</span>
    `;
    btnSubmitFormal.disabled = false;
    btnSubmitFormal.title = "提交至服务端进行 PySCIPOpt 权威评测，记录为正式作业成绩";
    btnSubmitFormal.style.opacity = "1";
  } else {
    metaBar.hidden = false;
    metaBar.innerHTML = `
      <span style="color:#8b949e;">🌿 <strong>自主练习模式</strong>：本题目当前未作为任何选修课程的正式作业发布，您可在此进行 L1 练习评分与算法调试。</span>
    `;
    btnSubmitFormal.disabled = true;
    btnSubmitFormal.title = "当前题目未作为课程正式作业开放提交（教师尚未发布）";
    btnSubmitFormal.style.opacity = "0.5";
  }

  // ── L1 练习评分（浏览器 WASM 本地执行，不记入正式成绩） ──
  btnGradeL1.onclick = async () => {
    const userCode = document.getElementById("code").value;
    const grader = meta.grader || "knapsack";
    const timeLimitSec = meta.time_limit_sec || 10;

    btnGradeL1.disabled = true;
    reportEl.textContent = "";
    statusEl.className = "";
    statusEl.textContent = "⏳ 正在准备 Python WASM 运行环境（首次加载需数秒）...";

    let runtimeAvailable = false;
    if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
      try {
        await window.ScipOJRuntime.ensureReady((msg) => {
          statusEl.textContent = msg;
        });
        runtimeAvailable = true;
      } catch (err) {
        console.warn("Python runtime init failed, falling back to demo solver:", err);
      }
    }

    try {
      let report;
      if (runtimeAvailable) {
        statusEl.textContent = `⏳ 正在执行 Python WASM 练习（超时限制 ${timeLimitSec}s）...`;
        const studentSolve = async (instance) => {
          return await window.ScipOJRuntime.runSolve(userCode, instance, timeLimitSec);
        };
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(studentSolve, meta);
        } else {
          report = await window.ScipOJJudge.runL1(studentSolve, meta);
        }
        report.execution_mode = "python-wasm-student-code";
        report.execution_note = "已在浏览器 WASM 环境中执行代码（练习模式，不作正式成绩）";
      } else {
        statusEl.textContent = "⚠️ Python 运行时不可用，降级使用内置 Demo 评分...";
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(window.ScipOJAssignment.demoSolveAssignment, meta);
        } else {
          report = await window.ScipOJJudge.runL1(window.ScipOJJudge.demoSolve, meta);
        }
        report.execution_mode = "demo-solve-fallback";
        report.execution_note = "降级提示：浏览器 Python 运行时未能启动，此评分为内置 Demo 兜底评分。";
        report.messages = report.messages || [];
        report.messages.unshift("[降级警告] 未能启动浏览器 Python 运行时，此评分为内置 Demo 兜底评分。");
      }

      reportEl.textContent = JSON.stringify(report, null, 2);
      statusEl.textContent = report.passed
        ? `L1 练习通过 · ${report.score} 分`
        : `L1 练习未通过 · ${report.score} 分`;
      statusEl.className = report.passed ? "pass" : "fail";
      if (!runtimeAvailable) {
        statusEl.textContent += "（Demo 兜底）";
        statusEl.className = "warn";
      }
      localStorage.setItem("scip-oj-practice:" + id, JSON.stringify({ score: report.score, at: Date.now() }));
    } catch (e) {
      statusEl.textContent = "练习判分异常: " + (e?.message || e);
      statusEl.className = "fail";
      reportEl.textContent = String(e?.stack || e);
    } finally {
      btnGradeL1.disabled = false;
    }
  };

  // ── 提交正式作业（服务端评测） ──
  btnSubmitFormal.onclick = async () => {
    if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
      alert("【离线练习模式】\n\n当前平台未配置 Supabase 服务端，暂不支持在线提交正式作业。\n您可以在此页正常使用「⚡ L1 练习评分」进行代码自测。");
      return;
    }

    if (!window.ScipOJPlatform.getUser()) {
      window.ScipOJPlatform.showLoginDialog();
      return;
    }

    // 检查学号门禁
    const profile = window.ScipOJPlatform.getProfile();
    const isTeacher = window.ScipOJPlatform.isTeacher();
    if (!isTeacher && (!profile?.student_no || !profile.student_no.trim())) {
      window.ScipOJPlatform.showStudentNoDialog({
        forced: true,
        onComplete: () => {
          btnSubmitFormal.click();
        }
      });
      return;
    }

    // 检查选课门禁
    const enrollments = window.ScipOJPlatform.getEnrollments();
    if (!isTeacher && enrollments.length === 0) {
      window.ScipOJPlatform.showJoinCourseDialog({
        forced: true,
        onComplete: async () => {
          // 重新查询该题目在该课下的作业
          activeAssignment = await window.ScipOJPlatform.getAssignmentForProblem(id);
          btnSubmitFormal.click();
        }
      });
      return;
    }

    if (!activeAssignment) {
      alert(`题目 ${id} 暂未在您选修的课程中开放正式作业提交。`);
      return;
    }

    const userCode = document.getElementById("code").value.trim();
    if (!userCode) {
      alert("提交代码不能为空");
      return;
    }

    btnSubmitFormal.disabled = true;
    statusEl.className = "";
    statusEl.textContent = "🚀 正在向服务端提交作业代码...";

    try {
      const res = await window.ScipOJPlatform.submitAssignment(activeAssignment.id, userCode);
      statusEl.className = "pass";
      statusEl.textContent = `✅ 提交成功！公开编号 ${res.public_code || res.submission_id}，已进入服务端评测队列。`;
      if (res.warning) {
        statusEl.textContent += ` (${res.warning})`;
        statusEl.className = "warn";
      }
      await refreshSubmissionsList();
      startSubmissionsPolling();
    } catch (err) {
      statusEl.className = "fail";
      statusEl.textContent = `❌ 提交失败: ${err.message}`;
    } finally {
      btnSubmitFormal.disabled = false;
    }
  };

  // 刷新提交记录按钮
  btnRefreshSubmissions.onclick = async () => {
    btnRefreshSubmissions.disabled = true;
    btnRefreshSubmissions.textContent = "刷新中…";
    await refreshSubmissionsList();
    btnRefreshSubmissions.disabled = false;
    btnRefreshSubmissions.textContent = "刷新提交记录";
  };

  // 初始加载提交记录
  await refreshSubmissionsList();
}

/** 刷新学生的历史提交记录 */
async function refreshSubmissionsList() {
  const container = document.getElementById("my-submissions-container");
  if (!container) return;

  if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
    container.innerHTML = `
      <p style="color:#8b949e; font-size:0.9rem;">
        🌿 <strong>当前处于离线练习模式</strong>：未配置 Supabase 后端。<br/>
        您可以直接使用「⚡ L1 练习评分」在本地 WASM 环境中编写与自测代码。
      </p>
    `;
    return;
  }

  const user = window.ScipOJPlatform.getUser();
  if (!user) {
    container.innerHTML = `
      <p style="color:#8b949e; font-size:0.9rem;">
        请 <a href="javascript:void(0)" id="link-login-prompt" style="font-weight:600;">用 GitHub 登录账号</a> 以查看您在该题目的历史提交、评测状态与正式成绩。
      </p>
    `;
    const link = document.getElementById("link-login-prompt");
    if (link) link.onclick = () => window.ScipOJPlatform.showLoginDialog();
    return;
  }

  container.innerHTML = `<p style="color:#8b949e; font-size:0.88rem;">正在加载提交记录...</p>`;

  try {
    const assignmentId = activeAssignment?.id || null;
    const submissions = await window.ScipOJPlatform.getMySubmissions(assignmentId);

    if (submissions.length === 0) {
      container.innerHTML = `
        <p style="color:#8b949e; font-size:0.88rem;">
          您尚未对该题目提交正式作业。编写完成后点击「🚀 提交正式作业」即可发起权威评测。
        </p>
      `;
      return;
    }

    renderSubmissionsTable(container, submissions);

    // 检查是否仍有未完成的评测，若有则维持轮询
    const hasPending = submissions.some(s => {
      const g = Array.isArray(s.gradings) ? s.gradings[0] : s.gradings;
      return g?.status === 'queued' || g?.status === 'running';
    });

    if (hasPending && !pollTimer) {
      startSubmissionsPolling();
    } else if (!hasPending && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (err) {
    container.innerHTML = `<p class="fail" style="font-size:0.88rem;">加载提交记录失败: ${escapeHtml(err.message)}</p>`;
  }
}

/** 渲染提交记录表格 */
function renderSubmissionsTable(container, list) {
  const table = document.createElement("table");
  table.className = "submissions-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>提交编号</th>
        <th>轮次</th>
        <th>评测状态</th>
        <th>得分</th>
        <th>判定</th>
        <th>提交时间</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map((sub, idx) => {
          const grading = Array.isArray(sub.gradings) ? sub.gradings[0] : sub.gradings;
          const status = grading?.status || "queued";
          const score = grading?.score;
          const passed = grading?.passed;

          let statusBadge = "";
          if (status === "queued") {
            statusBadge = '<span class="badge badge-queued">⏳ 排队中</span>';
          } else if (status === "running") {
            statusBadge = '<span class="badge badge-running">⚙️ 评测中</span>';
          } else if (status === "done") {
            statusBadge = '<span class="badge badge-done">已完成</span>';
          } else if (status === "system_error") {
            statusBadge = '<span class="badge badge-system_error" title="系统环境故障，不扣除学生分数">⚠️ 系统故障</span>';
          }

          let scoreDisplay = "-";
          if (status === "done") {
            scoreDisplay = `<strong class="${score >= (activeAssignment?.pass_score || 90) ? 'pass' : 'fail'}">${score} 分</strong>`;
          } else if (status === "system_error") {
            scoreDisplay = '<span style="color:#8b949e" title="系统错误不计 0 分">未出分 (系统错误)</span>';
          }

          let passDisplay = "-";
          if (status === "done") {
            passDisplay = passed ? '<span class="pass">✓ 通过</span>' : '<span class="fail">✗ 未通过</span>';
          } else if (status === "system_error") {
            passDisplay = '<span class="warn">等待重试</span>';
          }

          const isLate = sub.metadata?.late;
          const timeStr = sub.created_at ? new Date(sub.created_at).toLocaleString('zh-CN') : '-';

          return `
            <tr>
              <td><code>${escapeHtml(sub.public_code || sub.id.slice(0, 8))}</code> ${isLate ? '<span class="tag-late" style="font-size:0.7rem;">迟交</span>' : ''}</td>
              <td>第 ${sub.attempt_no || 1} 次</td>
              <td>${statusBadge}</td>
              <td>${scoreDisplay}</td>
              <td>${passDisplay}</td>
              <td style="color:#8b949e">${timeStr}</td>
              <td>
                <button type="button" class="btn-secondary btn-view-report" data-idx="${idx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                  查看详情
                </button>
              </td>
            </tr>
          `;
        })
        .join("")}
    </tbody>
  `;

  container.innerHTML = "";
  container.appendChild(table);

  // 绑定详情点击
  table.querySelectorAll(".btn-view-report").forEach((btn) => {
    btn.onclick = () => {
      const sub = list[parseInt(btn.dataset.idx, 10)];
      showReportDialog(sub);
    };
  });
}

/** 弹出提交详情与报告弹窗 */
function showReportDialog(sub) {
  const grading = Array.isArray(sub.gradings) ? sub.gradings[0] : sub.gradings;
  let dialog = document.getElementById("report-dialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "report-dialog";
    dialog.className = "modal-overlay";
    document.body.appendChild(dialog);
  }

  const reportText = grading?.report_json
    ? JSON.stringify(grading.report_json, null, 2)
    : (grading?.error_message ? `系统错误说明: ${grading.error_message}` : "评测尚在队列中或无详细报告。");

  dialog.innerHTML = `
    <div class="modal-content" style="max-width:640px;">
      <h3 style="margin-top:0;">提交详情 · <code>${escapeHtml(sub.public_code || sub.id)}</code></h3>
      <p style="font-size:0.85rem;color:#8b949e;margin-bottom:0.75rem;">
        提交时间: ${new Date(sub.created_at).toLocaleString('zh-CN')} · 
        轮次: 第 ${sub.attempt_no || 1} 次 · 
        状态: <strong>${grading?.status || 'queued'}</strong> · 
        得分: <strong>${grading?.score != null ? grading.score : '无'}</strong>
      </p>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.8rem;color:#8b949e;">评测报告 / 详细信息：</label>
        <pre style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:0.75rem;max-height:260px;overflow:auto;font-size:12px;">${escapeHtml(reportText)}</pre>
      </div>
      <div class="modal-actions">
        <button type="button" id="btn-close-report-dialog" class="btn-secondary">关闭</button>
      </div>
    </div>
  `;

  dialog.hidden = false;
  document.getElementById("btn-close-report-dialog").onclick = () => {
    dialog.hidden = true;
  };
}

/** 智能轮询未完成的评测状态 */
function startSubmissionsPolling() {
  if (pollTimer) clearInterval(pollTimer);
  let pollCount = 0;

  pollTimer = setInterval(async () => {
    pollCount++;
    if (pollCount > 25) { // 超过限制自动停止
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    await refreshSubmissionsList();
  }, 3000);
}

/** 弹窗: 只读课程排行榜 */
async function showLeaderboardDialog() {
  let dialog = document.getElementById("leaderboard-dialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "leaderboard-dialog";
    dialog.className = "modal-overlay";
    document.body.appendChild(dialog);
  }

  dialog.innerHTML = `
    <div class="modal-content" style="max-width:540px;">
      <h3 style="margin-top:0;">🏆 课程排行榜 · <code>${escapeHtml(activeProblemId || '当前题目')}</code></h3>
      <p style="color:#8b949e;font-size:0.82rem;margin-bottom:0.75rem;">仅已加入该课程的学生与教师可见。为保护同学隐私，学号已脱敏处理。</p>
      <div id="leaderboard-body" style="max-height:360px; overflow-y:auto;">
        <p style="color:#8b949e;">正在加载排行榜...</p>
      </div>
      <div class="modal-actions" style="margin-top:1rem;">
        <button type="button" id="btn-close-leaderboard" class="btn-secondary">关闭</button>
      </div>
    </div>
  `;

  dialog.hidden = false;
  document.getElementById("btn-close-leaderboard").onclick = () => { dialog.hidden = true; };

  const bodyEl = document.getElementById("leaderboard-body");
  if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
    bodyEl.innerHTML = '<p style="color:#8b949e;">离线练习模式下暂无在线排行榜。</p>';
    return;
  }

  const sb = window.ScipOJPlatform.getSupabase();
  try {
    let query = sb
      .from('course_gradebook')
      .select('student_no, display_name, problem_id, best_score, passed, attempt_count')
      .not('best_score', 'is', null)
      .order('best_score', { ascending: false });

    if (activeProblemId) {
      query = query.eq('problem_id', activeProblemId);
    }

    const { data, error } = await query.limit(30);
    if (error || !data || data.length === 0) {
      bodyEl.innerHTML = '<p style="color:#8b949e;">暂无榜单数据或您未选修对应课程。</p>';
      return;
    }

    // 格式化脱敏学号
    function maskStudentNo(s) {
      if (!s || s.length <= 4) return s || '***';
      return s.slice(0, 4) + '****' + s.slice(-2);
    }

    bodyEl.innerHTML = `
      <table class="roster-table" style="font-size:0.85rem;">
        <thead>
          <tr>
            <th>名次</th>
            <th>学号</th>
            <th>姓名</th>
            <th>最高分</th>
            <th>判定</th>
            <th>提交数</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((r, i) => {
            let rankBadge = `${i + 1}`;
            if (i === 0) rankBadge = '🥇 1';
            else if (i === 1) rankBadge = '🥈 2';
            else if (i === 2) rankBadge = '🥉 3';

            return `
              <tr>
                <td><strong>${rankBadge}</strong></td>
                <td><code>${escapeHtml(maskStudentNo(r.student_no))}</code></td>
                <td>${escapeHtml(r.display_name || '-')}</td>
                <td><strong class="pass">${r.best_score} 分</strong></td>
                <td>${r.passed ? '<span class="tag-normal">通过</span>' : '<span class="tag-late">未过</span>'}</td>
                <td>${r.attempt_count || 1} 次</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    bodyEl.innerHTML = `<p class="fail">获取榜单失败: ${escapeHtml(err.message)}</p>`;
  }
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

main().catch((err) => {
  const el = document.getElementById("problem-list");
  if (el) el.textContent = String(err);
});
