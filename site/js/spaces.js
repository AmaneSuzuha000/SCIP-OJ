/* View state only. Authentication, submissions and grades remain in the platform layer. */
(function (root) {
  "use strict";
  const navigation = typeof module !== 'undefined' && module.exports ? require('./navigation.js') : root.ScipOJNavigation;
  const {notebooks, parseRoute} = navigation;

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
    const selectedKey = navigation.sectionForRoute(route);
    for (const link of doc.querySelectorAll("[data-route]")) {
      const selected = link.dataset.route === selectedKey;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    doc.title = route.space === "course" ? "课程教学 · SCIP/LAB" : "拓展学习 · SCIP/LAB";
  }
  const api = { parseRoute, activate, notebooks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.ScipOJSpaces = api; activate(parseRoute(root.location.hash)); }
})(typeof window === "undefined" ? {} : window);
