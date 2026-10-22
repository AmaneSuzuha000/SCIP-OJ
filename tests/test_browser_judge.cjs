"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function load(path, name) {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window[name];
}

async function check() {
  const k = load("site/js/knapsack_judge.js", "ScipOJJudge");
  const a = load("site/js/assignment_judge.js", "ScipOJAssignment");
  const kMeta = { id: "P001", n_instances_l1: 1, seed_base: 20261021,
    pass_score: 90, weights: { F: 10, C: 35, I: 10, O: 45 } };
  const aMeta = { id: "P002", n_instances_l1: 1, seed_base: 20261022,
    pass_score: 90, weights: { F: 10, C: 35, I: 10, O: 45 } };
  const ki = k.genKnapsack(20261021);
  const ai = a.genAssignment(20261022);
  assert.equal(k.gradeKnapsack(k.demoSolve(ki), ki, kMeta).score, 100);
  assert.equal(a.gradeAssignment(a.demoSolveAssignment(ai), ai, aMeta).score, 100);

  for (const bad of [NaN, Infinity, -Infinity, "nan", "Infinity"]) {
    assert.equal(k.gradeKnapsack({ objective: bad, solution: Array(ki.n).fill(0) },
      ki, kMeta).score, 0);
    assert.equal(a.gradeAssignment({ objective: bad,
      solution: Array.from({ length: ai.n }, (_, i) =>
        Array.from({ length: ai.n }, (_, j) => +(i === j))) }, ai, aMeta).score, 0);
  }

  const ks = k.demoSolve(ki);
  ks.solution[0] = NaN;
  assert.equal(k.gradeKnapsack(ks, ki, kMeta).score, 0);
  const as = a.demoSolveAssignment(ai);
  as.solution[0][0] = NaN;
  assert.equal(a.gradeAssignment(as, ai, aMeta).score, 0);
  assert.equal(k.gradeKnapsack({ ...k.demoSolve(ki), solution: [1] }, ki, kMeta).score, 0);
  assert.equal(a.gradeAssignment({ ...a.demoSolveAssignment(ai),
    solution: [[1]] }, ai, aMeta).score, 0);

  const kReport = await k.runL1(async (inst) => {
    assert.equal(Object.hasOwn(inst, "optimal_value"), false);
    const result = k.demoSolve(inst);
    inst.weights.fill(0);
    return result;
  }, kMeta);
  assert.equal(kReport.score, 100);

  const aReport = await a.runL1Assignment(async (inst) => {
    assert.equal(Object.hasOwn(inst, "optimal_value"), false);
    const result = a.demoSolveAssignment(inst);
    inst.costs[0].fill(0);
    return result;
  }, aMeta);
  assert.equal(aReport.score, 100);
  console.log("Browser judge regression tests passed");
}

check().catch(e => { console.error(e); process.exitCode = 1; });
