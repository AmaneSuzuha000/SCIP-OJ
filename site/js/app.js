/**
 * SCIP-OJ 学生端主应用逻辑 — 题单大厅、L1 WASM 练习与正式作业提交流程
 * 依赖: ScipOJPlatform, ScipOJRuntime, ScipOJJudge, ScipOJAssignment, marked
 */

const BASE = new URL(".", location.href);

async function loadJSON(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("加载失败: " + path);
  return r.json();
}

async function loadText(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("加载失败: " + path);
  return r.text();
}

let problemIndex = [];
let activeProblemId = null;
let activeAssignment = null;
let currentTemplate = "";
let pollTimer = null;
let listViewMode = "table";
let acceptedRoute = location.hash || "#learn";
let assignmentFetchSeq = 0;
let routeSeq = 0;
let submissionsFetchSeq = 0;

function getCodeValue() {
  return window.ScipOJEditor?.getValue() ?? document.getElementById("code").value;
}
function setCodeValue(value) {
  if (window.ScipOJEditor) window.ScipOJEditor.setValue(value);
  else document.getElementById("code").value = value;
}
function getPracticeProgress(id) {
  try {
    const raw = localStorage.getItem("scip-oj-practice:" + id);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function normalizeDifficulty(value) {
  const text = String(value || "").toLowerCase();
  if (["easy", "简单"].includes(text)) return "easy";
  if (["hard", "困难"].includes(text)) return "hard";
  return "medium";
}
function applyProblemFilters() {
  const query = (document.getElementById("problem-search-input")?.value || "").trim().toLowerCase();
  const difficulty = document.getElementById("filter-difficulty")?.value || "all";
  const progress = document.getElementById("filter-progress")?.value || "all";
  const filtered = problemIndex.filter(p => {
    const searchable = [p.id, p.title, p.difficulty, ...(p.tags || [])].join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (difficulty !== "all" && normalizeDifficulty(p.difficulty) !== difficulty) return false;
    const solved = !!getPracticeProgress(p.id)?.score && getPracticeProgress(p.id).score >= 90;
    return progress === "all" || (progress === "solved" ? solved : !solved);
  });
  renderProblemList(filtered);
}
async function confirmLeaveIfExamDraft() {
  if (window.ScipOJExam?.getPolicy() === "standard" ||
      getCodeValue().trim() === currentTemplate.trim()) return true;
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
function updateProblemSequence() {
  const index = problemIndex.findIndex(p => p.id === activeProblemId);
  const prev = document.getElementById("btn-prev-problem");
  const next = document.getElementById("btn-next-problem");
  const position = document.getElementById("problem-position");
  if (prev) prev.disabled = index <= 0;
  if (next) next.disabled = index < 0 || index >= problemIndex.length - 1;
  if (position) position.textContent = index < 0 ? "" : `${index + 1} / ${problemIndex.length}`;
}
function showConsoleTab(name) {
  const result = name === "result";
  for (const [id, active] of [["tab-result", result], ["tab-testcase", !result]]) {
    const b = document.getElementById(id);
    if (b) { b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); }
  }
  const resultPanel = document.getElementById("result-panel");
  const testcasePanel = document.getElementById("testcase-panel");
  if (resultPanel) resultPanel.hidden = !result;
  if (testcasePanel) testcasePanel.hidden = result;
}
function publicSampleInstance(meta) {
  const seed = Number(meta.seed_base || 20261021);
  const instance = (meta.grader === "assignment"
    ? window.ScipOJAssignment?.genAssignment(seed)
    : window.ScipOJJudge?.genKnapsack(seed)) || {};
  const { optimal_value: unusedOracle, ...publicInstance } = instance;
  return publicInstance;
}
function showWorkbenchTab(name) {
  const desc = name === "description";
  const readme = document.getElementById("readme");
  const history = document.getElementById("history-tab");
  const buttons = [
    [document.getElementById("tab-description"), desc],
    [document.getElementById("tab-history"), !desc],
  ];
  if (readme) readme.hidden = !desc;
  if (history) history.hidden = desc;
  for (const [button, active] of buttons) if (button) {
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}


async function main() {
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
    } catch (e) {
      console.warn("[App] 平台初始化异常:", e);
    }
  }

  // 2. 加载题目索引
  try {
    problemIndex = await loadJSON("problems/index.json");
    applyProblemFilters();
    const overviewEl = document.getElementById("overview-problems");
    if (overviewEl) overviewEl.textContent = String(problemIndex.length).padStart(2, "0");
  } catch (err) {
    const listEl = document.getElementById("problem-list");
    if (listEl) {
      listEl.innerHTML = `<p class="fail">题目索引加载失败: ${escapeHtml(err.message)}</p>`;
    }
    return;
  }

  // Local drafts are never used as authoritative grades.
  document.getElementById("code")?.addEventListener("input", (event) => {
    if (!activeProblemId) return;
    const status = document.getElementById("draft-state");
    if (window.ScipOJExam?.getPolicy() !== "standard") {
      if (status) status.textContent = "考试模式：本地草稿存储已停用。请通过正式提交保存答案。";
      return;
    }
    try {
      localStorage.setItem("scipoj:draft:" + activeProblemId, event.target.value);
      if (status) status.textContent = "草稿已保存到本浏览器 · 尚未正式提交";
    } catch {
      if (status) status.textContent = "浏览器存储不可用，请复制代码自行保存";
    }
  });

  // 3. Search, difficulty, progress, layout and workbench tabs
  document.getElementById("problem-search-input")?.addEventListener("input", applyProblemFilters);
  document.getElementById("filter-difficulty")?.addEventListener("change", applyProblemFilters);
  document.getElementById("filter-progress")?.addEventListener("change", applyProblemFilters);
  try { listViewMode = localStorage.getItem("scipoj:list-view") === "grid" ? "grid" : "table"; } catch { /* blocked storage */ }
  const switchView = mode => {
    listViewMode = mode;
    try { localStorage.setItem("scipoj:list-view", mode); } catch { /* blocked storage */ }
    for (const [id, selected] of [["view-list", mode === "table"], ["view-grid", mode === "grid"]]) {
      const button = document.getElementById(id);
      if (button) { button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); }
    }
    applyProblemFilters();
  };
  document.getElementById("view-list")?.addEventListener("click", () => switchView("table"));
  document.getElementById("view-grid")?.addEventListener("click", () => switchView("grid"));
  switchView(listViewMode);
  document.getElementById("tab-description")?.addEventListener("click", () => showWorkbenchTab("description"));
  document.getElementById("tab-history")?.addEventListener("click", () => showWorkbenchTab("history"));
  // Reuse the existing submissions component without duplicating its ID or backend calls.
  const historyPanel = document.getElementById("history-tab");
  const submissions = document.getElementById("my-submissions-section");
  if (historyPanel && submissions) historyPanel.appendChild(submissions);
  document.getElementById("btn-refresh-submissions").onclick = refreshHistory;
  window.ScipOJEditor?.init();
  window.ScipOJExam?.bind();
  document.getElementById("tab-testcase")?.addEventListener("click", () => showConsoleTab("testcase"));
  document.getElementById("tab-result")?.addEventListener("click", () => showConsoleTab("result"));
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && activeProblemId) {
      e.preventDefault();
      const button = document.getElementById(e.shiftKey ? "btn-submit-formal" : "btn-grade");
      if (button && !button.disabled) button.click();
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
    if (!activeProblemId) return; // The native anchor scroll works on the course landing.
    event.preventDefault();
    if (!(await confirmLeaveIfExamDraft())) return;
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
      const index = problemIndex.findIndex(p => p.id === activeProblemId);
      const next = problemIndex[index + step];
      if (!next) return; // The hash router asks once before leaving an exam draft.
      location.hash = "#" + next.id;
    });
  }
  window.addEventListener("beforeunload", event => {
    if (window.ScipOJExam?.getPolicy() !== "standard" &&
        activeProblemId && getCodeValue().trim() !== currentTemplate.trim()) {
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
      } else {
        window.ScipOJPlatform.showJoinCourseDialog();
      }
    };
  }

  // 6. 路由与 hashchange 监听
  window.addEventListener("hashchange", () => {
    handleRouteHash();
  });
  handleRouteHash();

  // 7. 预热 Python WASM 运行环境
  if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
    window.ScipOJRuntime.ensureReady().catch((e) => {
      console.log("[App] Python WASM 预热:", e);
    });
  }

  // 8. 监听登录状态变化
  if (window.ScipOJPlatform) {
    window.ScipOJPlatform.onAuthChange(async () => {
      updateBannerCourseInfo();
      if (activeProblemId) {
        const problemId = activeProblemId;
        await refreshAssignmentMeta(problemId);
        if (activeProblemId === problemId) refreshSubmissionsList();
      } else if (document.body.dataset.learningView === "records") refreshSubmissionsList();
    });

    // 选课/退课成功后立即刷新横幅与作业门禁，无需刷新页面
    document.addEventListener("scipoj:enrollments-changed", async () => {
      updateBannerCourseInfo();
      if (activeProblemId) {
        await refreshAssignmentMeta(activeProblemId);
        await refreshSubmissionsList();
      }
    });
  }

  updateBannerCourseInfo();

  // 9. 排行榜按钮
  const btnLeaderboard = document.getElementById("btn-show-leaderboard");
  if (btnLeaderboard) {
    btnLeaderboard.onclick = () => showLeaderboardDialog();
  }

  // 10. 清空控制台按钮
  const btnClearConsole = document.getElementById("btn-clear-console");
  if (btnClearConsole) {
    btnClearConsole.onclick = () => {
      const rep = document.getElementById("report");
      if (rep) rep.textContent = "";
      showConsoleTab("result");
    };
  }
}

