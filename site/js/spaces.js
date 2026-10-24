/* View state only. Authentication, submissions and grades remain in the platform layer. */
(function (root) {
  "use strict";
  function parseRoute(hash) {
    const key = String(hash || "").replace(/^#/, "");
    if (["course", "course-labs", "course-assessments"].includes(key)) {
      return { space: "course", view: "overview", key,
        anchor: key === "course-labs" ? "course-lab-list" : key === "course-assessments" ? "course-assessments" : null };
    }
    if (["problem-list-section", "list"].includes(key)) return { space: "course", view: "problems", key: "problem-list-section", anchor: null };
    if (key === "submissions") return { space: "course", view: "records", key, anchor: null };
    if (/^P\d+$/.test(key)) return { space: "course", view: "problem", key, problemId: key, anchor: null };
    if (["learn", "case-library", "learn-notebooks", "course-cases"].includes(key)) {
      const canonical = key === "course-cases" ? "case-library" : key;
      return { space: "learn", view: "overview", key: canonical, anchor: canonical === "learn" ? null : canonical };
    }
    return { space: "course", view: "overview", key: "course", anchor: null };
  }

  function activate(route, doc = root.document) {
    if (!doc) return;
    doc.body.dataset.space = route.space;
    doc.body.dataset.teachingView = route.space === "course" ? route.view : "";
    doc.getElementById("course-space").hidden = route.space !== "course";
    doc.getElementById("learning-space").hidden = route.space !== "learn";
    for (const panel of doc.querySelectorAll("[data-teaching-view-panel]")) panel.hidden = route.space !== "course" || panel.dataset.teachingViewPanel !== route.view;
    for (const nav of doc.querySelectorAll("[data-space-nav]")) nav.hidden = nav.dataset.spaceNav !== route.space;
    for (const content of doc.querySelectorAll("[data-space-content]")) content.hidden = content.dataset.spaceContent !== route.space;
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
    doc.title = route.space === "course" ? "课程教学 · SCIP/LAB" : "拓展学习 · SCIP/LAB";
  }
  const api = { parseRoute, activate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.ScipOJSpaces = api; activate(parseRoute(root.location.hash)); }
})(typeof window === "undefined" ? {} : window);
