/* View state only. Authentication, submissions and grades remain in the platform layer. */
(function (root) {
  "use strict";
  function parseRoute(hash) {
    const key = String(hash || "").replace(/^#/, "");
    if (["course", "course-cases", "course-assessments"].includes(key)) {
      return { space: "course", view: "overview", key,
        anchor: key === "course-cases" ? "course-case-list" : key === "course-assessments" ? "course-assessments" : null };
    }
    if (["problem-list-section", "list"].includes(key)) return { space: "learn", view: "problems", key: "problem-list-section", anchor: null };
    if (key === "submissions") return { space: "learn", view: "records", key, anchor: null };
    if (/^P\d+$/.test(key)) return { space: "learn", view: "problem", key, problemId: key, anchor: null };
    return { space: "learn", view: "overview", key: key === "case-library" ? key : "learn", anchor: key === "case-library" ? "case-library" : null };
  }

  function activate(route, doc = root.document) {
    if (!doc) return;
    doc.body.dataset.space = route.space;
    doc.body.dataset.learningView = route.view;
    doc.getElementById("course-space").hidden = route.space !== "course";
    doc.getElementById("learning-space").hidden = route.space !== "learn";
    for (const panel of doc.querySelectorAll("[data-learning-view-panel]")) panel.hidden = panel.dataset.learningViewPanel !== route.view;
    for (const nav of doc.querySelectorAll("[data-space-nav]")) nav.hidden = nav.dataset.spaceNav !== route.space;
    for (const [id, space] of [["nav-course-space", "course"], ["nav-learning-space", "learn"]]) {
      const link = doc.getElementById(id), selected = route.space === space;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    const selectedKey = route.view === "problem" ? "problem-list-section" : route.key;
    for (const link of doc.querySelectorAll("[data-route]")) {
      const selected = link.dataset.route === selectedKey;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    doc.title = route.space === "course" ? "课程空间 · SCIP/LAB" : "学习工作台 · SCIP/LAB";
  }
  const api = { parseRoute, activate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.ScipOJSpaces = api; activate(parseRoute(root.location.hash)); }
})(typeof window === "undefined" ? {} : window);