/** 动态更新顶部班级横幅 */
function updateBannerCourseInfo() {
  const bannerTitle = document.getElementById("banner-course-title");
  const bannerDesc = document.getElementById("banner-course-desc");
  if (!bannerTitle || !window.ScipOJPlatform) return;

  const enrollments = window.ScipOJPlatform.getEnrollments();
  if (enrollments && enrollments.length > 0) {
    const c = enrollments[0].courses;
    if (c) {
      bannerTitle.innerHTML = `🏫 当前班级：<strong>${escapeHtml(c.name || c.code)}</strong> · <code>${escapeHtml(c.code || '')}</code>`;
      bannerDesc.textContent = "已就绪：编写模型后可一键提交至服务端获取正式作业权威评分。";
      return;
    }
  }

  if (window.ScipOJPlatform.getUser()) {
    bannerTitle.textContent = "尚未选修任何教学班级";
    bannerDesc.textContent = "您当前处于自主练习模式。请输入任课教师提供的邀请码（如 REDACTED-INVITE）加入课程。";
  } else {
    bannerTitle.textContent = "加入你的教学班级";
    bannerDesc.textContent = "登录后绑定学号并加入班级，查看正式作业与提交记录。未登录可运行仿真实验和本地练习。";
  }
}

/** 处理 URL 路由 hash */
async function handleRouteHash() {
  const seq = ++routeSeq;
  const route = window.ScipOJSpaces.parseRoute(location.hash);
  if (activeProblemId && route.problemId !== activeProblemId) {
    if (!(await confirmLeaveIfExamDraft())) {
      if (seq === routeSeq) window.history.replaceState(null, "", acceptedRoute);
      return;
    }
    if (seq !== routeSeq) return;
  }
  const prob = problemIndex.find(p => p.id === route.problemId);
  if (prob) {
    window.ScipOJSpaces.activate(route);
    placeSubmissionPanel(false);
    acceptedRoute = location.hash;
    await openProblem(prob.path, prob.id);
  } else {
    closeWorkspace(false);
    // Unknown problem bookmarks recover to the question list.
    if (route.problemId) { route.view = "problems"; route.key = "problem-list-section"; }
    window.ScipOJSpaces.activate(route);
    placeSubmissionPanel(route.view === "records");
    if (route.view === "records") await refreshSubmissionsList();
    if (seq !== routeSeq) return;
    if (route.anchor) document.getElementById(route.anchor)?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }
  if (seq === routeSeq) acceptedRoute = location.hash || "#learn";
}

