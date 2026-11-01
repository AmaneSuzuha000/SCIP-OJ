"use strict";
const assert = require("node:assert/strict");
const {parseRoute, resolveContext} = require("../site/js/navigation.js");

const course = resolveContext("https://navigation.invalid/doc.html?path=docs/课程学习路径.md");
assert.equal(course.space, "course");
assert.equal(course.page, "learning-path");
const learn = resolveContext("https://navigation.invalid/doc.html?path=docs/课程学习路径.md&space=learn");
assert.equal(learn.space, "learn");
assert.equal(learn.page, "learning-path");
assert.equal(resolveContext("https://navigation.invalid/doc.html?path=docs/教师指南.md").page, "teacher-guide");
for (const file of [
  "07_IE_Transportation_PySCIPOpt.ipynb",
  "08_IE_Cutting_Stock_PySCIPOpt.ipynb",
  "09_IE_TSP_MTZ_PySCIPOpt.ipynb",
  "10_IE_CVRP_PySCIPOpt.ipynb",
  "11_IE_Single_Machine_PySCIPOpt.ipynb",
]) {
  const route = parseRoute("#notebook/" + file);
  assert.equal(route.space, "learn", file);
  assert.equal(route.view, "notebook", file);
}
assert.equal(parseRoute("#notebook/01_P001_knapsack_PySCIPOpt.ipynb").space, "course");
console.log("Learning path document route and five extension notebooks: PASS");
