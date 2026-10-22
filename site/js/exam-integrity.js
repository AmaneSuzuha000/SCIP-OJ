/**
 * Exam-mode UX: deterrence and SELF-REPORTED indicators, not authoritative proctoring.
 * Browsers cannot ensure authorship or prevent DevTools/automation. No clipboard
 * contents, keypresses, screenshots, audio or private browsing data are collected.
 */
(() => {
  const supported = new Set(["standard", "exam_warn", "exam_block"]);
  let policy = "standard";
  let problemId = null;
  let startedAt = null;
  let inputEvents = 0, pasteEvents = 0, blockedPastes = 0, copyEvents = 0;
  let dropEvents = 0, hiddenEvents = 0;
  let bound = false, lastWarningAt = 0;

  function notify(text) {
    if (Date.now() - lastWarningAt < 2000) return;
    lastWarningAt = Date.now();
    window.ScipOJPlatform?.showToast(text, "warning");
  }

  function activate(nextPolicy, nextProblemId) {
    const wanted = supported.has(nextPolicy) ? nextPolicy : "standard";
    if (wanted !== policy || nextProblemId !== problemId) {
      policy = wanted;
      problemId = nextProblemId;
      startedAt = Date.now();
      inputEvents = pasteEvents = blockedPastes = copyEvents = dropEvents = hiddenEvents = 0;
    }
    const notice = document.getElementById("exam-notice");
    const copyBtn = document.getElementById("btn-copy-template");
    if (notice) {
      notice.hidden = policy === "standard";
      notice.textContent = policy === "exam_block"
        ? "考试模式 · 编辑区已尝试限制复制、剪切、粘贴和拖放。只记录操作次数，不读取剪贴板内容；浏览器限制不能替代教师核查。"
        : "考试模式 · 允许粘贴，但会向教师提供浏览器自报的操作计数（非作弊证据）。";
      notice.className = "exam-notice " + policy;
    }
    if (copyBtn) copyBtn.disabled = policy === "exam_block";
  }

  function isEditorEvent(event) {
    const input = window.ScipOJEditor?.getInputElement();
    const original = document.getElementById("code");
    return !!(input?.contains(event.target) || original?.contains(event.target));
  }
  function recordClipboard(event) {
    if (policy === "standard" || !isEditorEvent(event)) return;
    const type = event.type;
    if (type === "paste") pasteEvents += 1;
    if (type === "copy" || type === "cut") copyEvents += 1;
    if (type === "drop") dropEvents += 1;
    if (policy === "exam_block") {
      event.preventDefault();
      event.stopPropagation();
      if (type === "paste" || type === "drop") blockedPastes += 1;
      notify("考试模式不允许通过剪贴板或拖放输入代码，请手动编写。");
    } else if (type === "paste") {
      notify("已记录一次粘贴操作（仅供教师人工复核，不自动认定作弊）。");
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    for (const event of ["paste", "copy", "cut", "drop"]) {
      document.addEventListener(event, recordClipboard, true);
    }
    document.addEventListener("beforeinput", event => {
      if (policy !== "exam_block" || !isEditorEvent(event)) return;
      if (["insertFromPaste", "insertFromDrop"].includes(event.inputType)) {
        event.preventDefault();
      }
    }, true);
    document.getElementById("code")?.addEventListener("input", () => {
      if (policy !== "standard") inputEvents += 1;
    });
    document.addEventListener("visibilitychange", () => {
      if (policy !== "standard" && document.hidden) hiddenEvents += 1;
    });
  }

  function snapshot() {
    // Policy comes from the database, not this client-provided snapshot.
    // This payload can be forged; treat it as an untrusted signal for manual review.
    return {
      schema_version: 1,
      reported_policy: policy,
      problem_id: problemId,
      client_started_at: startedAt ? new Date(startedAt).toISOString() : null,
      elapsed_seconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
      input_events: inputEvents,
      paste_events: pasteEvents,
      blocked_pastes: blockedPastes,
      copy_events: copyEvents,
      drop_events: dropEvents,
      hidden_events: hiddenEvents,
    };
  }

  window.ScipOJExam = { bind, activate, snapshot };
})();