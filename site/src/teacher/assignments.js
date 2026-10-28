import {requestScope} from './scope.js';
export function create(context,{esc,formatTime}) {
// 扫描题目列表填充下拉框
async function initProblemOptions() {
    try {
        const resp = await fetch("problems/index.json");
        if (resp.ok) {
            const list = await resp.json();
            context.assignProblemSelect.innerHTML = list.map(p => `<option value="${esc(p.id)}">${esc(p.id)} - ${esc(p.title)}</option>`).join('') + '<option value="__custom__">+ 手动输入其它题号...</option>';
        }
    }
    catch (e) {
        console.warn("获取 problems/index.json 失败:", e);
    }
}
async function loadCourseAssignments(courseId) {
    if (!context.courseAssignmentsArea)
        return;
    const current = requestScope(context, 'assignmentsRequest', courseId);
    try {
        const sb = ScipOJPlatform.getSupabase();
        const { data, error } = await sb
            .from("assignments")
            .select("*")
            .eq("course_id", courseId)
            .order("problem_id", { ascending: true });
        if (!current()) return;
        if (error)
            throw error;
        context.currentAssignmentsList = data || [];
        if (context.currentAssignmentsList.length === 0) {
            context.courseAssignmentsArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">当前班级尚未开放任何正式作业。</p>';
            return;
        }
        const policyNames = {
            highest_before_due: "截止前最高分 (默认)",
            latest: "最新提交分",
            highest: "历史最高分",
        };
        context.courseAssignmentsArea.innerHTML = `
          <table class="roster-table">
            <thead>
              <tr>
                <th>题目编号</th>
                <th>截止时间</th>
                <th>及格线</th>
                <th>测试实例数</th>
                <th>计分规则</th>
                <th>考试策略</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${context.currentAssignmentsList.map((a, idx) => `
                <tr>
                  <td><code>${esc(a.problem_id)}</code></td>
                  <td>${a.due_at ? formatTime(a.due_at) : '<span style="color:var(--color-pass);">长期有效</span>'}</td>
                  <td>${a.pass_score} 分</td>
                  <td>${a.n_instances} 实例</td>
                  <td>${policyNames[a.score_policy] || a.score_policy}</td>
                  <td>${a.integrity_policy === "exam_block" ? "限制粘贴" : a.integrity_policy === "exam_warn" ? "监测提示" : "普通"}</td>
                  <td>
                    <button type="button" class="btn-edit-assign btn-secondary" data-idx="${idx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                      填入表单修改
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        context.courseAssignmentsArea.querySelectorAll(".btn-edit-assign").forEach(btn => {
            btn.onclick = () => {
                const a = context.currentAssignmentsList[parseInt(btn.dataset.idx, 10)];
                if (!a)
                    return;
                if ([...context.assignProblemSelect.options].some(o => o.value === a.problem_id)) {
                    context.assignProblemSelect.value = a.problem_id;
                    context.assignCustomProblem.hidden = true;
                }
                else {
                    context.assignProblemSelect.value = "__custom__";
                    context.assignCustomProblem.hidden = false;
                    context.assignCustomProblem.value = a.problem_id;
                }
                if (a.due_at) {
                    const d = new Date(a.due_at);
                    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    context.assignDueAt.value = localIso;
                }
                else {
                    context.assignDueAt.value = "";
                }
                context.assignPassScore.value = a.pass_score ?? 90;
                context.assignInstances.value = a.n_instances || 3;
                context.assignPolicy.value = a.score_policy || "highest_before_due";
                if (context.assignIntegrityPolicy)
                    context.assignIntegrityPolicy.value = a.integrity_policy || "standard";
                context.formPublish.scrollIntoView({ behavior: "smooth" });
            };
        });
    }
    catch (err) {
        if (!current()) return;
        context.courseAssignmentsArea.innerHTML = `<p class="fail" style="padding:1rem;">加载作业列表失败: ${esc(err.message)}</p>`;
    }
}
return {initProblemOptions,loadCourseAssignments};
}