function placeSubmissionPanel(globalHistory) {
  const section = document.getElementById("my-submissions-section");
  const target = document.getElementById(globalHistory ? "submissions-host" : "history-tab");
  if (section && target && section.parentElement !== target) target.appendChild(section);
  const title = section?.querySelector("h3");
  if (title) title.textContent = globalHistory ? "全部正式提交" : "本题正式提交记录";
  const leaderboard = document.getElementById("btn-show-leaderboard");
  if (leaderboard) leaderboard.hidden = globalHistory;
}

function closeWorkspace(updateHash = true) {
  openSeq++;
  assignmentFetchSeq++;
  submissionsFetchSeq++;
  activeProblemId = null;
  activeAssignment = null;
  window.ScipOJExam?.activate("standard", null);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const ws = document.getElementById("workspace");
  const listSec = document.getElementById("problem-list-section");
  if (ws) ws.hidden = true;
  if (listSec) listSec.hidden = false;
  document.body.classList.remove("workbench-active");
  // 用 replaceState 避免“返回题单”在浏览器历史里不断堆叠，按后退键可正常离开
  if (updateHash) {
    acceptedRoute = "#problem-list-section";
    window.history.replaceState(null, "", acceptedRoute);
    window.ScipOJSpaces.activate(window.ScipOJSpaces.parseRoute(acceptedRoute));
    placeSubmissionPanel(false);
  }
}

