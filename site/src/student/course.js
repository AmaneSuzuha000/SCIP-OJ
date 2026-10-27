import {state} from './state.js';
import {normalizeDifficulty,getPracticeProgress,escapeHtml} from './shared.js';
import {openProblem} from './workbench.js';
export function applyProblemFilters() {
    const query = (document.getElementById("problem-search-input")?.value || "").trim().toLowerCase();
    const difficulty = document.getElementById("filter-difficulty")?.value || "all";
    const progress = document.getElementById("filter-progress")?.value || "all";
    const filtered = state.problemIndex.filter(p => {
        const searchable = [p.id, p.title, p.difficulty, ...(p.tags || [])].join(" ").toLowerCase();
        if (query && !searchable.includes(query))
            return false;
        if (difficulty !== "all" && normalizeDifficulty(p.difficulty) !== difficulty)
            return false;
        const solved = !!getPracticeProgress(p.id)?.score && getPracticeProgress(p.id).score >= 90;
        return progress === "all" || (progress === "solved" ? solved : !solved);
    });
    renderProblemList(filtered);
}
export /** 动态更新顶部班级横幅 */
function updateBannerCourseInfo() {
    const bannerTitle = document.getElementById("banner-course-title");
    const bannerDesc = document.getElementById("banner-course-desc");
    if (!bannerTitle || !window.ScipOJPlatform)
        return;
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
    }
    else {
        bannerTitle.textContent = "加入你的教学班级";
        bannerDesc.textContent = "登录后绑定学号并加入班级，查看正式作业与提交记录。也可先进行建模与本地练习。";
    }
}
export /** 渲染题单大厅卡片网格 */
function renderProblemList(list) {
    const listEl = document.getElementById("problem-list");
    if (!listEl)
        return;
    const countEl = document.getElementById("problem-count");
    if (countEl)
        countEl.textContent = String(list.length).padStart(2, "0");
    if (list.length === 0) {
        listEl.innerHTML = `<p style="color:var(--text-secondary); grid-column:span 3; padding:2rem 0; text-align:center;">未找到匹配的题目。</p>`;
        return;
    }
    listEl.classList.toggle("problem-list-mode", state.listViewMode === "table");
    listEl.classList.toggle("problem-grid-mode", state.listViewMode !== "table");
    listEl.innerHTML = (state.listViewMode === "table" ? `<div class="problem-table-heading" role="row"><span>状态</span><span>题目</span><span>难度</span><span>标签</span><span></span></div>` : "") + list.map(p => {
        let diffClass = "difficulty-medium";
        if (p.difficulty === "简单" || p.difficulty === "Easy")
            diffClass = "difficulty-easy";
        else if (p.difficulty === "困难" || p.difficulty === "Hard")
            diffClass = "difficulty-hard";
        const tagsHtml = (p.tags || []).map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("");
        const progress = getPracticeProgress(p.id);
        const solved = progress && Number(progress.score) >= 90;
        const state = solved ? "✓" : "○";
        const difficulty = normalizeDifficulty(p.difficulty);
        const difficultyLabel = { easy: "简单", medium: "中等", hard: "困难" }[difficulty];
        if (state.listViewMode === "table") {
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
            }
            else {
                location.hash = target; // 由 hashchange 统一处理，避免重复加载
            }
        });
    });
}