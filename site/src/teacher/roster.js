export function create(context,{esc,formatTime}) {
async function loadPendingRoster(courseId) {
    if (!context.pendingRosterArea)
        return;
    context.pendingRosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">正在获取花名册状态...</p>';
    try {
        const [rosterPending, verifiedRows] = await Promise.all([
            ScipOJPlatform.getPendingRoster(courseId),
            ScipOJPlatform.getVerifiedRoster(courseId),
        ]);
        const verifiedSet = new Set(verifiedRows.map(v => v.roster_id));
        if (rosterPending.length === 0) {
            context.pendingRosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">当前班级暂无导入的花名册。可在上方粘贴或载入 CSV 进行预置。</p>';
            return;
        }
        const matchedList = rosterPending.filter(r => r.status === "matched");
        const pendingList = rosterPending.filter(r => r.status === "pending");
        const verifiedCount = rosterPending.filter(r => verifiedSet.has(r.id)).length;
        let html = `
          <div style="display:flex; gap:1rem; margin-bottom:1rem; flex-wrap:wrap; padding:0.5rem 0;">
            <div class="user-badge" style="background:var(--bg-subtle); color:var(--text-primary); border:1px solid var(--border-default); padding:0.4rem 0.8rem; font-size:0.85rem;">
              预置花名册总数：<strong>${rosterPending.length}</strong>
            </div>
            <div class="user-badge" style="background:var(--color-pass-bg); color:var(--color-pass); border:1px solid var(--color-pass-border); padding:0.4rem 0.8rem; font-size:0.85rem;">
              学号自动匹配：<strong>${matchedList.length}</strong>
            </div>
            <div class="user-badge" style="background:var(--color-warn-bg); color:var(--color-warn); border:1px solid var(--color-warn-border); padding:0.4rem 0.8rem; font-size:0.85rem;">
              教师已核验：<strong>${verifiedCount}</strong>
            </div>
          </div>
          <table class="roster-table">
            <thead>
              <tr>
                <th>学号</th>
                <th>真实姓名</th>
                <th>指定 GitHub 登录名</th>
                <th>对齐状态</th>
                <th>教师人工核验</th>
              </tr>
            </thead>
            <tbody>
              ${rosterPending.map(r => `
                <tr>
                  <td><strong>${esc(r.student_no)}</strong></td>
                  <td>${esc(r.display_name)}</td>
                  <td>${r.github_login ? `<code>${esc(r.github_login)}</code>` : '<span style="color:var(--text-secondary);">未限定</span>'}</td>
                  <td>
                    ${r.status === "matched"
            ? '<span class="tag-pending">学号已匹配（未必已核验）</span>'
            : '<span class="tag-pending">⏳ 待绑定登录</span>'}
                  </td>
                  <td style="color:var(--text-secondary); font-size:0.82rem;">
                    ${verifiedSet.has(r.id) ? '<span class="tag-matched">✓ 教师已核验</span>' : r.status === "matched" && r.matched_user_id ? `<button type="button" class="btn-secondary" data-verify-roster="${esc(r.id)}">核验本人身份</button>` : "尚未匹配"}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        context.pendingRosterArea.innerHTML = html;
        context.pendingRosterArea.querySelectorAll("button[data-verify-roster]").forEach(button => {
            button.onclick = async () => {
                const row = rosterPending.find(r => r.id === button.dataset.verifyRoster);
                if (!row || !row.matched_user_id)
                    return;
                const okay = await ScipOJPlatform.showConfirmDialog({
                    title: "教师核验学生本人",
                    message: `请先在线下通过课程/学校可信渠道核验学生本人和 GitHub 账号。仅相同学号不能证明身份。

花名册学号：${row.student_no}
姓名：${row.display_name}
指定 GitHub 登录名：${row.github_login || "未指定"}`,
                    confirmText: "已核对本人，确认",
                });
                if (!okay)
                    return;
                button.disabled = true;
                try {
                    await ScipOJPlatform.confirmRosterIdentity(row.id, row.matched_user_id);
                    ScipOJPlatform.showToast("已写入教师人工核验记录", "success");
                    await context.handlers.loadPendingRoster(courseId);
                }
                catch (error) {
                    ScipOJPlatform.showToast(error.message, "error");
                    button.disabled = false;
                }
            };
        });
    }
    catch (err) {
        context.pendingRosterArea.innerHTML = `<p class="fail" style="padding:1rem;">获取花名册状态失败: ${esc(err.message)}</p>`;
    }
}
return {loadPendingRoster};
}
