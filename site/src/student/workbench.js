import {state} from './state.js';
import {getCodeValue,loadJSON,loadText,escapeHtml,setCodeValue,publicSampleInstance} from './shared.js';
import {refreshSubmissionsList,startSubmissionsPolling} from './submissions.js';
import {beginPracticeRun,stopPracticeRun,setRunStatus,syncExecutionButtons} from './execution.js';
import {runPractice} from './practice.js';
import {showStudyNotebook} from './study.js';
import {prepareContext,restoreList,saveList,contextHash,taskKey,listKey} from './context.js';
import {applyProblemFilters,updateBannerCourseInfo} from './course.js';
export async function confirmLeaveIfExamDraft() {
    if (window.ScipOJExam?.getPolicy() === "standard" ||
        getCodeValue().trim() === state.currentTemplate.trim())
        return true;
    // Exam drafts are deliberately not saved to shared-computer localStorage.
    // Warn before navigating so students never lose work accidentally.
    if (window.ScipOJPlatform?.showConfirmDialog) {
        return window.ScipOJPlatform.showConfirmDialog({
            title: "离开考试代码工作区？",
            message: "考试模式不会自动保存代码草稿。离开本题前请先提交，否则当前修改会丢失。",
            confirmText: "确定离开", danger: true,
        });
    }
    return window.confirm("考试模式未保存代码：离开后当前修改会丢失，确定继续？");
}
export function updateProblemSequence() {
    const index = state.problemIndex.findIndex(p => p.id === state.activeProblemId);
    const prev = document.getElementById("btn-prev-problem");
    const next = document.getElementById("btn-next-problem");
    const position = document.getElementById("problem-position");
    if (prev)
        prev.disabled = index <= 0;
    if (next)
        next.disabled = index < 0 || index >= state.problemIndex.length - 1;
    if (position)
        position.textContent = index < 0 ? "" : `${index + 1} / ${state.problemIndex.length}`;
}
export function showConsoleTab(name, sync = true) {
    const result = name === "result";
    for (const [id, active] of [["tab-result", result], ["tab-testcase", !result]]) {
        const b = document.getElementById(id);
        if (b) {
            b.classList.toggle("active", active);
            b.setAttribute("aria-selected", String(active));
        }
    }
    const resultPanel = document.getElementById("result-panel");
    const testcasePanel = document.getElementById("testcase-panel");
    if (resultPanel)
        resultPanel.hidden = !result;
    if (testcasePanel)
        testcasePanel.hidden = result;
    if(sync&&state.problemLoaded&&state.activeProblemId)window.ScipOJJourney?.amend(window.ScipOJNavigation.withParams(location.hash,{console:result?'result':null}));
}
export function showWorkbenchTab(name) {
    const desc = name === "description";
    const readme = document.getElementById("readme");
    const history = document.getElementById("history-tab");
    const buttons = [
        [document.getElementById("tab-description"), desc],
        [document.getElementById("tab-history"), !desc],
    ];
    if (readme)
        readme.hidden = !desc;
    if (history)
        history.hidden = desc;
    for (const [button, active] of buttons)
        if (button) {
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        }
}
export async function handleRouteHash(url = new URL(location.href), options = {}) {
    const seq=++state.routeSeq;
    document.getElementById('workspace').setAttribute('aria-busy','true');
    const route=window.ScipOJSpaces.parseRoute(url.hash);
    const requestedCourse=route.params.get('mode')==='practice'?null:(route.courseId||state.courseId);
    if(state.activeProblemId&&(route.problemId!==state.activeProblemId||requestedCourse!==state.courseId||route.assignmentId&&route.assignmentId!==state.activeAssignment?.id)){
        state.problemLoaded=false;state.openSeq++;state.assignmentFetchSeq++;state.submissionsFetchSeq++;
        // The previous exam draft has already passed the shared leave guard.
        window.ScipOJExam?.activate('standard',null);
        document.getElementById('workspace').hidden=true;
        for(const id of ['btn-grade','btn-run-testcase','btn-submit-formal'])document.getElementById(id).disabled=true;
        document.getElementById('student-course-status').textContent='正在切换任务…';
    }
    const report=document.getElementById('report-dialog');
    if(report&&!report.hidden&&state.currentRoute?.submissionId!==route.submissionId)window.ScipOJPlatform.closeModal(report);
    const previous=state.currentRoute;
    if (!(await prepareContext(route,seq))) return;
    const canonical=window.ScipOJNavigation.parseRoute(location.hash);
    const sameTask=state.taskActor===(window.ScipOJPlatform?.getUser()?.id||window.ScipOJAccess?.getUser?.()?.id||'visitor') && previous?.problemId===canonical.problemId && previous?.courseId===canonical.courseId && previous?.assignmentId===canonical.assignmentId;
    state.currentRoute=canonical;
    restoreList();applyProblemFilters();updateBannerCourseInfo();
    const prob=state.problemIndex.find(p=>p.id===route.problemId);
    if(route.problemId&&!prob) {
        state.contextError='该题目不存在或尚未发布，请从课程作业重新进入。';
        const error=document.getElementById('journey-error');error.hidden=false;error.querySelector('[data-error-message]').textContent=state.contextError;
    }
    if(prob&&!state.contextError&&state.courseMode!=='choose') {
        window.ScipOJSpaces.activate(route);placeSubmissionPanel(false);
        if(!sameTask || !state.problemLoaded) await openProblem(prob.path,prob.id);
        else if(options.force)await refreshAssignmentMeta(prob.id);
        if(seq!==state.routeSeq)return;
        showWorkbenchTab(canonical.tab);showConsoleTab(canonical.console,false);
        if(sameTask && (canonical.tab==='history'||canonical.submissionId))await refreshSubmissionsList();
        const notebookVisible=document.querySelector('.workspace-layout').classList.contains('notebook-mode');
        if(canonical.presentation==='notebook'&&!notebookVisible)document.getElementById('btn-open-notebook').click();
        else if(canonical.presentation==='code'&&notebookVisible)document.getElementById('btn-return-code').click();
    } else {
        closeWorkspace(false);
        if(route.problemId){route.view='problems';route.key='problem-list-section';}
        window.ScipOJSpaces.activate(route);placeSubmissionPanel(route.view==='records');
        if(state.contextError)for(const panel of document.querySelectorAll('[data-teaching-view-panel]'))panel.hidden=true;
        else if(route.view==='notebook') {
            document.getElementById('workspace').setAttribute('aria-busy','true');
            document.getElementById('learning-space').hidden=true;
            await showStudyNotebook(route.notebook,seq);
        } else if(route.view==='records') await refreshSubmissionsList();
        if(seq!==state.routeSeq)return;
        if(route.anchor)document.getElementById(route.anchor)?.scrollIntoView({block:'start'});
        else if(route.view==='problems')window.scrollTo({top:window.ScipOJJourney.recall(listKey())?.scroll||0,behavior:'instant'});
        else window.scrollTo({top:0,behavior:'instant'});
    }
    if(seq===state.routeSeq){state.acceptedRoute=location.hash||'#course';document.getElementById('workspace').setAttribute('aria-busy','false');}
}
export function placeSubmissionPanel(globalHistory) {
    const section = document.getElementById("my-submissions-section");
    const target = document.getElementById(globalHistory ? "submissions-host" : "history-tab");
    if (section && target && section.parentElement !== target)
        target.appendChild(section);
    const title = section?.querySelector("h3");
    if (title)
        title.textContent = globalHistory ? "全部正式提交" : "本题正式提交记录";
    const leaderboard = document.getElementById("btn-show-leaderboard");
    if (leaderboard)
        leaderboard.hidden = globalHistory;
}
export function closeWorkspace(updateHash = true) {
    if(updateHash)return window.ScipOJJourney.back(contextHash("#problem-list-section"));
    state.studyNotebook = null;
    document.getElementById('workspace').classList.remove('study-mode');
    const back = document.getElementById('btn-back-to-list');
    back.href = contextHash('#problem-list-section');back.textContent = '← 返回课程作业';
    state.problemLoaded = false;
    stopPracticeRun(true);
    syncExecutionButtons();
    leaveNotebookView();
    state.openSeq++;
    state.assignmentFetchSeq++;
    state.submissionsFetchSeq++;
    state.activeProblemId = null;
    state.activeAssignment = null;
    window.ScipOJExam?.activate("standard", null);
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
    const ws = document.getElementById("workspace");
    const listSec = document.getElementById("problem-list-section");
    if (ws) {
        ws.hidden = true;
        ws.setAttribute("aria-busy", "false");
    }
    if (listSec)
        listSec.hidden = false;
    document.body.classList.remove("workbench-active");

}
export /** 打开指定题目工作区 */
async function openProblem(path, id) {
    state.taskActor=window.ScipOJPlatform?.getUser()?.id||window.ScipOJAccess?.getUser?.()?.id||'visitor';
    state.studyNotebook = null;
    document.getElementById('workspace').classList.remove('study-mode');
    const back = document.getElementById('btn-back-to-list');
    back.href = contextHash('#problem-list-section');
    back.textContent = '← 返回课程作业';
    leaveNotebookView();
    state.problemLoaded = false;
    document.querySelector('.workspace-layout').inert=true;
    stopPracticeRun(true);
    for (const button of ['btn-grade','btn-run-testcase']) document.getElementById(button).disabled = true;
    const seq = ++state.openSeq;
    state.activeProblemId = id;
    state.activeAssignment = null;
    const formalButton = document.getElementById("btn-submit-formal");
    document.getElementById('assignment-meta-bar').textContent='正在确认当前班级的作业规则…';
    document.getElementById('title').textContent=id+' · 正在加载…';
    document.getElementById('readme').textContent='正在加载题目…';
    document.getElementById('draft-state').textContent='正在恢复当前任务的草稿…';
    document.querySelector('.editor-container').hidden=true;
    if (formalButton)
        formalButton.disabled = true;
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
    const ws = document.getElementById("workspace");
    const listSec = document.getElementById("problem-list-section");
    if (ws) {
        ws.hidden = false;
        ws.setAttribute("aria-busy", "true");
    }
    if (listSec)
        listSec.hidden = true;
    document.body.classList.add("workbench-active");
    updateProblemSequence();
    // 滚动至顶部
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
        const meta = await loadJSON(`${path}/meta.json`);
        const readme = await loadText(`${path}/README.md`);
        const template = await loadText(`${path}/template.py`);
        // 用户快速切换题目时，丢弃过期的响应
        if (seq !== state.openSeq || state.activeProblemId !== id)
            return;
        state.currentTemplate = template;
        window.ScipOJExam?.activate("standard", id);
        showWorkbenchTab("description");
        document.getElementById("title").textContent = `${meta.id} · ${meta.title || state.problemIndex.find(p => p.id === id)?.title || ""}`;
        const readmeElement = document.getElementById('readme');
        if (window.ScipOJMarkdown) window.ScipOJMarkdown.render(readmeElement, readme);
        else readmeElement.textContent = readme;
        await refreshAssignmentMeta(id);
        if(seq!==state.openSeq||state.activeProblemId!==id)return;
        let savedDraft = null;
        try {
            if(window.ScipOJExam?.getPolicy()==='standard') savedDraft = localStorage.getItem(taskKey("draft",id));
        }
        catch { /* disabled storage */ }
        if(state.pendingDraft?.problemId===id){savedDraft=state.pendingDraft.source;state.pendingDraft=null;}
        setCodeValue(savedDraft === null ? state.currentTemplate : savedDraft);
        window.ScipOJEditor?.refresh();
        const draftStatus = document.getElementById("draft-state");
        if (draftStatus)
            draftStatus.textContent = savedDraft === null
                ? "初始模板 · 输入时会自动保存本地草稿"
                : "已恢复本浏览器的草稿 · 尚未正式提交";
        if(window.ScipOJExam?.getPolicy()==='standard'){
            let legacy;try {legacy=localStorage.getItem('scipoj:draft:'+id);}catch {}
            if(legacy!==null&&legacy!==undefined){
                const backup=document.createElement('button');backup.type='button';backup.className='ui-button';backup.id='btn-export-legacy-draft';backup.textContent='下载旧版草稿备份';
                backup.title='旧版草稿未标记账号与作业，请确认来源后自行使用。';
                backup.onclick=()=>{const url=URL.createObjectURL(new Blob([legacy],{type:'text/x-python;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=id+'-legacy-draft.py';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
                draftStatus?.append(' ',backup);
            }
        }
        document.getElementById("report").textContent = "";
        document.getElementById("status").textContent = "";
        showConsoleTab("testcase");
        const sample = publicSampleInstance(meta);
        const customInput = document.getElementById("testcase-input");
        if (customInput)
            customInput.value = JSON.stringify(sample, null, 2);
        // 绑定重置与复制代码按钮
        const btnReset = document.getElementById("btn-reset-template");
        if (btnReset) {
            btnReset.onclick = async () => {
                const ok = window.ScipOJPlatform
                    ? await window.ScipOJPlatform.showConfirmDialog({
                        title: "重置代码模板",
                        message: "确定要放弃当前修改并重置为初始模板吗？此操作不可撤销。",
                        confirmText: "重置模板",
                        danger: true,
                    })
                    : confirm("确定要放弃当前修改并重置为初始模板吗？");
                if (!ok)
                    return;
                setCodeValue(state.currentTemplate);
                try {
                    localStorage.removeItem(taskKey("draft",id));
                }
                catch { /* disabled storage */ }
                const draftStatus = document.getElementById("draft-state");
                if (draftStatus)
                    draftStatus.textContent = "已重置为初始模板 · 本地草稿已清除";
                window.ScipOJPlatform?.showToast("已重置为初始代码模板", "info");
            };
        }
        const btnCopy = document.getElementById("btn-copy-template");
        if (btnCopy) {
            btnCopy.onclick = () => {
                const val = getCodeValue();
                navigator.clipboard.writeText(val).then(() => {
                    window.ScipOJPlatform?.showToast("代码已复制到剪贴板", "success");
                }).catch(() => {
                    window.ScipOJPlatform?.showTextDialog({ title: "复制代码", text: val });
                });
            };
        }
        // Metadata and draft identity were resolved before restoring code.
        if (seq !== state.openSeq || state.activeProblemId !== id)
            return;
        // 绑定按钮行为
        setupActionButtons(meta, id);
        // 加载提交历史
        await refreshSubmissionsList();
    }
    catch (err) {
        if (seq !== state.openSeq)
            return; // 已切换到其他题目，忽略本次错误
        console.error("[App] 打开题目失败:", err);
        // 不要替换 #workspace 的 innerHTML：那会永久破坏后续题目导航所需的 DOM
        const readmeEl = document.getElementById("readme");
        if (readmeEl) {
            readmeEl.innerHTML = `<p class="fail">题目加载异常: ${escapeHtml(err.message)}。请返回题单后重试。</p>`;
        }
        const titleEl = document.getElementById("title");
        if (titleEl)
            titleEl.textContent = `${id} · 加载失败`;
        window.ScipOJPlatform?.showToast("题目加载失败: " + (err.message || err), "error");
    }
    finally {
        if (seq === state.openSeq && ws)
            ws.setAttribute("aria-busy", "false");
    }
}
export /** 刷新题目与作业关联元数据（截止时间、及格线、计分规则） */
async function refreshAssignmentMeta(problemId) {
    const requestSeq = ++state.assignmentFetchSeq;
    const metaBar = document.getElementById("assignment-meta-bar");
    const btnSubmitFormal = document.getElementById("btn-submit-formal");
    if (!metaBar)
        return;
    state.activeAssignment = null;
    if (!state.platformReady) {
        metaBar.textContent = '正在恢复课程信息…';
        if (btnSubmitFormal) btnSubmitFormal.disabled = true;
        return;
    }
    let assignment = null;
    if (state.courseId && !state.contextError && window.ScipOJPlatform?.isConfigured()) {
        try {
            assignment = await window.ScipOJPlatform.getAssignmentForProblem(problemId,state.courseId);
            if(assignment && (assignment.course_id!==state.courseId || (state.currentRoute?.assignmentId && assignment.id!==state.currentRoute.assignmentId)))assignment=null;
        }
        catch (e) {
            console.warn("[App] 获取作业信息失败:", e);
        }
    }
    if (requestSeq !== state.assignmentFetchSeq || state.activeProblemId !== problemId)
        return;
    state.activeAssignment = assignment;
    if (state.activeAssignment) {
        const dueStr = state.activeAssignment.due_at ? new Date(state.activeAssignment.due_at).toLocaleString("zh-CN") : "长期有效";
        const isLateNow = state.activeAssignment.due_at ? new Date() > new Date(state.activeAssignment.due_at) : false;
        const policyMap = {
            highest_before_due: "截止前最高分 (默认)",
            highest: "历史最高分",
            latest: "最新提交分",
        };
        metaBar.innerHTML = `
      <div class="meta-item">
        <span>📅 截止时间：</span>
        <strong>${dueStr}</strong>
        ${isLateNow ? '<span class="tag-late" style="margin-left:0.3rem;">已截止 (允许迟交)</span>' : '<span class="tag-normal" style="margin-left:0.3rem;">进行中</span>'}
      </div>
      <div class="meta-item">
        <span>🎯 及格线：</span>
        <strong style="color:var(--color-pass);">${state.activeAssignment.pass_score ?? 90} 分</strong>
      </div>
      <div class="meta-item">
        <span>⚖️ 计分策略：</span>
        <strong>${policyMap[state.activeAssignment.score_policy] || state.activeAssignment.score_policy}</strong>
      </div>
      <div class="meta-item">
        <span>🧪 实例数量：</span>
        <strong>${state.activeAssignment.n_instances || 3} 个多实例平均</strong>
      </div>
    `;
        window.ScipOJExam?.activate(state.activeAssignment.integrity_policy || "standard", problemId);
        if (state.activeAssignment.integrity_policy && state.activeAssignment.integrity_policy !== "standard") {
            leaveNotebookView();
            const badge = state.activeAssignment.integrity_policy === "exam_block" ? "考试 · 限制粘贴" : "考试 · 操作提示";
            metaBar.insertAdjacentHTML("beforeend", `<div class="meta-item"><strong class="tag-pending">${badge}</strong></div>`);
        }
        if (btnSubmitFormal) {
            btnSubmitFormal.disabled = false;
            btnSubmitFormal.title = "提交作业并记录成绩";
            btnSubmitFormal.style.opacity = "1";
        }
    }
    else {
        window.ScipOJExam?.activate("standard", problemId);
        const configured = !!(window.ScipOJPlatform && window.ScipOJPlatform.isConfigured());
        const loggedIn = !!(window.ScipOJPlatform && window.ScipOJPlatform.getUser());
        const enrollments = (window.ScipOJPlatform && window.ScipOJPlatform.getEnrollments()) || [];
        let hint;
        if (!configured) {
            hint = "🌿 <strong>离线练习模式</strong>：未配置后端服务，正式作业提交不可用；练习评分可正常使用。";
        }
        else if (!loggedIn) {
            hint = "🔐 <strong>未登录</strong>：登录并绑定学号、加入班级后即可提交正式作业；当前可先进行 练习。";
        }
        else if (enrollments.length === 0) {
            hint = "🎓 <strong>尚未加入班级</strong>：请点击右上角「选课」输入教师提供的邀请码，之后即可提交正式作业。";
        }
        else {
            hint = "🌿 <strong>自主练习模式</strong>：本题目当前未作为您所在班级的正式作业发布，您可在此进行 练习评分与算例调试。";
        }
        metaBar.innerHTML = `<div class="meta-item" style="color:var(--text-secondary);">${hint}</div>`;
        if (btnSubmitFormal) {
            // 保持按钮可点击：点击后给出明确原因/引导，而不是让用户面对一个无反馈的禁用按钮
            btnSubmitFormal.disabled = false;
            btnSubmitFormal.title = "点击查看正式提交条件";
            btnSubmitFormal.style.opacity = "1";
        }
    }
}
export function validNotebookSource() {
    if (!document.getElementById('workspace').dataset.notebookInvalid)
        return true;
    window.ScipOJPlatform?.showToast('请先恢复唯一的作业代码单元，再运行或提交。', 'warning');
    return false;
}
export function leaveNotebookView() {
    document.querySelector('.workspace-layout').inert=!state.problemLoaded&&!!state.activeProblemId;
    state.notebookViewSeq++;
    document.querySelector('.workspace-layout')?.classList.remove('notebook-mode');
    document.getElementById('workspace')?.removeAttribute('data-notebook-invalid');
    window.ScipOJRuntime?.hideNotebook();
    window.ScipOJRuntime?.detachNotebook();
    const editor = document.querySelector('.editor-container');
    if (editor)
        editor.hidden = false;
    document.getElementById('btn-open-notebook').hidden = false;
    document.getElementById('btn-open-notebook').disabled = false;
    document.getElementById('btn-return-code').hidden = true;
    window.ScipOJEditor?.refresh();
}
export /** 绑定评测与提交操作 */
function setupActionButtons(meta, id) {
    leaveNotebookView();
    const notebookState = document.getElementById('notebook-state');
    const notebookButton = document.getElementById('btn-open-notebook');
    notebookButton.onclick = async () => {
        if (window.ScipOJExam?.getPolicy() !== 'standard') {
            window.ScipOJPlatform?.showToast('考试期间请使用代码视图。', 'info');
            return;
        }
        const viewSeq = ++state.notebookViewSeq;
        notebookButton.disabled = true;
        notebookState.textContent = '正在打开建模环境…';
        try {
            await window.ScipOJRuntime.openNotebook(id, getCodeValue(), publicSampleInstance(meta), (code, error) => {
                if (viewSeq !== state.notebookViewSeq || state.activeProblemId !== id)
                    return;
                if (error) {
                    document.getElementById('workspace').dataset.notebookInvalid = 'true';
                    notebookState.textContent = error.message;
                    return;
                }
                if (window.ScipOJExam?.getPolicy() !== 'standard')
                    return;
                document.getElementById('workspace').removeAttribute('data-notebook-invalid');
                setCodeValue(code);
                document.getElementById('code').dispatchEvent(new Event('input', { bubbles: true }));
                notebookState.textContent = '作业代码已同步';
            });
            if (viewSeq !== state.notebookViewSeq)
                return;
            if (state.activeProblemId !== id || window.ScipOJExam?.getPolicy() !== 'standard') {
                leaveNotebookView();
                return;
            }
            document.querySelector('.workspace-layout').classList.add('notebook-mode');
            window.ScipOJJourney.amend(window.ScipOJNavigation.withParams(location.hash,{view:'notebook'}));
            document.querySelector('.editor-container').hidden = true;
            notebookButton.hidden = true;
            document.getElementById('btn-return-code').hidden = false;
            if (!document.getElementById('workspace').dataset.notebookInvalid)
                notebookState.textContent = '作业代码自动同步；正式提交使用该代码单元';
        }
        catch (e) {
            if (viewSeq === state.notebookViewSeq && e.code !== 'NOTEBOOK_CANCELLED')
                notebookState.textContent = e.message;
        }
        finally {
            if (viewSeq === state.notebookViewSeq)
                notebookButton.disabled = false;
        }
    };
    document.getElementById('btn-return-code').onclick = () => {
        try {
            setCodeValue(window.ScipOJRuntime.readCode());
            leaveNotebookView();
            window.ScipOJJourney.amend(window.ScipOJNavigation.withParams(location.hash,{view:null}));
            notebookState.textContent = '';
        }
        catch (e) {
            notebookState.textContent = e.message;
        }
    };
    const btnGradeL1 = document.getElementById("btn-grade");
    const btnSubmitFormal = document.getElementById("btn-submit-formal");
    const statusEl = document.getElementById("status");
    const reportEl = document.getElementById("report");
    const btnRefreshSubmissions = document.getElementById("btn-refresh-submissions");
    // Run a single student-authored test case locally. Never count it as a formal grade.
    const btnRunCustom = document.getElementById("btn-run-testcase");
    const customInput = document.getElementById("testcase-input");
    const btnResetCustom = document.getElementById("btn-reset-testcase");
    if (btnResetCustom)
        btnResetCustom.onclick = () => {
            if (customInput)
                customInput.value = JSON.stringify(publicSampleInstance(meta), null, 2);
        };
    if (btnRunCustom)
        btnRunCustom.onclick = async () => {
            if (!validNotebookSource())
                return;
            const raw = customInput?.value || "";
            if (raw.length > 20000) {
                window.ScipOJPlatform?.showToast("测试输入不能超过 20000 字符", "warning");
                return;
            }
            let instance;
            try {
                instance = JSON.parse(raw);
                if (!instance || Array.isArray(instance) || typeof instance !== "object") {
                    throw new Error("输入必须为 JSON 对象");
                }
                // Students never receive the authoritative optimal objective.
                delete instance.optimal_value;
            }
            catch (error) {
                window.ScipOJPlatform?.showToast("输入 JSON 无效: " + error.message, "warning");
                return;
            }
            showConsoleTab("result");
            const userCode = getCodeValue();
            const run = beginPracticeRun();
            if (!run) return;
            try {
                if (!window.ScipOJRuntime?.ensureReady)
                    throw new Error("Python WASM 运行环境不可用");
                const result = await window.ScipOJRuntime.runSolve(userCode, instance,
                    Math.min(Number(meta.time_limit_sec) || 15, 30), run.update);
                if (!run.current()) return;
                setRunStatus('done', '✓ 测试运行完成');
                reportEl.textContent = JSON.stringify({ kind: "custom_test", result,
                    note: "仅运行用户自定义输入；不验证最优性、不影响正式成绩。" }, null, 2);
            }
            catch (error) {
                if (!run.current()) return;
                setRunStatus('system_error', '运行失败');
                reportEl.textContent = "运行错误（不计正式分）：\n" + String(error?.message || error);
            }
            finally {
                run.finish();
            }
        };
    // ── 练习评分（浏览器 WASM 本地真跑，不写入正式数据库） ──
    btnGradeL1.onclick = async () => {
        if (!validNotebookSource())
            return;
        showConsoleTab("result");
        const userCode = getCodeValue();
        const timeLimitSec = meta.time_limit_sec || 10;
        const run = beginPracticeRun();
        if (!run) return;
        try {
            if (!window.ScipOJRuntime?.ensureReady)
                throw new Error("Python WASM 运行环境不可用");
            let caseNumber = 0;
            const studentSolve = async (instance) => {
                if (!run.current()) throw new Error('运行已取消');
                const number = ++caseNumber;
                return await window.ScipOJRuntime.runSolve(userCode, instance, timeLimitSec,
                    message => run.update(`测试 ${number}/${meta.n_instances_l1 ?? 3} · ${message}`));
            };
            const report = await runPractice(studentSolve, meta);
            report.execution_mode = "python-wasm-student-code";
            report.execution_note = "浏览器 Python WASM 真实执行（练习自测，不写正式数据库）";
            if (!run.current()) return;
            reportEl.textContent = JSON.stringify({ ...report, layer: "练习" }, null, 2);
            const isPass = report.passed;
            statusEl.innerHTML = isPass
                ? `<span class="badge badge-done">✓ 练习通过 · ${report.score} 分</span>`
                : `<span class="badge badge-system_error">✗ 练习未通过 · ${report.score} 分</span>`;
            // 仅存 localStorage 作为练习缓存，不写正式库
            try {
                localStorage.setItem(taskKey("practice",id), JSON.stringify({ score: report.score, at: Date.now() }));
            }
            catch { /* private browsing */ }
            window.ScipOJPlatform?.showToast(isPass ? `练习通过：${report.score} 分` : `练习未及格：${report.score} 分`, isPass ? "success" : "warning");
        }
        catch (e) {
            if (!run.current()) return;
            statusEl.innerHTML = `<span class="badge badge-system_error">评测异常</span>`;
            reportEl.textContent = "执行异常:\n" + String(e?.stack || e?.message || e);
            window.ScipOJPlatform?.showToast("练习执行异常: " + (e?.message || e), "error");
        }
        finally {
            run.finish();
        }
    };
    // ── 提交正式作业（服务端权威评测 + Actions） ──
    btnSubmitFormal.onclick = async () => {
        if (!validNotebookSource())
            return;
        if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
            window.ScipOJPlatform?.showToast("正式提交暂不可用，请先使用练习评分。", "warning");
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
                    await refreshAssignmentMeta(id);
                    btnSubmitFormal.click();
                }
            });
            return;
        }
        if (!state.activeAssignment) {
            const enrollments = window.ScipOJPlatform.getEnrollments();
            if (enrollments.length === 0) {
                window.ScipOJPlatform.showJoinCourseDialog({ forced: true });
            }
            else {
                window.ScipOJPlatform.showToast(`题目 ${id} 暂未在您选修的班级中开放正式作业提交，请联系任课教师。`, "warning");
            }
            return;
        }
        const userCode = getCodeValue().trim();
        if (!userCode) {
            window.ScipOJPlatform.showToast("提交代码不能为空，请先编写算法代码", "warning");
            document.getElementById("code")?.focus();
            return;
        }
        const submittedAssignment=state.activeAssignment, submittedProblem=id, submittedSequence=state.openSeq;
        const current=()=>state.activeProblemId===submittedProblem&&state.openSeq===submittedSequence&&state.courseId===submittedAssignment.course_id&&state.currentRoute?.assignmentId===submittedAssignment.id;
        state.submitting=true;
        btnSubmitFormal.disabled = true;
        statusEl.innerHTML = `<span class="badge badge-running">🚀 正在向服务端提交作业代码...</span>`;
        try {
            const res = await window.ScipOJPlatform.submitAssignment(submittedAssignment.id, userCode, window.ScipOJExam?.snapshot());
            if(!current())return;
            const codeStr = res.public_code || res.submission_id;
            const isSystemError = res.status === "system_error";
            if (isSystemError) {
                statusEl.innerHTML = `<span class="badge badge-system_error">⚠️ 已保存提交，但评测调度失败 (${codeStr})</span>`;
                window.ScipOJPlatform.showToast("提交已保存，但评测任务调度失败（系统故障，不计 0 分），请联系教师重试。", "error");
            }
            else {
                statusEl.innerHTML = `<span class="badge badge-queued">⏳ 已进入评测队列 (${codeStr})</span>`;
                window.ScipOJPlatform.showToast(`作业提交成功！编号 ${codeStr}，已进入评测队列`, "success");
            }
            if (res.warning && !isSystemError) {
                window.ScipOJPlatform.showToast(res.warning, "warning");
            }
            await refreshSubmissionsList();
            // Mock 模式不会在数据库里生成 grading 记录，轮询只会空转到超时
            const isMock = !!window.ScipOJPlatform.isMockMode?.();
            if (!isSystemError && !isMock)
                startSubmissionsPolling();
            else if (isMock) {
                window.ScipOJPlatform.showToast("Mock 模式仅用于本地联调，不会写入评测记录", "info");
            }
        }
        catch (err) {
            if(!current())return;
            statusEl.innerHTML = `<span class="badge badge-system_error">❌ 提交失败</span>`;
            window.ScipOJPlatform.showToast("提交失败: " + err.message, "error");
        }
        finally {
            state.submitting=false;
            if(current())btnSubmitFormal.disabled = false;
        }
    };
    // 刷新提交记录按钮
    if (btnRefreshSubmissions) {
        btnRefreshSubmissions.onclick = async () => {
            btnRefreshSubmissions.disabled = true;
            btnRefreshSubmissions.textContent = "刷新中…";
            await refreshSubmissionsList();
            btnRefreshSubmissions.disabled = false;
            btnRefreshSubmissions.textContent = "刷新记录";
            window.ScipOJPlatform?.showToast("提交记录已刷新", "info");
        };
    }
    state.problemLoaded = true;
    document.querySelector('.workspace-layout').inert=false;
    syncExecutionButtons();
}
