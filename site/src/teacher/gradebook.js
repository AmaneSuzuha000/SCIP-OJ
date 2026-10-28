export function create(context,{esc,formatTime}) {
let currentPage = 1;
let pageSize = 50;

function resetGradebookPage() {
    currentPage = 1;
}

async function loadGradebook(courseId) {
    if (!context.rosterArea) {
        console.error("[Teacher] #roster-area missing");
        return;
    }
    context.rosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">正在加载班级成绩表与评测状态...</p>';
    try {
        const data = await ScipOJPlatform.getTeacherRoster(courseId);
        context.currentRosterData = data || [];
        context.handlers.updateFacultyMetrics(context.currentRosterData);
        await context.handlers.loadCourseAssignments(courseId);
        context.handlers.updateProblemFilterOptions();
        resetGradebookPage();
        context.handlers.renderGradebookTable();
    }
    catch (err) {
        console.error("[Teacher] loadGradebook failed:", err);
        context.rosterArea.innerHTML = `<p class="fail" style="padding:1rem;">加载成绩簿失败: ${esc(err.message)}</p>`;
    }
}
function updateFacultyMetrics(rows) {
    const students = rows.filter(r => r.enroll_role === "student");
    const studentCount = new Set(students.map(r => r.user_id).filter(Boolean)).size;
    const graded = students.filter(r => r.best_score != null && Number.isFinite(Number(r.best_score)));
    const passCount = graded.filter(r => r.passed === true).length;
    const values = {
        "metric-students": studentCount,
        "metric-graded": graded.length,
        "metric-passrate": graded.length ? Math.round(passCount / graded.length * 100) + "%" : "—",
    };
    for (const [id, value] of Object.entries(values)) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = String(value);
    }
}
function updateProblemFilterOptions() {
    const currentVal = context.filterProblem.value;
    const problemsSet = new Set(context.currentRosterData.map(r => r.problem_id).filter(Boolean));
    context.currentAssignmentsList.forEach(a => problemsSet.add(a.problem_id));
    const problems = Array.from(problemsSet).sort();
    context.filterProblem.innerHTML = '<option value="">全部题目</option>' +
        problems.map(p => `<option value="${p}">${p}</option>`).join("");
    if (problems.includes(currentVal)) {
        context.filterProblem.value = currentVal;
    }
}
function getFilteredRoster() {
    const p = context.filterProblem.value;
    const kw = (context.filterKeyword.value || '').trim().toLowerCase();
    return context.currentRosterData.filter(row => {
        if (p && row.problem_id !== p)
            return false;
        if (kw) {
            const matchNo = (row.student_no || '').toLowerCase().includes(kw);
            const matchName = (row.display_name || '').toLowerCase().includes(kw);
            if (!matchNo && !matchName)
                return false;
        }
        return true;
    });
}
function renderGradebookTable() {
    const filtered = context.handlers.getFilteredRoster();
    if (filtered.length === 0) {
        context.rosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1.25rem;">当前筛选条件下暂无成绩记录。</p>';
        return;
    }
    const totalCount = filtered.length;
    const effectivePageSize = pageSize > 0 ? pageSize : totalCount;
    const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }
    const startIndex = (currentPage - 1) * effectivePageSize;
    const endIndex = Math.min(startIndex + effectivePageSize, totalCount);
    const pageRows = filtered.slice(startIndex, endIndex);

    const table = document.createElement("table");
    table.className = "roster-table";
    table.innerHTML = `
        <thead>
          <tr>
            <th style="width:36px; text-align:center;"><input type="checkbox" id="check-all-rows" title="全选 / 反选本页" /></th>
            <th>学号</th>
            <th>姓名</th>
            <th>题目</th>
            <th>最优成绩</th>
            <th>判定</th>
            <th>迟交标记</th>
            <th>提交轮次</th>
            <th>最后提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows.map((row, idx) => {
        const globalIdx = startIndex + idx;
        const passScore = row.pass_score ?? 90;
        const isPass = row.best_score != null && row.best_score >= passScore;
        const curAssign = context.currentAssignmentsList.find(a => a.id === row.assignment_id || a.problem_id === row.problem_id);
        const isLate = curAssign?.due_at && row.last_submitted_at ? new Date(row.last_submitted_at) > new Date(curAssign.due_at) : false;
        return `
              <tr data-sub-id="${esc(row.best_submission_id || '')}">
                <td style="text-align:center;">
                  <input type="checkbox" class="row-checkbox" data-sub-id="${esc(row.best_submission_id || '')}" ${row.best_submission_id ? '' : 'disabled title="暂无有效提交"'} />
                </td>
                <td><strong>${esc(row.student_no || '-')}</strong></td>
                <td>${esc(row.display_name || '-')}${row.enroll_role && row.enroll_role !== 'student' ? ' <span class="tag-pending" title="教师/助教账号的正式提交烟测">试交</span>' : ''}</td>
                <td><code>${esc(row.problem_id || '-')}</code></td>
                <td>
                  ${row.best_score != null
            ? `<strong class="${isPass ? 'pass' : 'fail'}">${row.best_score} 分</strong>`
            : '<span style="color:var(--text-secondary);">未出分</span>'}
                </td>
                <td>${row.best_score == null
            ? '<span class="tag-pending">— 未提交</span>'
            : (row.passed ? '<span class="tag-normal">✓ 通过</span>' : '<span class="tag-late">✗ 未通过</span>')}</td>
                <td>${isLate ? '<span class="tag-late">迟交</span>' : '<span class="tag-normal">正常</span>'}</td>
                <td>${row.attempt_count != null ? `第 ${row.attempt_count} 次` : '-'}</td>
                <td style="color:var(--text-secondary); font-size:0.8rem;">${row.last_submitted_at ? formatTime(row.last_submitted_at) : '-'}</td>
                <td>
                  <button type="button" class="btn-view-evidence btn-secondary" data-idx="${globalIdx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                    查看证据
                  </button>
                </td>
              </tr>
            `;
    }).join('')}
        </tbody>
      `;

    // 分页控件
    const paginationEl = document.createElement("div");
    paginationEl.className = "gradebook-pagination";
    paginationEl.style.cssText = "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding:0.85rem 0.5rem 0.25rem; font-size:0.85rem; color:var(--text-secondary);";
    paginationEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <span>显示第 <strong>${startIndex + 1}</strong> - <strong>${endIndex}</strong> 条，共 <strong>${totalCount}</strong> 条记录</span>
        <label style="display:inline-flex; align-items:center; gap:0.35rem;">
          每页：
          <select id="gradebook-page-size" style="padding:0.2rem 0.4rem; font-size:0.82rem; border:1px solid var(--border-default); border-radius:4px; background:var(--bg-surface); color:var(--text-primary);">
            <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 行</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 行</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 行</option>
            <option value="0" ${pageSize === 0 ? 'selected' : ''}>全部 (${totalCount})</option>
          </select>
        </label>
      </div>
      <div style="display:flex; align-items:center; gap:0.4rem;">
        <button type="button" class="btn-secondary" id="btn-page-prev" ${currentPage <= 1 ? 'disabled' : ''} style="padding:0.25rem 0.6rem; font-size:0.82rem;">上一页</button>
        <span style="padding:0 0.35rem;">第 <strong>${currentPage}</strong> / ${totalPages} 页</span>
        <button type="button" class="btn-secondary" id="btn-page-next" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:0.25rem 0.6rem; font-size:0.82rem;">下一页</button>
      </div>
    `;

    context.rosterArea.innerHTML = "";
    context.rosterArea.appendChild(table);
    context.rosterArea.appendChild(paginationEl);

    // 绑定分页事件
    const pageSizeSelect = paginationEl.querySelector("#gradebook-page-size");
    if (pageSizeSelect) {
        pageSizeSelect.onchange = (e) => {
            pageSize = parseInt(e.target.value, 10) || 0;
            currentPage = 1;
            renderGradebookTable();
        };
    }
    const prevBtn = paginationEl.querySelector("#btn-page-prev");
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                renderGradebookTable();
            }
        };
    }
    const nextBtn = paginationEl.querySelector("#btn-page-next");
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderGradebookTable();
            }
        };
    }

    // 全选 / 反选
    const checkAll = document.getElementById("check-all-rows");
    if (checkAll) {
        checkAll.onchange = () => {
            table.querySelectorAll(".row-checkbox:not(:disabled)").forEach(cb => {
                cb.checked = checkAll.checked;
            });
        };
    }
    // 绑定查看证据按钮
    table.querySelectorAll(".btn-view-evidence").forEach(btn => {
        btn.onclick = () => {
            const row = filtered[parseInt(btn.dataset.idx, 10)];
            context.handlers.showSubmissionEvidence(row);
        };
    });
}
return {loadGradebook,updateFacultyMetrics,updateProblemFilterOptions,getFilteredRoster,renderGradebookTable,resetGradebookPage};
}
