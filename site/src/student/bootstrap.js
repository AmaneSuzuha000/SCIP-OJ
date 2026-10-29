import {state} from './state.js';
import {loadJSON,escapeHtml,getCodeValue} from './shared.js';
import {applyProblemFilters,updateBannerCourseInfo} from './course.js';
import {showWorkbenchTab,showConsoleTab,confirmLeaveIfExamDraft,closeWorkspace,handleRouteHash,refreshAssignmentMeta} from './workbench.js';
import {refreshHistory,refreshSubmissionsList} from './submissions.js';
import {installContextControls,saveList,taskKey,contextHash} from './context.js';
export async function main() {
    document.querySelector(".skip-link")?.addEventListener("click", event => {
        event.preventDefault();
        const mainContent = document.getElementById("main-content");
        mainContent?.focus({ preventScroll: true });
        mainContent?.scrollIntoView({ block: "start" });
    });
    // 1. 初始化平台层
    const platformReady = (async () => {
      if (window.ScipOJPlatform) {
        try {
            await window.ScipOJPlatform.init();
        }
        catch (e) {
            console.warn("[App] 平台初始化异常:", e);
        }
        window.ScipOJPlatform.onAuthChange?.(() => {
            updateBannerCourseInfo();
            const fingerprint=JSON.stringify(window.ScipOJPlatform.getEnrollments().map(e=>[e.course_id,e.role]));
            if(state.navigationReady&&fingerprint!==state.courseFingerprint){state.courseFingerprint=fingerprint;state.assignmentCache=null;window.ScipOJJourney.go(location.href,{force:true});}
            if(state.activeProblemId)refreshAssignmentMeta(state.activeProblemId);
        });
        document.addEventListener('scipoj:enrollments-changed',()=>{
            state.assignmentCache=null;
            window.ScipOJJourney.go(location.href,{force:true});
        });
      }
      state.platformReady = true;
      state.courseFingerprint=JSON.stringify(window.ScipOJPlatform?.getEnrollments().map(e=>[e.course_id,e.role])||[]);
      updateBannerCourseInfo();
    })().catch(error => console.warn('[App] 课程信息恢复失败:', error));
    platformReady.then(()=>{
        window.ScipOJJourney.setUser(window.ScipOJPlatform?.getUser()?.id);
        if(state.navigationReady){state.assignmentCache=null;window.ScipOJJourney.go(location.href,{force:true});}
    });
    window.ScipOJJourney.setUser(window.ScipOJPlatform?.getUser()?.id);
    installContextControls();
    // 2. 加载题目索引
    try {
        state.problemIndex = await loadJSON("problems/index.json");
        applyProblemFilters();
        const overviewEl = document.getElementById("overview-problems");
        if (overviewEl)
            overviewEl.textContent = String(state.problemIndex.length).padStart(2, "0");
    }
    catch (err) {
        const listEl = document.getElementById("problem-list");
        if (listEl) {
            listEl.innerHTML = `<p class="fail">题目索引加载失败: ${escapeHtml(err.message)}</p>`;
        }
        return;
    }
    // Local drafts are never used as authoritative grades.
    document.getElementById("code")?.addEventListener("input", (event) => {
        if (!state.activeProblemId)
            return;
        if(!state.problemLoaded)return;
        const status = document.getElementById("draft-state");
        if (window.ScipOJExam?.getPolicy() !== "standard") {
            if (status)
                status.textContent = "考试模式：本地草稿存储已停用。请通过正式提交保存答案。";
            return;
        }
        if(!state.platformReady) {
            state.pendingDraft={problemId:state.activeProblemId,source:event.target.value};
            if(status)status.textContent='代码暂存于当前页面 · 正在确认课程信息';
            return;
        }
        try {
            localStorage.setItem(taskKey("draft"), event.target.value);
            state.draftSaveFailed=false;
            if (status)
                status.textContent = "草稿已保存到本浏览器 · 尚未正式提交";
        }
        catch {
            state.draftSaveFailed=true;
            if (status)
                status.textContent = "浏览器存储不可用，请复制代码自行保存";
        }
    });
    // 3. Search, difficulty, progress, layout and workbench tabs
    document.getElementById("problem-search-input")?.addEventListener("input", () => {applyProblemFilters();saveList();});
    document.getElementById("filter-difficulty")?.addEventListener("change", () => {applyProblemFilters();saveList();});
    document.getElementById("filter-progress")?.addEventListener("change", () => {applyProblemFilters();saveList();});
    try {
        state.listViewMode = localStorage.getItem("scipoj:list-view") === "grid" ? "grid" : "table";
    }
    catch { /* blocked storage */ }
    const switchView = (mode,persist=true) => {
        state.listViewMode = mode;
        try {
            localStorage.setItem("scipoj:list-view", mode);
        }
        catch { /* blocked storage */ }
        for (const [id, selected] of [["view-list", mode === "table"], ["view-grid", mode === "grid"]]) {
            const button = document.getElementById(id);
            if (button) {
                button.classList.toggle("active", selected);
                button.setAttribute("aria-pressed", String(selected));
            }
        }
        applyProblemFilters();if(persist)saveList();
    };
    document.getElementById("view-list")?.addEventListener("click", () => switchView("table"));
    document.getElementById("view-grid")?.addEventListener("click", () => switchView("grid"));
    switchView(state.listViewMode,false);
    document.getElementById("tab-description")?.addEventListener("click", () => window.ScipOJJourney.patch({tab:null}));
    document.getElementById("tab-history")?.addEventListener("click", () => window.ScipOJJourney.patch({tab:"history"}));
    // Reuse the existing submissions component without duplicating its ID or backend calls.
    const historyPanel = document.getElementById("history-tab");
    const submissions = document.getElementById("my-submissions-section");
    if (historyPanel && submissions)
        historyPanel.appendChild(submissions);
    document.getElementById("btn-refresh-submissions").onclick = refreshHistory;
    window.ScipOJEditor?.init();
    window.ScipOJExam?.bind();
    document.getElementById("tab-testcase")?.addEventListener("click", () => window.ScipOJJourney.patch({console:null}));
    document.getElementById("tab-result")?.addEventListener("click", () => window.ScipOJJourney.patch({console:"result"}));
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && state.activeProblemId) {
            e.preventDefault();
            const button = document.getElementById(e.shiftKey ? "btn-submit-formal" : "btn-grade");
            if (button && !button.disabled)
                button.click();
        }
    });
    const btnBack=document.getElementById('btn-back-to-list');
    btnBack.onclick=event=>{
        event.preventDefault();
        const target=state.studyNotebook ? (state.studyNotebook.space==='course'?'#course-labs':'#learn-notebooks') : '#problem-list-section';
        window.ScipOJJourney.back(contextHash(target));
    };
    // Keep exam navigation explicit; switching discards unsaved exam source.
    for (const [id, step] of [["btn-prev-problem", -1], ["btn-next-problem", 1]]) {
        document.getElementById(id)?.addEventListener("click", async () => {
            const problems=state.problemIndex.filter(p=>!state.courseId||state.courseAssignments.some(a=>a.problem_id===p.id));
            const index = problems.findIndex(p => p.id === state.activeProblemId);
            const next = problems[index + step];
            if (!next)
                return; // The hash router asks once before leaving an exam draft.
            window.ScipOJJourney.go(contextHash("#"+next.id));
        });
    }
    window.addEventListener("beforeunload", event => {
        if(!window.ScipOJJourney.isLeaving()&&state.activeProblemId&&(state.draftSaveFailed||state.pendingDraft?.problemId===state.activeProblemId)&&getCodeValue().trim()!==state.currentTemplate.trim()){event.preventDefault();event.returnValue='';}
        if(!window.ScipOJJourney.isLeaving()&&window.ScipOJRuntime?.getNotebookStatus?.().dirty){event.preventDefault();event.returnValue='';}
        if (!window.ScipOJJourney.isLeaving() && window.ScipOJExam?.getPolicy() !== "standard" && state.activeProblemId && getCodeValue().trim() !== state.currentTemplate.trim()) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    // 5. 班级横幅选课按钮
    const btnBannerJoin = document.getElementById("btn-banner-join-course");
    if (btnBannerJoin && window.ScipOJPlatform) {
        btnBannerJoin.onclick = () => {
            if (!window.ScipOJPlatform.getUser()) {
                window.ScipOJPlatform.showLoginDialog();
            }
            else {
                window.ScipOJPlatform.showJoinCourseDialog();
            }
        };
    }
    const sameTask=url=>{
        if(url.pathname!==location.pathname)return false;
        const next=window.ScipOJNavigation.parseRoute(url.hash);
        const course=next.params.get('mode')==='practice'?null:(next.courseId||state.courseId);
        return state.activeProblemId ? next.problemId===state.activeProblemId&&course===state.courseId : state.studyNotebook && next.notebook?.path===state.studyNotebook.path;
    };
    state.navigationReady=true;
    await window.ScipOJJourney.configure({
        render:handleRouteHash,
        save:saveList,
        beforeLeave:async url=>{
            if(sameTask(url))return true;
            if(state.activeProblemId && !(await confirmLeaveIfExamDraft()))return false;
            if(state.submitting || window.ScipOJRuntime?.getStatus().phase==='running') {
                const ok=await window.ScipOJPlatform.showConfirmDialog({title:'离开当前任务？',message:state.submitting?'正式提交正在处理中。离开后可在提交记录查看结果。':'当前练习仍在运行，离开将停止本次运行。',confirmText:'确定离开'});
                if(!ok)return false;
            }
            if((state.draftSaveFailed||state.pendingDraft?.problemId===state.activeProblemId) && state.activeProblemId && getCodeValue().trim()!==state.currentTemplate.trim()) {
                return window.ScipOJPlatform.showConfirmDialog({title:'草稿尚未保存',message:'代码只暂存在当前页面，请先复制代码或等待课程信息恢复；离开可能丢失修改。',confirmText:'确定离开',danger:true});
            }
            if(state.studyNotebook||document.querySelector('.workspace-layout').classList.contains('notebook-mode')||window.ScipOJRuntime?.getNotebookStatus?.().dirty) {
                try {await window.ScipOJRuntime?.saveNotebooks?.();}
                catch {window.ScipOJPlatform.showToast('Notebook 笔记保存失败，请保留当前页面并重试。','error');return false;}
            }
            return true;
        }
    });
}
