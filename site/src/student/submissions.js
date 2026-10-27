import {state} from './state.js';
import {escapeHtml} from './shared.js';
export /** 刷新学生在该题目的提交历史记录 */
async function refreshSubmissionsList() {
    const requestSeq = ++state.submissionsFetchSeq;
    const context = `${state.activeProblemId || ""}|${state.activeAssignment?.id || ""}|${document.body.dataset.teachingView}`;
    const globalHistory = document.body.dataset.teachingView === "records";
    const container = document.getElementById("my-submissions-container");
    if (!container)
        return;
    if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
        container.innerHTML = `
      <p style="color:var(--text-secondary); padding:1rem;">
        当前未连接课程服务。可进入「<a href="#problem-list-section">在线做题</a>」进行本地练习；正式提交记录需连接课程服务后查看。
      </p>
    `;
        return;
    }
    const user = window.ScipOJPlatform.getUser();
    if (!user) {
        container.innerHTML = `
      <p style="color:var(--text-secondary); padding:1rem;">
        请 <a href="javascript:void(0)" id="link-login-prompt" style="font-weight:600;">使用 GitHub 登录</a> 以同步您的正式提交记录与成绩。
      </p>
    `;
        const link = document.getElementById("link-login-prompt");
        if (link)
            link.onclick = () => window.ScipOJPlatform.showLoginDialog();
        return;
    }
    container.innerHTML = `<p style="color:var(--text-secondary); padding:1rem;">正在加载历史提交记录...</p>`;
    try {
        if (!globalHistory && state.activeProblemId && !state.activeAssignment?.id) {
            container.innerHTML = '<p class="history-empty">当前题目没有可用的正式作业。可继续本地练习，或进入「提交记录」查看其他作业。</p>';
            return;
        }
        const assignmentId = globalHistory ? null : state.activeAssignment?.id || null;
        const submissions = await window.ScipOJPlatform.getMySubmissions(assignmentId);
        if (requestSeq !== state.submissionsFetchSeq || context !== `${state.activeProblemId || ""}|${state.activeAssignment?.id || ""}|${document.body.dataset.teachingView}`)
            return;
        if (submissions.length === 0) {
            container.innerHTML = `
        <p style="color:var(--text-secondary); padding:1.25rem;">
          ${globalHistory ? '还没有正式提交记录。进入在线做题，选择当前班级的作业后提交。' : '您尚未对本题提交正式作业。完成后点击「提交正式作业」即可发起评测。'}
        </p>
      `;
            return;
        }
        renderSubmissionsTable(container, submissions);
        // 检查是否有排队或运行中的任务，若有则保持轮询
        const hasPending = submissions.some(s => {
            const g = Array.isArray(s.gradings) ? s.gradings[0] : s.gradings;
            return g?.status === "queued" || g?.status === "running";
        });
        if (hasPending && !state.pollTimer) {
            startSubmissionsPolling();
        }
        else if (!hasPending && state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }
    catch (err) {
        if (requestSeq !== state.submissionsFetchSeq)
            return;
        container.innerHTML = `<p class="fail" style="padding:1rem;">加载提交记录异常: ${escapeHtml(err.message)}</p>`;
    }
}
export async function refreshHistory() {
    const button = document.getElementById("btn-refresh-submissions");
    button.disabled = true;
    button.textContent = "刷新中…";
    try {
        await refreshSubmissionsList();
    }
    finally {
        button.disabled = false;
        button.textContent = "刷新记录";
    }
}
export /** 渲染正式提交记录表格 */
function renderSubmissionsTable(container, list) {
    const globalHistory = document.body.dataset.teachingView === "records";
    const table = document.createElement("table");
    table.className = "submissions-table";
    table.innerHTML = `
    <thead>
      <tr>
        <th>提交编号</th>
        ${globalHistory ? '<th>题目 / 班级</th>' : ''}
        <th>轮次</th>
        <th>评测状态</th>
        <th>有效成绩</th>
        <th>判定</th>
        <th>提交时间</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${list.map((sub, idx) => {
        const { latestAttempt: grading, effectiveGrade } = window.ScipOJGradingState.normalizeSubmission(sub);
        const status = grading?.status || "queued";
        const score = effectiveGrade?.score;
        const passed = effectiveGrade?.passed;
        let statusBadge = "";
        if (status === "queued") {
            statusBadge = '<span class="badge badge-queued">⏳ 排队中</span>';
        }
        else if (status === "running") {
            statusBadge = '<span class="badge badge-running">⚙️ 评测中</span>';
        }
        else if (status === "done") {
            statusBadge = '<span class="badge badge-done">✓ 已完成</span>';
        }
        else if (status === "system_error") {
            statusBadge = '<span class="badge badge-system_error" title="系统环境故障，不扣除学生分数">⚠️ 系统故障</span>';
        }
        let scoreDisplay = "-";
        if (effectiveGrade) {
            scoreDisplay = score != null
                ? `<strong class="${passed ? 'pass' : 'fail'}">${score} 分</strong>`
                : '<span style="color:var(--text-secondary);">未出分</span>';
        }
        else if (status === "system_error") {
            scoreDisplay = '<span style="color:var(--text-secondary);" title="系统错误不计0分">未出分 (系统故障)</span>';
        }
        let passDisplay = "-";
        if (effectiveGrade) {
            passDisplay = passed ? '<span class="tag-normal">✓ 通过</span>' : '<span class="tag-late">✗ 未通过</span>';
        }
        else if (status === "system_error") {
            passDisplay = '<span class="tag-pending">暂未出分</span>';
        }
        const isLate = sub.metadata?.late;
        const timeStr = sub.created_at ? new Date(sub.created_at).toLocaleString("zh-CN") : "-";
        const assignment = Array.isArray(sub.assignments) ? sub.assignments[0] : sub.assignments;
        const course = Array.isArray(assignment?.courses) ? assignment.courses[0] : assignment?.courses;
        const problemId = assignment?.problem_id;
        const problemLabel = problemId
            ? `${problemId} · ${state.problemIndex.find(p => p.id === problemId)?.title || '编程作业'}`
            : `作业 ${String(sub.assignment_id || '').slice(0, 8) || '信息暂不可用'}`;
        return `
          <tr>
            <td>
              <code>${escapeHtml(sub.public_code || sub.id.slice(0, 8))}</code>
              ${isLate ? '<span class="tag-late" style="font-size:0.68rem; margin-left:0.25rem;">迟交</span>' : ''}
            </td>
            ${globalHistory ? `<td class="submission-context"><strong>${escapeHtml(problemLabel)}</strong><small>${escapeHtml(course ? `${course.name} · ${course.code}` : '班级信息暂不可用')}</small></td>` : ''}
            <td>第 ${sub.attempt_no || 1} 次</td>
            <td>${statusBadge}</td>
            <td>${scoreDisplay}</td>
            <td>${passDisplay}</td>
            <td style="color:var(--text-secondary); font-size:0.82rem;">${timeStr}</td>
            <td>
              <button type="button" class="btn-secondary btn-view-report" data-idx="${idx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                查看详情
              </button>
            </td>
          </tr>
        `;
    }).join("")}
    </tbody>
  `;
    container.innerHTML = "";
    container.appendChild(table);
    table.querySelectorAll(".btn-view-report").forEach((btn) => {
        btn.onclick = () => {
            const sub = list[parseInt(btn.dataset.idx, 10)];
            if (sub)
                showReportDialog(sub);
        };
    });
}
export /** 弹出提交详情与报告 */
function showReportDialog(sub) {
    const { latestAttempt: grading, effectiveGrade } = window.ScipOJGradingState.normalizeSubmission(sub);
    let dialog = document.getElementById("report-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "report-dialog";
        dialog.className = "modal-overlay";
        dialog.hidden = true;
        document.body.appendChild(dialog);
    }
    const reportText = grading?.report_json
        ? JSON.stringify(grading.report_json, null, 2)
        : (grading?.error_message ? `系统说明: ${grading.error_message}` : "评测尚在队列中，稍后刷新即可查看报告。");
    dialog.innerHTML = `
    <div class="modal-content" style="max-width:660px;">
      <div class="modal-header">
        <h3>提交详情 · <code>${escapeHtml(sub.public_code || sub.id)}</code></h3>
        <button type="button" class="modal-close-btn" id="btn-close-report-x">✕</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--bg-subtle); border:1px solid var(--border-default); border-radius:6px; padding:0.75rem 1rem; margin-bottom:1rem; font-size:0.85rem; display:flex; flex-wrap:wrap; gap:1rem;">
          <div>提交时间: <strong>${sub.created_at ? new Date(sub.created_at).toLocaleString("zh-CN") : "-"}</strong></div>
          <div>轮次: <strong>第 ${sub.attempt_no || 1} 次</strong></div>
          <div>状态: <strong>${grading?.status || 'queued'}</strong></div>
          <div>有效成绩: <strong class="${effectiveGrade?.passed ? 'pass' : 'fail'}">${effectiveGrade?.score != null ? effectiveGrade.score + ' 分' : '未出分'}</strong></div>
        </div>

        <div class="form-group">
          <label>评测报告 (report_json)：</label>
          <pre style="background:var(--bg-base); border:1px solid var(--border-default); border-radius:6px; padding:0.85rem; max-height:280px; overflow:auto; font-size:12.5px; font-family:var(--font-mono); margin:0; color:#7ee787;">${escapeHtml(reportText)}</pre>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" id="btn-close-report-dialog" class="btn-secondary">关闭</button>
      </div>
    </div>
  `;
    const close = () => window.ScipOJPlatform.closeModal(dialog);
    document.getElementById("btn-close-report-dialog").onclick = close;
    document.getElementById("btn-close-report-x").onclick = close;
    document.getElementById("btn-close-report-x").setAttribute("aria-label", "关闭提交详情");
    dialog.onclick = (e) => { if (e.target === dialog)
        close(); };
    window.ScipOJPlatform.openModal(dialog);
}
export /** 智能轮询评测状态 */
function startSubmissionsPolling() {
    if (state.pollTimer)
        clearInterval(state.pollTimer);
    let pollCount = 0;
    state.pollTimer = setInterval(async () => {
        // 用户已返回题单或切换题目时停止轮询
        if (document.getElementById("workspace")?.hidden && document.getElementById("submission-overview")?.hidden) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            return;
        }
        pollCount++;
        if (pollCount > 30) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            window.ScipOJPlatform?.showToast("评测仍在进行中，已停止自动刷新；可点击「刷新记录」查看最新状态。", "info");
            return;
        }
        await refreshSubmissionsList();
    }, 3000);
}
export /** 弹出脱敏课程排行榜（仅本课程师生可见） */
async function showLeaderboardDialog() {
    let dialog = document.getElementById("leaderboard-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "leaderboard-dialog";
        dialog.className = "modal-overlay";
        dialog.hidden = true;
        document.body.appendChild(dialog);
    }
    dialog.innerHTML = `
    <div class="modal-content" style="max-width:600px;">
      <div class="modal-header">
        <h3>🏆 课程排行榜 · <code>${escapeHtml(state.activeProblemId || '全部题目')}</code></h3>
        <button type="button" class="modal-close-btn" id="btn-close-lb-x">✕</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-secondary); font-size:0.82rem; margin-top:0; margin-bottom:0.85rem;">
          仅本课程师生可见。学号由服务端脱敏，浏览器不会收到完整学号。
        </p>
        <div id="leaderboard-body" class="table-wrapper" style="max-height:380px;">
          <p style="color:var(--text-secondary); padding:1rem;">正在加载排行榜...</p>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" id="btn-close-leaderboard" class="btn-secondary">关闭</button>
      </div>
    </div>
  `;
    const close = () => window.ScipOJPlatform.closeModal(dialog);
    document.getElementById("btn-close-leaderboard").onclick = close;
    document.getElementById("btn-close-lb-x").onclick = close;
    document.getElementById("btn-close-lb-x").setAttribute("aria-label", "关闭排行榜");
    dialog.onclick = (e) => { if (e.target === dialog)
        close(); };
    window.ScipOJPlatform.openModal(dialog);
    const bodyEl = document.getElementById("leaderboard-body");
    if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
        bodyEl.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">离线模式下暂无在线排行榜。</p>';
        return;
    }
    if (!window.ScipOJPlatform.getUser()) {
        bodyEl.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">请先使用 GitHub 登录后查看课程排行榜。</p>';
        const p = document.createElement("p");
        p.style.padding = "0 1rem 1rem";
        p.innerHTML = '<button type="button" class="btn-blue" id="lb-login-prompt">使用 GitHub 登录</button>';
        bodyEl.appendChild(p);
        document.getElementById("lb-login-prompt").onclick = () => window.ScipOJPlatform.showLoginDialog();
        return;
    }
    const enrollments = window.ScipOJPlatform.getEnrollments();
    if (!enrollments || enrollments.length === 0) {
        bodyEl.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">您尚未加入任何教学班级，加入班级后即可查看本课程排行榜。</p>';
        return;
    }
    const courseId = enrollments[0].course_id;
    try {
        // 未指定题目时由数据库按学生聚合（返回 problem_id 为 NULL），前端不再重复聚合
        const rows = await window.ScipOJPlatform.getLeaderboard(courseId, state.activeProblemId || null, 50);
        if (!rows.length) {
            bodyEl.innerHTML = `<p style="color:var(--text-secondary); padding:1rem;">${state.activeProblemId ? "本题目暂无已出分的提交记录。" : "本课程暂无已出分的提交记录。"}</p>`;
            return;
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
          ${rows.map((r, i) => {
            let rankBadge = `${i + 1}`;
            if (i === 0)
                rankBadge = '🥇 1';
            else if (i === 1)
                rankBadge = '🥈 2';
            else if (i === 2)
                rankBadge = '🥉 3';
            return `
              <tr>
                <td><strong>${rankBadge}</strong></td>
                <td><code>${escapeHtml(r.student_no_masked || "***")}</code></td>
                <td>${escapeHtml(r.display_name || '-')}</td>
                <td><strong class="pass">${Number(r.best_score)} 分</strong></td>
                <td>${r.passed ? '<span class="tag-normal">通过</span>' : '<span class="tag-late">未过</span>'}</td>
                <td>${r.attempt_count || 1} 次</td>
              </tr>
            `;
        }).join('')}
        </tbody>
      </table>
    `;
    }
    catch (err) {
        const msg = err?.message || String(err);
        if (err?.missingRpc || window.ScipOJPlatform?.isMissingRpcError?.(err) ||
            /does not exist|schema cache|42P01|PGRST205|permission denied|could not find the function/i.test(msg)) {
            bodyEl.innerHTML = '<p class="fail" style="padding:1rem;">排行榜服务尚未部署（缺少 <code>get_course_leaderboard</code> 函数）。请联系管理员执行 <code>supabase/migrations/006_security_hardening_and_leaderboard.sql</code> 后重试。</p>';
        }
        else {
            bodyEl.innerHTML = `<p class="fail" style="padding:1rem;">获取榜单异常: ${escapeHtml(msg)}</p>`;
        }
    }
}