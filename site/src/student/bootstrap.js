import {state} from './state.js';
import {loadJSON,escapeHtml,getCodeValue} from './shared.js';
import {applyProblemFilters,updateBannerCourseInfo} from './course.js';
import {showWorkbenchTab,showConsoleTab,confirmLeaveIfExamDraft,closeWorkspace,handleRouteHash,refreshAssignmentMeta} from './workbench.js';
import {refreshHistory,refreshSubmissionsList} from './submissions.js';
export async function main() {
    document.querySelector(".skip-link")?.addEventListener("click", event => {
        event.preventDefault();
        const mainContent = document.getElementById("main-content");
        mainContent?.focus({ preventScroll: true });
        mainContent?.scrollIntoView({ block: "start" });
    });
    // 1. 初始化平台层
    if (window.ScipOJPlatform) {
        try {
            await window.ScipOJPlatform.init();
        }
        catch (e) {
            console.warn("[App] 平台初始化异常:", e);
        }
        updateBannerCourseInfo();
        window.ScipOJPlatform.onAuthChange?.(async () => {
            updateBannerCourseInfo();
            if (state.activeProblemId) {
                await refreshAssignmentMeta(state.activeProblemId);
                await refreshSubmissionsList();
            }
        });
        document.addEventListener("scipoj:enrollments-changed", async () => {
            updateBannerCourseInfo();
            if (state.activeProblemId) {
                await refreshAssignmentMeta(state.activeProblemId);
            }
        });
    }
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
        const status = document.getElementById("draft-state");
        if (window.ScipOJExam?.getPolicy() !== "standard") {
            if (status)
                status.textContent = "考试模式：本地草稿存储已停用。请通过正式提交保存答案。";
            return;
        }
        try {
            localStorage.setItem("scipoj:draft:" + state.activeProblemId, event.target.value);
            if (status)
                status.textContent = "草稿已保存到本浏览器 · 尚未正式提交";
        }
        catch {
            if (status)
                status.textContent = "浏览器存储不可用，请复制代码自行保存";
        }
    });
    // 3. Search, difficulty, progress, layout and workbench tabs
    document.getElementById("problem-search-input")?.addEventListener("input", applyProblemFilters);
    document.getElementById("filter-difficulty")?.addEventListener("change", applyProblemFilters);
    document.getElementById("filter-progress")?.addEventListener("change", applyProblemFilters);
    try {
        state.listViewMode = localStorage.getItem("scipoj:list-view") === "grid" ? "grid" : "table";
    }
    catch { /* blocked storage */ }
    const switchView = mode => {
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
        applyProblemFilters();
    };
    document.getElementById("view-list")?.addEventListener("click", () => switchView("table"));
    document.getElementById("view-grid")?.addEventListener("click", () => switchView("grid"));
    switchView(state.listViewMode);
    document.getElementById("tab-description")?.addEventListener("click", () => showWorkbenchTab("description"));
    document.getElementById("tab-history")?.addEventListener("click", () => showWorkbenchTab("history"));
    // Reuse the existing submissions component without duplicating its ID or backend calls.
    const historyPanel = document.getElementById("history-tab");
    const submissions = document.getElementById("my-submissions-section");
    if (historyPanel && submissions)
        historyPanel.appendChild(submissions);
    document.getElementById("btn-refresh-submissions").onclick = refreshHistory;
    window.ScipOJEditor?.init();
    window.ScipOJExam?.bind();
    document.getElementById("tab-testcase")?.addEventListener("click", () => showConsoleTab("testcase"));
    document.getElementById("tab-result")?.addEventListener("click", () => showConsoleTab("result"));
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && state.activeProblemId) {
            e.preventDefault();
            const button = document.getElementById(e.shiftKey ? "btn-submit-formal" : "btn-grade");
            if (button && !button.disabled)
                button.click();
        }
    });
    const courseMenu = document.getElementById("btn-course-menu");
    courseMenu?.addEventListener("click", () => {
        const expanded = courseMenu.getAttribute("aria-expanded") !== "true";
        courseMenu.setAttribute("aria-expanded", String(expanded));
        document.querySelector(".studio-rail")?.classList.toggle("rail-menu-open", expanded);
    });
    // From the course sidebar, never discard unsaved exam code silently.
    document.getElementById("nav-to-assessment")?.addEventListener("click", async (event) => {
        if (!state.activeProblemId)
            return; // The native anchor scroll works on the course landing.
        event.preventDefault();
        if (!(await confirmLeaveIfExamDraft()))
            return;
        closeWorkspace();
        window.history.replaceState(null, "", "#problem-list-section");
        document.getElementById("problem-list-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // 4. 返回题单按钮
    const btnBack = document.getElementById("btn-back-to-list");
    if (btnBack) {
        btnBack.onclick = async (e) => {
            e.preventDefault();
            if (await confirmLeaveIfExamDraft()) {
                closeWorkspace();
                document.getElementById("problem-list-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        };
    }
    // Keep exam navigation explicit; switching discards unsaved exam source.
    for (const [id, step] of [["btn-prev-problem", -1], ["btn-next-problem", 1]]) {
        document.getElementById(id)?.addEventListener("click", async () => {
            const index = state.problemIndex.findIndex(p => p.id === state.activeProblemId);
            const next = state.problemIndex[index + step];
            if (!next)
                return; // The hash router asks once before leaving an exam draft.
            location.hash = "#" + next.id;
        });
    }
    window.addEventListener("beforeunload", event => {
        if (window.ScipOJExam?.getPolicy() !== "standard" && state.activeProblemId && getCodeValue().trim() !== state.currentTemplate.trim()) {
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
    // 6. 路由与 hashchange 监听
    window.addEventListener("hashchange", () => {
        handleRouteHash();
    });
    handleRouteHash();
}