/** 渲染题单大厅卡片网格 */
function renderProblemList(list) {
  const listEl = document.getElementById("problem-list");
  if (!listEl) return;

  const countEl = document.getElementById("problem-count");
  if (countEl) countEl.textContent = String(list.length).padStart(2, "0");
  if (list.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-secondary); grid-column:span 3; padding:2rem 0; text-align:center;">未找到匹配的题目。</p>`;
    return;
  }

  listEl.classList.toggle("problem-list-mode", listViewMode === "table");
  listEl.classList.toggle("problem-grid-mode", listViewMode !== "table");
  listEl.innerHTML = (listViewMode === "table" ? `<div class="problem-table-heading" role="row"><span>状态</span><span>题目</span><span>难度</span><span>标签</span><span></span></div>` : "") + list.map(p => {
    let diffClass = "difficulty-medium";
    if (p.difficulty === "简单" || p.difficulty === "Easy") diffClass = "difficulty-easy";
    else if (p.difficulty === "困难" || p.difficulty === "Hard") diffClass = "difficulty-hard";

    const tagsHtml = (p.tags || []).map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("");

    const progress = getPracticeProgress(p.id);
    const solved = progress && Number(progress.score) >= 90;
    const state = solved ? "✓" : "○";
    const difficulty = normalizeDifficulty(p.difficulty);
    const difficultyLabel = {easy:"简单",medium:"中等",hard:"困难"}[difficulty];
    if (listViewMode === "table") {
      return `<a class="problem-card problem-row" href="#${escapeHtml(p.id)}" data-id="${escapeHtml(p.id)}" data-path="${escapeHtml(p.path)}">
        <span class="problem-progress ${solved ? "solved" : ""}" aria-label="${solved ? "本地练习已通过" : "尚未通过"}">${state}</span>
        <span class="problem-row-title"><b class="problem-number">${escapeHtml(p.id)}</b><strong>${escapeHtml(p.title)}</strong></span>
        <span class="problem-row-difficulty ${diffClass}">${difficultyLabel}</span>
        <span class="problem-tags">${tagsHtml}</span>
        <span class="problem-row-arrow" aria-hidden="true">↗</span>
      </a>`;
    }
    return `<a class="problem-card" href="#${escapeHtml(p.id)}" data-id="${escapeHtml(p.id)}" data-path="${escapeHtml(p.path)}">
      <div class="problem-card-top"><span class="problem-id-tag">${escapeHtml(p.id)}</span><span class="topic-tag ${diffClass}">${difficultyLabel}</span></div>
      <div class="problem-card-title">${escapeHtml(p.title)}</div>
      <div class="problem-tags">${tagsHtml}</div>
      <div class="card-progress">${solved ? "✓ 本地练习已通过" : "○ 尚未通过"}</div>
    </a>`;
  }).join("");

  listEl.querySelectorAll("a.problem-card").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = `#${a.dataset.id}`;
      if (location.hash === target) {
        // 同一题目重复点击时 hashchange 不会触发，直接打开
        openProblem(a.dataset.path, a.dataset.id);
      } else {
        location.hash = target; // 由 hashchange 统一处理，避免重复加载
      }
    });
  });
}

let openSeq = 0;

/** 打开指定题目工作区 */
async function openProblem(path, id) {
  const seq = ++openSeq;
  activeProblemId = id;
  activeAssignment = null;
  const formalButton = document.getElementById("btn-submit-formal");
  if (formalButton) formalButton.disabled = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const ws = document.getElementById("workspace");
  const listSec = document.getElementById("problem-list-section");
  if (ws) ws.hidden = false;
  if (listSec) listSec.hidden = true;
  document.body.classList.add("workbench-active");
  updateProblemSequence();

  // 滚动至顶部
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const meta = await loadJSON(`${path}/meta.json`);
    const readme = await loadText(`${path}/README.md`);
    const template = await loadText(`${path}/template.py`);

    // 用户快速切换题目时，丢弃过期的响应
    if (seq !== openSeq || activeProblemId !== id) return;

    currentTemplate = template;
    window.ScipOJExam?.activate("standard", id);
    showWorkbenchTab("description");

    document.getElementById("title").textContent = `${meta.id} · ${meta.title || problemIndex.find(p => p.id === id)?.title || ""}`;
    const readmeHtml = window.marked ? marked.parse(readme) : `<pre>${escapeHtml(readme)}</pre>`;
    // 题面来自仓库 Markdown（可能经 PR 提交），渲染前做白名单清洗
    document.getElementById("readme").innerHTML = window.DOMPurify
      ? window.DOMPurify.sanitize(readmeHtml, { USE_PROFILES: { html: true } })
      : `<pre>${escapeHtml(readme)}</pre>`;
    let savedDraft = null;
    try { savedDraft = localStorage.getItem("scipoj:draft:" + id); } catch { /* disabled storage */ }
    setCodeValue(savedDraft === null ? currentTemplate : savedDraft);
    window.ScipOJEditor?.refresh();
    const draftStatus = document.getElementById("draft-state");
    if (draftStatus) draftStatus.textContent = savedDraft === null
      ? "初始模板 · 输入时会自动保存本地草稿"
      : "已恢复本浏览器的草稿 · 尚未正式提交";
    document.getElementById("report").textContent = "";
    document.getElementById("status").textContent = "";
    showConsoleTab("testcase");
    const sample = publicSampleInstance(meta);
    const customInput = document.getElementById("testcase-input");
    if (customInput) customInput.value = JSON.stringify(sample, null, 2);

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
        if (!ok) return;
        setCodeValue(currentTemplate);
        try { localStorage.removeItem("scipoj:draft:" + id); } catch { /* disabled storage */ }
        const draftStatus = document.getElementById("draft-state");
        if (draftStatus) draftStatus.textContent = "已重置为初始模板 · 本地草稿已清除";
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

    // 刷新作业元信息
    await refreshAssignmentMeta(id);
    if (seq !== openSeq || activeProblemId !== id) return;

    // 绑定按钮行为
    setupActionButtons(meta, id);

    // 加载提交历史
    await refreshSubmissionsList();
  } catch (err) {
    if (seq !== openSeq) return; // 已切换到其他题目，忽略本次错误
    console.error("[App] 打开题目失败:", err);
    // 不要替换 #workspace 的 innerHTML：那会永久破坏后续题目导航所需的 DOM
    const readmeEl = document.getElementById("readme");
    if (readmeEl) {
      readmeEl.innerHTML = `<p class="fail">题目加载异常: ${escapeHtml(err.message)}。请返回题单后重试。</p>`;
    }
    const titleEl = document.getElementById("title");
    if (titleEl) titleEl.textContent = `${id} · 加载失败`;
    window.ScipOJPlatform?.showToast("题目加载失败: " + (err.message || err), "error");
  }
}

