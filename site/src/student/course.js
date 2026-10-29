import {state} from './state.js';
import {normalizeDifficulty,getPracticeProgress,escapeHtml} from './shared.js';
import {contextHash} from './context.js';
export function applyProblemFilters() {
    const query = (document.getElementById("problem-search-input")?.value || "").trim().toLowerCase();
    const difficulty = document.getElementById("filter-difficulty")?.value || "all";
    const progress = document.getElementById("filter-progress")?.value || "all";
    const filtered = state.problemIndex.filter(p => {
        if (state.contextError || state.courseMode==='choose') return false;
        if (state.courseId && !state.courseAssignments.some(a=>a.problem_id===p.id)) return false;
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
    const bannerAction = document.getElementById("banner-course-action");
    if (!bannerTitle || !window.ScipOJPlatform)
        return;
    const enrollments = window.ScipOJPlatform.getEnrollments();
    const showJoin = !enrollments.length && state.courseMode !== 'choose';
    if (bannerAction) bannerAction.hidden = !showJoin;
    if (state.courseId) {
        const c = enrollments.find(e=>e.course_id===state.courseId)?.courses;
        if (c) {
            bannerTitle.innerHTML = `当前班级：<strong>${escapeHtml(c.name || c.code)}</strong> · <code>${escapeHtml(c.code || '')}</code>`;
            bannerDesc.textContent = "已在这个班级中。正式作业从「课程作业」进入；再加入其他班级请用账号菜单里的「加入课程」。";
            return;
        }
    }
    if (state.courseMode==='choose') {
        bannerTitle.textContent='请选择当前教学班级';
        bannerDesc.textContent='您加入了多个班级，请在上方选择本次作业所属的班级。';
    } else if (enrollments.length) {
        bannerTitle.textContent='自主练习';
        bannerDesc.textContent='本地练习不计入正式成绩。要做作业时，在上方选择已经加入的教学班级。';
    } else if (window.ScipOJPlatform.getUser()) {
        bannerTitle.textContent = "尚未加入教学班级";
        bannerDesc.textContent = "当前是自主练习。正式作业需要从账号菜单打开「加入课程」，填写教师给的邀请码。";
    }
    else {
        bannerTitle.textContent = "加入你的教学班级";
        bannerDesc.textContent = "登录后在账号菜单填写个人资料和「加入课程」。也可以先做建模和本地练习。";
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
        const empty = state.contextError || (state.courseMode==='choose'?'请先选择教学班级，或选择自主练习。':state.courseId&&!state.courseAssignments.length?'该班级尚未发布课程作业。':'未找到匹配的题目。');
        listEl.innerHTML = `<div class="ui-empty"><p>${escapeHtml(empty)}</p></div>`;
        return;
    }
    listEl.classList.toggle("problem-list-mode", state.listViewMode === "table");
    listEl.classList.toggle("problem-grid-mode", state.listViewMode !== "table");
    listEl.innerHTML = (state.listViewMode === "table" ? `<div class="problem-table-heading" role="row"><span>本地练习</span><span>题目</span><span>难度</span><span>标签</span><span></span></div>` : "") + list.map(p => {
        let diffClass = "difficulty-medium";
        if (p.difficulty === "简单" || p.difficulty === "Easy")
            diffClass = "difficulty-easy";
        else if (p.difficulty === "困难" || p.difficulty === "Hard")
            diffClass = "difficulty-hard";
        const tagsHtml = (p.tags || []).map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("");
        const progress = getPracticeProgress(p.id);
        const solved = progress && Number(progress.score) >= 90;
        const practiceBadge = solved
            ? '<span class="ui-badge ui-badge--practice">本地练习通过</span>'
            : '<span class="ui-badge">尚未练习通过</span>';
        const difficulty = normalizeDifficulty(p.difficulty);
        const difficultyLabel = { easy: "简单", medium: "中等", hard: "困难" }[difficulty];
        const assignment=state.courseAssignments.find(a=>a.problem_id===p.id);
        const href=window.ScipOJNavigation.withParams(contextHash('#'+p.id),{assignment:assignment?.id});
        if (state.listViewMode === "table") {
            return `<a class="problem-card problem-row" href="${escapeHtml(href)}" data-id="${escapeHtml(p.id)}" data-path="${escapeHtml(p.path)}">
        <span class="problem-progress ${solved ? "solved" : ""}">${practiceBadge}</span>
        <span class="problem-row-title"><b class="problem-number">${escapeHtml(p.id)}</b><strong>${escapeHtml(p.title)}</strong></span>
        <span class="problem-row-difficulty ${diffClass}">${difficultyLabel}</span>
        <span class="problem-tags">${tagsHtml}</span>
        <span class="problem-row-arrow" aria-hidden="true">↗</span>
      </a>`;
        }
        return `<a class="problem-card" href="${escapeHtml(href)}" data-id="${escapeHtml(p.id)}" data-path="${escapeHtml(p.path)}">
      <div class="problem-card-top"><span class="problem-id-tag">${escapeHtml(p.id)}</span><span class="topic-tag ${diffClass}">${difficultyLabel}</span></div>
      <div class="problem-card-title">${escapeHtml(p.title)}</div>
      <div class="problem-tags">${tagsHtml}</div>
      <div class="card-progress">${practiceBadge}<span class="ui-badge">不计正式成绩</span></div>
    </a>`;
    }).join("");
}
