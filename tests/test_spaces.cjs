"use strict";
const assert = require("node:assert/strict");
const { parseRoute, activate } = require("../site/js/spaces.js");

for (const hash of ["", "#learn", "#unrecognized", "#<script>"]) {
  assert.equal(parseRoute(hash).space, "learn");
  assert.equal(parseRoute(hash).view, "overview");
}
assert.equal(parseRoute("#course").space, "course");
assert.equal(parseRoute("#course-cases").anchor, "course-case-list");
assert.equal(parseRoute("#course-assessments").anchor, "course-assessments");
assert.equal(parseRoute("#list").view, "problems", "Preserve old question-list bookmarks");
assert.equal(parseRoute("#P001").problemId, "P001", "Preserve old problem bookmarks");
assert.equal(parseRoute("#submissions").view, "records");

function element(data = {}) {
  return { hidden: false, dataset: data, attrs: {}, classes: new Set(),
    setAttribute(k,v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    get classList() { return { toggle: (name, yes) => yes ? this.classes.add(name) : this.classes.delete(name) }; }
  };
}
const ids = Object.fromEntries(["course-space","learning-space","nav-course-space","nav-learning-space"].map(id => [id,element()]));
const panels = ["overview","problems","records"].map(view => element({ learningViewPanel: view }));
const navs = ["course","learn"].map(space => element({ spaceNav: space }));
const links = ["course","course-cases","learn","problem-list-section","submissions"].map(route => element({ route }));
const doc = { body: { dataset: {} }, getElementById: id => ids[id],
  querySelectorAll: selector => ({ "[data-learning-view-panel]":panels,"[data-space-nav]":navs,"[data-route]":links })[selector]
};
for (const hash of ["#course", "#learn", "#P002", "#submissions", "#course-cases", "#list"]) {
  const route = parseRoute(hash); activate(route,doc);
  assert.notEqual(ids["course-space"].hidden,ids["learning-space"].hidden,"Exactly one top-level space is visible");
  assert.equal(ids["course-space"].hidden,route.space !== "course");
  assert.equal(Object.values(ids).filter(node => node.attrs["aria-current"] === "page").length,1,"Exactly one top tab has an accessible current state");
  assert.equal(navs.filter(nav => !nav.hidden).length,1,"Sidebar follows the selected space");
  assert.equal(panels.filter(panel => !panel.hidden).length,route.view === "problem" ? 0 : 1,
    "Task overview, question list and submission history cannot overlap");
}
console.log("Course/learning routes, legacy bookmarks, exclusive panels and accessible navigation: PASS");