/** 刷新题目与作业关联元数据（截止时间、及格线、计分规则） */
async function refreshAssignmentMeta(problemId) {
  const requestSeq = ++assignmentFetchSeq;
  const metaBar = document.getElementById("assignment-meta-bar");
  const btnSubmitFormal = document.getElementById("btn-submit-formal");
  if (!metaBar) return;

  activeAssignment = null;
  let assignment = null;
  if (window.ScipOJPlatform && window.ScipOJPlatform.isConfigured()) {
    try {
      assignment = await window.ScipOJPlatform.getAssignmentForProblem(problemId);
    } catch (e) {
      console.warn("[App] 获取作业信息失败:", e);
    }
  }

  if (requestSeq !== assignmentFetchSeq || activeProblemId !== problemId) return;
  activeAssignment = assignment;

  if (activeAssignment) {
    const dueStr = activeAssignment.due_at ? new Date(activeAssignment.due_at).toLocaleString("zh-CN") : "长期有效";
    const isLateNow = activeAssignment.due_at ? new Date() > new Date(activeAssignment.due_at) : false;

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
        <strong style="color:var(--color-pass);">${activeAssignment.pass_score ?? 90} 分</strong>
      </div>
      <div class="meta-item">
        <span>⚖️ 计分策略：</span>
        <strong>${policyMap[activeAssignment.score_policy] || activeAssignment.score_policy}</strong>
      </div>
      <div class="meta-item">
        <span>🧪 实例数量：</span>
        <strong>${activeAssignment.n_instances || 3} 个多实例平均</strong>
      </div>
    `;

    window.ScipOJExam?.activate(activeAssignment.integrity_policy || "standard", problemId);
    if (activeAssignment.integrity_policy && activeAssignment.integrity_policy !== "standard") {
      const badge = activeAssignment.integrity_policy === "exam_block" ? "考试 · 限制粘贴" : "考试 · 操作提示";
      metaBar.insertAdjacentHTML("beforeend", `<div class="meta-item"><strong class="tag-pending">${badge}</strong></div>`);
    }
    if (btnSubmitFormal) {
      btnSubmitFormal.disabled = false;
      btnSubmitFormal.title = "提交至服务端触发 PySCIPOpt 权威评测并记入正式成绩";
      btnSubmitFormal.style.opacity = "1";
    }
  } else {
    window.ScipOJExam?.activate("standard", problemId);
    const configured = !!(window.ScipOJPlatform && window.ScipOJPlatform.isConfigured());
    const loggedIn = !!(window.ScipOJPlatform && window.ScipOJPlatform.getUser());
    const enrollments = (window.ScipOJPlatform && window.ScipOJPlatform.getEnrollments()) || [];

    let hint;
    if (!configured) {
      hint = "🌿 <strong>离线练习模式</strong>：未配置后端服务，正式作业提交不可用；L1 练习评分可正常使用。";
    } else if (!loggedIn) {
      hint = "🔐 <strong>未登录</strong>：登录并绑定学号、加入班级后即可提交正式作业；当前可先进行 L1 练习。";
    } else if (enrollments.length === 0) {
      hint = "🎓 <strong>尚未加入班级</strong>：请点击右上角「选课」输入教师提供的邀请码，之后即可提交正式作业。";
    } else {
      hint = "🌿 <strong>自主练习模式</strong>：本题目当前未作为您所在班级的正式作业发布，您可在此进行 L1 练习评分与算例调试。";
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

/** 绑定评测与提交操作 */
function setupActionButtons(meta, id) {
  const btnGradeL1 = document.getElementById("btn-grade");
  const btnSubmitFormal = document.getElementById("btn-submit-formal");
  const statusEl = document.getElementById("status");
  const reportEl = document.getElementById("report");
  const btnRefreshSubmissions = document.getElementById("btn-refresh-submissions");

  // Run a single student-authored test case locally. Never count it as a formal grade.
  const btnRunCustom = document.getElementById("btn-run-testcase");
  const customInput = document.getElementById("testcase-input");
  const btnResetCustom = document.getElementById("btn-reset-testcase");
  if (btnResetCustom) btnResetCustom.onclick = () => {
    if (customInput) customInput.value = JSON.stringify(publicSampleInstance(meta), null, 2);
  };
  if (btnRunCustom) btnRunCustom.onclick = async () => {
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
    } catch (error) {
      window.ScipOJPlatform?.showToast("输入 JSON 无效: " + error.message, "warning");
      return;
    }
    showConsoleTab("result");
    btnRunCustom.disabled = true;
    reportEl.textContent = "执行自定义测试…";
    try {
      if (!window.ScipOJRuntime?.ensureReady) throw new Error("Python WASM 运行环境不可用");
      await window.ScipOJRuntime.ensureReady();
      const result = await window.ScipOJRuntime.runSolve(
        getCodeValue(), instance, Math.min(Number(meta.time_limit_sec) || 15, 30)
      );
      reportEl.textContent = JSON.stringify({ kind: "custom_test", result,
        note: "仅运行用户自定义输入；不验证最优性、不影响正式成绩。" }, null, 2);
    } catch (error) {
      reportEl.textContent = "运行错误（不计正式分）：\n" + String(error?.message || error);
    } finally {
      btnRunCustom.disabled = false;
    }
  };

  // ── L1 练习评分（浏览器 WASM 本地真跑，不写入正式数据库） ──
  btnGradeL1.onclick = async () => {
    showConsoleTab("result");
    const userCode = getCodeValue();
    const grader = meta.grader || "knapsack";
    const timeLimitSec = meta.time_limit_sec || 10;

    btnGradeL1.disabled = true;
    reportEl.textContent = "";
    statusEl.className = "status-badge";
    statusEl.innerHTML = `<span class="badge badge-running">⏳ 准备 Python WASM 环境...</span>`;

    let runtimeAvailable = false;
    if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
      try {
        await window.ScipOJRuntime.ensureReady((msg) => {
          statusEl.innerHTML = `<span class="badge badge-running">⏳ ${escapeHtml(msg)}</span>`;
        });
        runtimeAvailable = true;
      } catch (err) {
        console.warn("Python WASM 初始化降级:", err);
      }
    }

    try {
      let report;
      if (runtimeAvailable) {
        statusEl.innerHTML = `<span class="badge badge-running">⚙️ 正在执行 Python WASM 练习（超时限制 ${timeLimitSec}s）...</span>`;
        const studentSolve = async (instance) => {
          return await window.ScipOJRuntime.runSolve(userCode, instance, timeLimitSec);
        };
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(studentSolve, meta);
        } else {
          report = await window.ScipOJJudge.runL1(studentSolve, meta);
        }
        report.execution_mode = "python-wasm-student-code";
        report.execution_note = "浏览器 Python WASM 真实执行（练习自测，不写正式数据库）";
      } else {
        statusEl.innerHTML = `<span class="badge badge-queued">⚠️ 降级使用内置 Demo 评分...</span>`;
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(window.ScipOJAssignment.demoSolveAssignment, meta);
        } else {
          report = await window.ScipOJJudge.runL1(window.ScipOJJudge.demoSolve, meta);
        }
        report.execution_mode = "demo-solve-fallback";
        report.execution_note = "降级提示：浏览器 Python 运行时未能启动，此评分为内置 Demo 兜底评分。";
      }

      reportEl.textContent = JSON.stringify(report, null, 2);
      const isPass = report.passed;
      const isDemoFallback = report.execution_mode === "demo-solve-fallback";

      if (isDemoFallback) {
        // 兜底 Demo 跑的不是学生代码，绝不能显示成「练习通过」并写入练习缓存
        statusEl.innerHTML = `<span class="badge badge-queued">⚠️ 未执行你的代码 · 仅供参考的 Demo 结果（${report.score} 分）</span>`;
        window.ScipOJPlatform?.showToast(
          "Python 运行时未启动，本次显示的是内置 Demo 结果，不代表你的代码成绩；请刷新重试或改用 JupyterLab 环境。",
          "warning",
        );
      } else {
        statusEl.innerHTML = isPass
          ? `<span class="badge badge-done">✓ L1 练习通过 · ${report.score} 分</span>`
          : `<span class="badge badge-system_error">✗ L1 练习未通过 · ${report.score} 分</span>`;

        // 仅存 localStorage 作为练习缓存，不写正式库
        try { localStorage.setItem("scip-oj-practice:" + id, JSON.stringify({ score: report.score, at: Date.now() })); } catch { /* private browsing */ }
        window.ScipOJPlatform?.showToast(isPass ? `L1 练习通过：${report.score} 分` : `L1 练习未及格：${report.score} 分`, isPass ? "success" : "warning");
      }
    } catch (e) {
      statusEl.innerHTML = `<span class="badge badge-system_error">评测异常</span>`;
      reportEl.textContent = "执行异常:\n" + String(e?.stack || e?.message || e);
      window.ScipOJPlatform?.showToast("L1 练习执行异常: " + (e?.message || e), "error");
    } finally {
      btnGradeL1.disabled = false;
    }
  };

  // ── 提交正式作业（服务端权威评测 + Actions） ──
  btnSubmitFormal.onclick = async () => {
    if (!window.ScipOJPlatform || !window.ScipOJPlatform.isConfigured()) {
      window.ScipOJPlatform?.showToast("离线练习模式：未配置 Supabase 服务端，暂不支持在线提交正式作业；请使用「⚡ L1 练习评分」自测。", "warning");
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

    if (!activeAssignment) {
      const enrollments = window.ScipOJPlatform.getEnrollments();
      if (enrollments.length === 0) {
        window.ScipOJPlatform.showJoinCourseDialog({ forced: true });
      } else {
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

    btnSubmitFormal.disabled = true;
    statusEl.innerHTML = `<span class="badge badge-running">🚀 正在向服务端提交作业代码...</span>`;

    try {
      const res = await window.ScipOJPlatform.submitAssignment(activeAssignment.id, userCode, window.ScipOJExam?.snapshot());
      const codeStr = res.public_code || res.submission_id;
      const isSystemError = res.status === "system_error";

      if (isSystemError) {
        statusEl.innerHTML = `<span class="badge badge-system_error">⚠️ 已保存提交，但评测调度失败 (${codeStr})</span>`;
        window.ScipOJPlatform.showToast("提交已保存，但评测任务调度失败（系统故障，不计 0 分），请联系教师重试。", "error");
      } else {
        statusEl.innerHTML = `<span class="badge badge-queued">⏳ 已进入评测队列 (${codeStr})</span>`;
        window.ScipOJPlatform.showToast(`作业提交成功！编号 ${codeStr}，已进入评测队列`, "success");
      }

      if (res.warning && !isSystemError) {
        window.ScipOJPlatform.showToast(res.warning, "warning");
      }

      await refreshSubmissionsList();
      // Mock 模式不会在数据库里生成 grading 记录，轮询只会空转到超时
      const isMock = !!window.ScipOJPlatform.isMockMode?.();
      if (!isSystemError && !isMock) startSubmissionsPolling();
      else if (isMock) {
        window.ScipOJPlatform.showToast("Mock 模式仅用于本地联调，不会写入评测记录", "info");
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="badge badge-system_error">❌ 提交失败</span>`;
      window.ScipOJPlatform.showToast("提交失败: " + err.message, "error");
    } finally {
      btnSubmitFormal.disabled = false;
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
}

/** 刷新学生在该题目的提交历史记录 */
async function refreshSubmissionsList() {
  const requestSeq = ++submissionsFetchSeq;
  const context = `${activeProblemId || ""}|${activeAssignment?.id || ""}|${document.body.dataset.learningView}`;
  const globalHistory = document.body.dataset.learningView === "records";
  const container = document.getElementById("my-submissions-container");
  if (!container) return;

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
    if (link) link.onclick = () => window.ScipOJPlatform.showLoginDialog();
    return;
  }

  container.innerHTML = `<p style="color:var(--text-secondary); padding:1rem;">正在加载历史提交记录...</p>`;

  try {
    if (!globalHistory && activeProblemId && !activeAssignment?.id) {
      container.innerHTML = '<p class="history-empty">当前题目没有可用的正式作业。可继续本地练习，或进入「提交记录」查看其他作业。</p>';
      return;
    }
    const assignmentId = globalHistory ? null : activeAssignment?.id || null;
    const submissions = await window.ScipOJPlatform.getMySubmissions(assignmentId);
    if (requestSeq !== submissionsFetchSeq || context !== `${activeProblemId || ""}|${activeAssignment?.id || ""}|${document.body.dataset.learningView}`) return;

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

    if (hasPending && !pollTimer) {
      startSubmissionsPolling();
    } else if (!hasPending && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (err) {
    if (requestSeq !== submissionsFetchSeq) return;
    container.innerHTML = `<p class="fail" style="padding:1rem;">加载提交记录异常: ${escapeHtml(err.message)}</p>`;
  }
}

async function refreshHistory() {
  const button = document.getElementById("btn-refresh-submissions");
  button.disabled = true;
  button.textContent = "刷新中…";
  try { await refreshSubmissionsList(); }
  finally { button.disabled = false; button.textContent = "刷新记录"; }
}

/** 渲染正式提交记录表格 */
function renderSubmissionsTable(container, list) {
  const globalHistory = document.body.dataset.learningView === "records";
  const table = document.createElement("table");
  table.className = "submissions-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>提交编号</th>
        ${globalHistory ? '<th>题目 / 班级</th>' : ''}
        <th>轮次</th>
        <th>评测状态</th>
        <th>得分</th>
        <th>判定</th>
        <th>提交时间</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${list.map((sub, idx) => {
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
          statusBadge = '<span class="badge badge-done">✓ 已完成</span>';
        } else if (status === "system_error") {
          statusBadge = '<span class="badge badge-system_error" title="系统环境故障，不扣除学生分数">⚠️ 系统故障</span>';
        }

        let scoreDisplay = "-";
        if (status === "done") {
          scoreDisplay = score != null
            ? `<strong class="${passed ? 'pass' : 'fail'}">${score} 分</strong>`
            : '<span style="color:var(--text-secondary);">未出分</span>';
        } else if (status === "system_error") {
          scoreDisplay = '<span style="color:var(--text-secondary);" title="系统错误不计0分">未出分 (系统故障)</span>';
        }

        let passDisplay = "-";
        if (status === "done") {
          passDisplay = passed ? '<span class="tag-normal">✓ 通过</span>' : '<span class="tag-late">✗ 未通过</span>';
        } else if (status === "system_error") {
          passDisplay = '<span class="tag-pending">等待重试</span>';
        }

        const isLate = sub.metadata?.late;
        const timeStr = sub.created_at ? new Date(sub.created_at).toLocaleString("zh-CN") : "-";
        const assignment = Array.isArray(sub.assignments) ? sub.assignments[0] : sub.assignments;
        const course = Array.isArray(assignment?.courses) ? assignment.courses[0] : assignment?.courses;
        const problemId = assignment?.problem_id;
        const problemLabel = problemId
          ? `${problemId} · ${problemIndex.find(p => p.id === problemId)?.title || '编程作业'}`
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
      showReportDialog(sub);
    };
  });
}

/** 弹出提交详情与报告 */
function showReportDialog(sub) {
  const grading = Array.isArray(sub.gradings) ? sub.gradings[0] : sub.gradings;
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
          <div>提交时间: <strong>${new Date(sub.created_at).toLocaleString("zh-CN")}</strong></div>
          <div>轮次: <strong>第 ${sub.attempt_no || 1} 次</strong></div>
          <div>状态: <strong>${grading?.status || 'queued'}</strong></div>
          <div>得分: <strong class="${grading?.passed ? 'pass' : 'fail'}">${grading?.score != null ? grading.score + ' 分' : '未出分'}</strong></div>
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
  dialog.onclick = (e) => { if (e.target === dialog) close(); };
  window.ScipOJPlatform.openModal(dialog);
}

/** 智能轮询评测状态 */
function startSubmissionsPolling() {
  if (pollTimer) clearInterval(pollTimer);
  let pollCount = 0;

  pollTimer = setInterval(async () => {
    // 用户已返回题单或切换题目时停止轮询
    if (document.getElementById("workspace")?.hidden && document.getElementById("submission-overview")?.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    pollCount++;
    if (pollCount > 30) {
      clearInterval(pollTimer);
      pollTimer = null;
      window.ScipOJPlatform?.showToast("评测仍在进行中，已停止自动刷新；可点击「刷新记录」查看最新状态。", "info");
      return;
    }
    await refreshSubmissionsList();
  }, 3000);
}

/** 弹出脱敏课程排行榜（仅本课程师生可见） */
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
        <h3>🏆 课程排行榜 · <code>${escapeHtml(activeProblemId || '全部题目')}</code></h3>
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
  dialog.onclick = (e) => { if (e.target === dialog) close(); };
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
    const rows = await window.ScipOJPlatform.getLeaderboard(courseId, activeProblemId || null, 50);

    if (!rows.length) {
      bodyEl.innerHTML = `<p style="color:var(--text-secondary); padding:1rem;">${activeProblemId ? "本题目暂无已出分的提交记录。" : "本课程暂无已出分的提交记录。"}</p>`;
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
            if (i === 0) rankBadge = '🥇 1';
            else if (i === 1) rankBadge = '🥈 2';
            else if (i === 2) rankBadge = '🥉 3';

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
  } catch (err) {
    const msg = err?.message || String(err);
    if (err?.missingRpc || window.ScipOJPlatform?.isMissingRpcError?.(err) ||
        /does not exist|schema cache|42P01|PGRST205|permission denied|could not find the function/i.test(msg)) {
      bodyEl.innerHTML = '<p class="fail" style="padding:1rem;">排行榜服务尚未部署（缺少 <code>get_course_leaderboard</code> 函数）。请联系管理员执行 <code>supabase/migrations/006_security_hardening_and_leaderboard.sql</code> 后重试。</p>';
    } else {
      bodyEl.innerHTML = `<p class="fail" style="padding:1rem;">获取榜单异常: ${escapeHtml(msg)}</p>`;
    }
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
  if (el) el.innerHTML = `<p class="fail">主应用启动异常: ${escapeHtml(err.message || String(err))}</p>`;
});
