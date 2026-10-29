import {installTeacherJourney} from './journey.js';
import {create as invites} from './invites.js';
import {create as gradebook} from './gradebook.js';
import {create as evidence} from './evidence.js';
import {create as roster} from './roster.js';
import {create as assignments} from './assignments.js';
import {create as similarity} from './similarity.js';
import {withDeadline} from '../platform/deadline.js';
/**
 * SCIP-OJ 教师控制台 — 成绩中心、评测证据台、花名册对齐与作业发布
 * 依赖: ScipOJPlatform (platform.js)
 */

const ready=(async function teacherInit() {
  const signal=window.ScipOJPageSession?.signal;
  let activeContext=null,accessSequence=0,unsubscribe;
  window.ScipOJPageSession?.onDispose(()=>{accessSequence++;if(activeContext)activeContext.active=false;unsubscribe?.();});
  const noConfigEl = document.getElementById("teacher-no-config");
  const noAuthEl = document.getElementById("teacher-no-auth");
  const forbiddenEl = document.getElementById("teacher-forbidden");
  const panelEl = document.getElementById("teacher-panel");
  const btnTeacherSignin = document.getElementById("btn-teacher-signin");

  if (!window.ScipOJPlatform) {
    if (noConfigEl) noConfigEl.hidden = false;
    return;
  }

  // 先露出登录区，避免 getSession/refresh 卡住时整页只剩顶部横幅
  if (noAuthEl) noAuthEl.hidden = false;
  if (forbiddenEl) forbiddenEl.hidden = true;
  if (panelEl) panelEl.hidden = true;

  let configured = false;
  try {
    configured = await withDeadline(ScipOJPlatform.init(),8000,'课程服务恢复超时');
  } catch (err) {
    console.warn("[Teacher] 平台初始化异常:", err);
    configured = false;
  }
  if(signal?.aborted)return;
  ScipOJPlatform.updateAuthUI();

  if (!configured) {
    // init 超时或失败时仍保留登录入口；若确实无配置再切提示
    if ((!ScipOJPlatform.isConfigured?.() || !ScipOJPlatform.getSupabase?.()) && noConfigEl) {
      noConfigEl.hidden = false;
      if (noAuthEl) noAuthEl.hidden = true;
      return;
    }
    // 即使超时也继续绑定登录按钮，用户可手动重试登录
  }

  if (btnTeacherSignin) {
    btnTeacherSignin.onclick = () => ScipOJPlatform.showLoginDialog();
  }

  // ── 认证与角色权限检查 ──
  async function checkTeacherAccess() {
    if(signal?.aborted)return false;
    const sequence = ++accessSequence;
    const accessStatus=document.getElementById('teacher-access-status');
    accessStatus.hidden=true;
    const user = ScipOJPlatform.getUser();
    if (activeContext && activeContext.userId !== user?.id) {
      activeContext.active = false;
      panelEl.hidden = true;
      document.getElementById('submission-detail').hidden = true;
    }
    if (!user) {
      if (noAuthEl) noAuthEl.hidden = false;
      if (forbiddenEl) forbiddenEl.hidden = true;
      if (panelEl) panelEl.hidden = true;
      return false;
    }

    if (noAuthEl) noAuthEl.hidden = true;

    // 检查是否具备教师/助教/管理员权限
    accessStatus.hidden=false;accessStatus.textContent='正在确认课程管理权限…';
    let enrollments;
    try {enrollments=await withDeadline(ScipOJPlatform.getMyCourses(),6000,'课程权限加载超时');}
    catch (error) {
      if (sequence===accessSequence) {accessStatus.textContent='课程权限暂时无法确认，请刷新重试。';panelEl.hidden=true;}
      return false;
    }
    if (sequence !== accessSequence || ScipOJPlatform.getUser()?.id !== user.id) return false;
    if (!Array.isArray(enrollments)) {accessStatus.textContent='课程权限状态已更新，请重试。';return false;}
    accessStatus.hidden=true;
    const isTeacherRole = ScipOJPlatform.isTeacher();
    const teacherCourses = enrollments.filter(e => e.role === "teacher" || e.role === "ta" || e.role === "admin");

    if (!isTeacherRole && teacherCourses.length === 0) {
      if (activeContext) activeContext.active = false;
      if (forbiddenEl) {
        forbiddenEl.hidden = false;
        const nameEl = document.getElementById("forbidden-user-name");
        if (nameEl) nameEl.textContent = ScipOJPlatform.getProfile()?.display_name || user.email || user.id;
      }
      if (panelEl) panelEl.hidden = true;
      return false;
    }

    if (forbiddenEl) forbiddenEl.hidden = true;
    if (panelEl) panelEl.hidden = false;
    return true;
  }

  let initializedForUser = null;

  const hasAccess = await checkTeacherAccess();
  if(signal?.aborted)return;
  unsubscribe=ScipOJPlatform.onAuthChange(async () => {
    const ok = await checkTeacherAccess();
    const uid = ScipOJPlatform.getUser()?.id || null;
    if (!ok) { initializedForUser = null; return; }
    // 仅在登录用户变化时重建工作台，避免 token 刷新把正在填写的表单清空
    if (uid && (uid !== initializedForUser || !activeContext?.active)) initTeacherView();
  });

  if (hasAccess) {
    await initTeacherView();
  }

  // ── 教师工作台主逻辑 ──
  async function initTeacherView() {
if (activeContext) activeContext.active = false;
const context={handlers:{}, active:true, userId:ScipOJPlatform.getUser()?.id};
activeContext = context;
Object.assign(context.handlers,invites(context,{esc,formatTime}));
Object.assign(context.handlers,gradebook(context,{esc,formatTime}));
Object.assign(context.handlers,evidence(context,{esc,formatTime}));
Object.assign(context.handlers,roster(context,{esc,formatTime}));
Object.assign(context.handlers,assignments(context,{esc,formatTime}));
Object.assign(context.handlers,similarity(context,{esc,formatTime}));
initializedForUser = ScipOJPlatform.getUser()?.id || null;
context.courseSelect = document.getElementById("course-select");
context.courseSelect.disabled=true;
context.inviteCodeEl = document.getElementById("course-invite-code");
context.btnCopyInvite = document.getElementById("btn-copy-invite");
context.btnRotateInvite = document.getElementById("btn-rotate-invite");
context.tabBtns = document.querySelectorAll(".teacher-tabs .tab-btn");
context.tabBtns.forEach(button=>button.disabled=true);
context.tabContents = {
    gradebook: document.getElementById("tab-gradebook"),
    roster: document.getElementById("tab-roster"),
    assignments: document.getElementById("tab-assignments"),
};
context.currentCourseId = null;
context.currentCoursesList = [];
context.currentRosterData = [];
context.currentAssignmentsList = [];
// 加载教师授课课程列表
try {
    const enrollments = await ScipOJPlatform.getMyCourses();
    if (!context.active || ScipOJPlatform.getUser()?.id !== context.userId) return;
    context.currentCoursesList = enrollments.filter(e => e.role === "teacher" || e.role === "ta" || e.role === "admin");
    if (context.currentCoursesList.length === 0) {
        context.courseSelect.innerHTML = "<option>未分配任何授课班级</option>";
        return;
    }
    context.courseSelect.innerHTML = context.currentCoursesList.map(e => {
        const c = e.courses || {};
        return `<option value="${c.id}">${esc(c.code || '')} - ${esc(c.name || c.id)}</option>`;
    }).join("");
    context.currentCourseId = null;
    // 成绩表 / 邀请码加载必须等下方 rosterArea 等变量初始化后再跑，
    // 否则会命中 const TDZ，页面永远停在「正在加载班级成绩表...」。
}
catch (err) {
    console.error("[Teacher] 加载授课列表失败:", err);
}
context.inviteDisplaySeq = 0;
// 复制邀请码
if (context.btnCopyInvite) {
    context.btnCopyInvite.onclick = () => {
        const code = context.inviteCodeEl?.textContent;
        if (!code || code === "加载中…" || code === "未配置") {
            ScipOJPlatform.showToast("邀请码尚未加载完成或未配置", "warning");
            return;
        }
        navigator.clipboard.writeText(code).then(() => {
            ScipOJPlatform.showToast(`邀请码 ${code} 已复制到剪贴板`, "success");
        }).catch(() => {
            ScipOJPlatform.showTextDialog({ title: "复制邀请码", text: code });
        });
    };
}
// 轮换邀请码
if (context.btnRotateInvite) {
    context.btnRotateInvite.onclick = async () => {
        if (!context.currentCourseId)
            return;
        const customCode = await ScipOJPlatform.showPromptDialog({
            title: "轮换课程邀请码",
            message: "请输入新的邀请码（仅字母、数字、下划线或短横线，4-32 位）；留空将自动生成随机邀请码。",
            defaultValue: "",
            confirmText: "确认轮换",
        });
        if (customCode === null)
            return;
        if (customCode && !/^[A-Za-z0-9_-]{4,32}$/.test(customCode)) {
            ScipOJPlatform.showToast("邀请码只能包含字母、数字、下划线或短横线（4-32 位）", "warning");
            return;
        }
        context.btnRotateInvite.disabled = true;
        try {
            const newCode = await ScipOJPlatform.rotateCourseInviteCode(context.currentCourseId, customCode);
            ScipOJPlatform.showToast(`邀请码已成功更新为：${newCode}`, "success");
            await context.handlers.updateCourseInviteDisplay();
        }
        catch (err) {
            ScipOJPlatform.showToast("轮换邀请码失败: " + err.message, "error");
        }
        finally {
            context.btnRotateInvite.disabled = false;
        }
    };
}
context.rosterArea = document.getElementById("roster-area");
context.filterProblem = document.getElementById("filter-problem");
context.filterKeyword = document.getElementById("filter-keyword");
context.btnRefresh = document.getElementById("btn-refresh");
context.btnSimilarityAudit = document.getElementById("btn-similarity-audit");
context.btnExportCsv = document.getElementById("btn-export-csv");
context.btnBatchRegrade = document.getElementById("btn-batch-regrade");
context.btnRegradeProblem = document.getElementById("btn-regrade-problem");
context.batchProgressBar = document.getElementById("batch-progress-bar");
context.batchProgressText = document.getElementById("batch-progress-text");
if (context.filterProblem)
    context.filterProblem.onchange = () => {
        context.handlers.resetGradebookPage?.();
        context.handlers.renderGradebookTable();
    };
if (context.filterKeyword)
    context.filterKeyword.oninput = () => {
        context.handlers.resetGradebookPage?.();
        context.handlers.renderGradebookTable();
    };
if (context.btnRefresh) {
    context.btnRefresh.onclick = async () => {
        if (!context.currentCourseId)
            return;
        context.btnRefresh.disabled = true;
        const original = context.btnRefresh.textContent;
        context.btnRefresh.textContent = "刷新中…";
        try {
            await context.handlers.loadGradebook(context.currentCourseId);
            ScipOJPlatform.showToast("成绩表已刷新", "success");
        }
        catch (err) {
            ScipOJPlatform.showToast("刷新失败: " + err.message, "error");
        }
        finally {
            context.btnRefresh.disabled = false;
            context.btnRefresh.textContent = original;
        }
    };
}
// ── 批量复判 ──
if (context.btnBatchRegrade) {
    context.btnBatchRegrade.onclick = async () => {
        const checkedBoxes = document.querySelectorAll(".roster-table .row-checkbox:checked");
        const ids = Array.from(checkedBoxes).map(cb => cb.dataset.subId).filter(Boolean);
        if (ids.length === 0) {
            ScipOJPlatform.showToast("请先勾选需要复判的学生提交记录", "warning");
            return;
        }
        const reason = await ScipOJPlatform.showPromptDialog({
            title: "批量复判",
            message: `确定要对选中的 ${ids.length} 条提交发起批量复判吗？复判说明将写入审计日志。`,
            defaultValue: "教师批量抽查复判",
            confirmText: `确认复判 ${ids.length} 条`,
            required: true,
        });
        if (reason === null)
            return;
        context.btnBatchRegrade.disabled = true;
        context.batchProgressBar.hidden = false;
        context.batchProgressText.textContent = `正在调度批量复判 (0/${ids.length})…`;
        try {
            const res = await ScipOJPlatform.requestBatchRegrade(ids, reason, (curr, total) => {
                context.batchProgressText.textContent = `正在调度批量复判 (${curr}/${total})…`;
            });
            const okCount = Number(res.success_count || 0);
            const failures = (res.results || []).filter(r => !r.success);
            if (failures.length > 0) {
                ScipOJPlatform.showToast(`批量复判：成功 ${okCount} 条，失败 ${failures.length} 条。首个错误：${failures[0].error || "未知错误"}`, "warning");
            }
            else {
                ScipOJPlatform.showToast(`批量复判调度完成！共触发 ${okCount} 条评测任务。`, "success");
            }
            if (context.currentCourseId)
                await context.handlers.loadGradebook(context.currentCourseId);
        }
        catch (err) {
            ScipOJPlatform.showToast("批量复判请求异常: " + err.message, "error");
        }
        finally {
            context.btnBatchRegrade.disabled = false;
            context.batchProgressBar.hidden = true;
        }
    };
}
// ── 整题一键重判 ──
if (context.btnRegradeProblem) {
    context.btnRegradeProblem.onclick = async () => {
        const p = context.filterProblem.value;
        if (!p) {
            ScipOJPlatform.showToast("请先在上方「题目」下拉框中选择要重判的特定题目", "warning");
            return;
        }
        const confirmed = await ScipOJPlatform.showConfirmDialog({
            title: "整题一键重判",
            message: `警告：整题重判将重新评测全班所有学生在题目 ${p} 的提交。\n通常在教师更新测例或修复参考实现后使用。\n\n确定继续吗？`,
            confirmText: "继续重判",
            danger: true,
        });
        if (!confirmed)
            return;
        const reason = await ScipOJPlatform.showPromptDialog({
            title: "整题重判原因",
            message: `请填写题目 ${p} 的重判原因（写入审计日志）。`,
            defaultValue: `测例更新整题重判 (${p})`,
            confirmText: "确认重判",
            required: true,
        });
        if (reason === null)
            return;
        context.btnRegradeProblem.disabled = true;
        context.batchProgressBar.hidden = false;
        context.batchProgressText.textContent = `正在调度题目 ${p} 的全班提交重判…`;
        try {
            const res = await ScipOJPlatform.requestProblemRegrade(context.currentCourseId, p, reason, (curr, total) => {
                context.batchProgressText.textContent = `正在重判 ${p} (${curr}/${total})…`;
            });
            const okCount = Number(res.success_count || 0);
            const total = Number(res.total || okCount);
            const failures = (res.results || []).filter(r => !r.success);
            ScipOJPlatform.showToast(failures.length > 0
                ? `整题重判：成功 ${okCount}/${total} 条，失败 ${failures.length} 条。首个错误：${failures[0].error || "未知错误"}`
                : `整题重判已调度入队！共触发 ${okCount} 条。`, failures.length > 0 ? "warning" : "success");
            if (context.currentCourseId)
                await context.handlers.loadGradebook(context.currentCourseId);
        }
        catch (err) {
            ScipOJPlatform.showToast("整题重判失败: " + err.message, "error");
        }
        finally {
            context.btnRegradeProblem.disabled = false;
            context.batchProgressBar.hidden = true;
        }
    };
}
// ── 相似度初筛导出 ──
if (context.btnSimilarityAudit) {
    context.btnSimilarityAudit.onclick = () => {
        context.handlers.runSimilarityAuditForCurrentProblem();
    };
}
// ── 导出成绩 CSV ──
if (context.btnExportCsv) {
    context.btnExportCsv.onclick = () => {
        const filtered = context.handlers.getFilteredRoster();
        if (filtered.length === 0) {
            ScipOJPlatform.showToast("当前筛选条件下暂无成绩记录可供导出", "info");
            return;
        }
        const headers = ["学号", "姓名", "题目", "最高分", "是否通过", "迟交状态", "提交轮次", "最后提交时间"];
        const rows = filtered.map(row => {
            const passScore = row.pass_score ?? 90;
            const isPass = row.best_score != null && row.best_score >= passScore;
            const curAssign = context.currentAssignmentsList.find(a => a.id === row.assignment_id || a.problem_id === row.problem_id);
            const isLate = curAssign?.due_at && row.last_submitted_at ? new Date(row.last_submitted_at) > new Date(curAssign.due_at) : false;
            return [
                row.student_no || "",
                row.display_name || "",
                row.problem_id || "",
                row.best_score != null ? row.best_score : "",
                isPass ? "通过" : "未通过",
                isLate ? "迟交" : "正常",
                row.attempt_count != null ? row.attempt_count : "",
                row.last_submitted_at || "",
            ];
        });
        // 写入 UTF-8 BOM，防止 Excel 打开乱码；
        // 同时对 =/+/-/@ 开头的单元格加前缀，避免 CSV 公式注入（学生姓名可被构造）
        const escapeCell = (value) => {
            let text = String(value ?? "");
            if (/^[=+\-@\t\r]/.test(text))
                text = "'" + text;
            return `"${text.replace(/"/g, '""')}"`;
        };
        const csvContent = "\uFEFF" + [headers, ...rows]
            .map(r => r.map(escapeCell).join(","))
            .join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const pTag = context.filterProblem.value ? `-${context.filterProblem.value}` : "";
        a.download = `scip-oj-gradebook-${new Date().toISOString().slice(0, 10)}${pTag}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ScipOJPlatform.showToast("成绩 CSV 导出成功", "success");
    };
}
context.csvInputText = document.getElementById("csv-input-text");
context.csvFilePicker = document.getElementById("csv-file-picker");
context.btnTriggerFile = document.getElementById("btn-trigger-file");
context.btnSubmitCsv = document.getElementById("btn-submit-csv");
context.csvImportStatus = document.getElementById("csv-import-status");
context.pendingRosterArea = document.getElementById("pending-roster-area");
if (context.btnTriggerFile && context.csvFilePicker) {
    context.btnTriggerFile.onclick = () => context.csvFilePicker.click();
    context.csvFilePicker.onchange = (e) => {
        const file = e.target.files[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            context.csvInputText.value = evt.target.result;
            context.csvImportStatus.textContent = `已载入文件 ${file.name} (${Math.round(file.size / 1024)} KB)`;
            context.csvImportStatus.className = "pass";
        };
        reader.readAsText(file, "utf-8");
    };
}
if (context.btnSubmitCsv) {
    context.btnSubmitCsv.onclick = async () => {
        if (!context.currentCourseId)
            return;
        const content = context.csvInputText.value.trim();
        if (!content) {
            ScipOJPlatform.showToast("请先输入或从文件载入 CSV 内容", "warning");
            return;
        }
        context.btnSubmitCsv.disabled = true;
        context.btnSubmitCsv.textContent = "导入中…";
        context.csvImportStatus.textContent = "";
        try {
            const res = await ScipOJPlatform.importRosterCSV(context.currentCourseId, content);
            context.csvImportStatus.textContent = `✓ 导入 ${res.total} 条花名册；学号自动匹配后仍需教师本人核验，考试才可提交。`;
            context.csvImportStatus.className = "pass";
            context.csvInputText.value = "";
            await context.handlers.loadPendingRoster(context.currentCourseId);
            ScipOJPlatform.showToast(`成功导入 ${res.total} 名学生花名册`, "success");
        }
        catch (err) {
            context.csvImportStatus.textContent = `❌ 导入失败: ${err.message}`;
            context.csvImportStatus.className = "fail";
            ScipOJPlatform.showToast("导入失败: " + err.message, "error");
        }
        finally {
            context.btnSubmitCsv.disabled = false;
            context.btnSubmitCsv.textContent = "确认导入名单";
        }
    };
}
context.formPublish = document.getElementById("form-publish-assignment");
context.assignProblemSelect = document.getElementById("assign-problem-select");
context.assignCustomProblem = document.getElementById("assign-custom-problem");
context.assignDueAt = document.getElementById("assign-due-at");
context.assignPassScore = document.getElementById("assign-pass-score");
context.assignInstances = document.getElementById("assign-instances");
context.assignPolicy = document.getElementById("assign-policy");
context.assignIntegrityPolicy = document.getElementById("assign-integrity-policy");
context.publishStatus = document.getElementById("publish-status");
context.courseAssignmentsArea = document.getElementById("course-assignments-area");
await context.handlers.initProblemOptions();
if (context.assignProblemSelect) {
    context.assignProblemSelect.onchange = () => {
        context.assignCustomProblem.hidden = (context.assignProblemSelect.value !== "__custom__");
    };
}
if (context.formPublish) {
    context.formPublish.onsubmit = async (e) => {
        e.preventDefault();
        if (!context.currentCourseId) {
            ScipOJPlatform.showToast("请先选择教学班级", "warning");
            return;
        }
        let pId = context.assignProblemSelect.value;
        if (pId === "__custom__") {
            pId = context.assignCustomProblem.value.trim().toUpperCase();
        }
        if (!pId) {
            ScipOJPlatform.showToast("请选择或输入有效的题目编号", "warning");
            return;
        }
        let dueVal = null;
        if (context.assignDueAt.value) {
            const d = new Date(context.assignDueAt.value);
            if (Number.isNaN(d.getTime())) {
                context.publishStatus.textContent = "❌ 截止时间格式不正确";
                context.publishStatus.className = "fail";
                return;
            }
            dueVal = d.toISOString();
        }
        const passScoreVal = parseInt(context.assignPassScore.value, 10);
        const instancesVal = parseInt(context.assignInstances.value, 10);
        const policyVal = context.assignPolicy.value;
        if (!Number.isInteger(passScoreVal) || passScoreVal < 0 || passScoreVal > 100) {
            context.publishStatus.textContent = "❌ 及格线必须是 0-100 的整数（默认 90）";
            context.publishStatus.className = "fail";
            return;
        }
        if (!Number.isInteger(instancesVal) || instancesVal < 1 || instancesVal > 20) {
            context.publishStatus.textContent = "❌ 测试实例数必须是 1-20 的整数";
            context.publishStatus.className = "fail";
            return;
        }
        const btnSave = document.getElementById("btn-save-assignment");
        context.publishing=true;
        context.courseSelect.disabled=true;
        btnSave.disabled = true;
        btnSave.textContent = "保存配置中…";
        context.publishStatus.textContent = "";
        try {
            await ScipOJPlatform.publishAssignment({
                course_id: context.currentCourseId,
                problem_id: pId,
                due_at: dueVal,
                pass_score: passScoreVal,
                n_instances: instancesVal,
                score_policy: policyVal,
                integrity_policy: context.assignIntegrityPolicy?.value || "standard",
            });
            context.publishStatus.textContent = `✓ 作业 ${pId} 已成功发布/保存至当前班级！`;
            context.publishStatus.className = "pass";
            context.markTeacherPublished?.();
            ScipOJPlatform.showToast(`作业 ${pId} 配置发布成功！`, "success");
            await context.handlers.loadCourseAssignments(context.currentCourseId);
            context.handlers.updateProblemFilterOptions();
        }
        catch (err) {
            context.publishStatus.textContent = `❌ 保存失败: ${err.message}`;
            context.publishStatus.className = "fail";
            ScipOJPlatform.showToast("保存作业失败: " + err.message, "error");
        }
        finally {
            context.publishing=false;
            context.courseSelect.disabled=false;
            btnSave.disabled = false;
            btnSave.textContent = "发布 / 保存作业配置";
        }
    };
}
if(!context.active||signal?.aborted)return;
await installTeacherJourney(context);
if(!context.active||signal?.aborted)return;
context.courseSelect.disabled=false;
context.tabBtns.forEach(button=>button.disabled=false);
}

  function esc(s) {
    return ScipOJPlatform.escapeHtml(s);
  }

  function formatTime(isoStr) {
    if (!isoStr) return "-";
    try {
      return new Date(isoStr).toLocaleString("zh-CN");
    } catch {
      return isoStr;
    }
  }
})();
window.ScipOJPageSession?.ready(ready);
