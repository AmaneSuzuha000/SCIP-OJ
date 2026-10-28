/* View state only. Authentication, submissions and grades remain in the platform layer. */
(function (root) {
  "use strict";
  const notebooks = [
    ['01_P001_knapsack_PySCIPOpt.ipynb','0-1 背包问题','course'],
    ['02_P002_assignment_PySCIPOpt.ipynb','指派问题','course'],
    ['03_IE_Facility_Location_PySCIPOpt.ipynb','容量约束设施选址','learn'],
    ['04_IE_Bin_Packing_PySCIPOpt.ipynb','仓储装箱','learn'],
    ['05_IE_Flow_Shop_PySCIPOpt.ipynb','排列流水车间','learn'],
    ['06_IE_Stochastic_Inventory_PySCIPOpt.ipynb','单周期随机库存优化','learn'],
  ].map(([path,title,space])=>({path,title,space}));
  function parseRoute(hash) {
    const key = String(hash || "").replace(/^#/, "");
    if (key.startsWith('notebook/')) {
      let path;try {path=decodeURIComponent(key.slice(9));} catch {path='';}
      const notebook=notebooks.find(item=>item.path===path);
      if (notebook) return {space:notebook.space,view:'notebook',key,notebook,anchor:null};
    }
    if (["course", "course-labs", "course-assessments"].includes(key)) {
      return { space: "course", view: "overview", key,
        anchor: key === "course-labs" ? "course-lab-list" : key === "course-assessments" ? "course-assessments" : null };
    }
    if (["problem-list-section", "list"].includes(key)) return { space: "course", view: "problems", key: "problem-list-section", anchor: null };
    if (key === "submissions") return { space: "course", view: "records", key, anchor: null };
    if (/^[A-Z][A-Z0-9_-]{0,31}$/.test(key)) return { space: "course", view: "problem", key, problemId: key, anchor: null };
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
    const selectedKey = route.view === 'notebook' ? (route.space==='course'?'course-labs':'learn-notebooks') : route.view === "problem" ? "problem-list-section" : route.key;
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
