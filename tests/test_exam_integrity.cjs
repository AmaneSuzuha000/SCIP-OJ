"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const listeners = new Map();
const notice = { hidden: true, textContent: "", className: "" };
const copy = { disabled: false };
const editorTarget = { id: "input" };
const editor = { contains: node => node === editorTarget };
const input = { addEventListener(type, fn) { listeners.set("input:" + type, fn); }, contains: node => node === editorTarget };
const document = {
  hidden: false,
  addEventListener(type, fn) { listeners.set(type, fn); },
  getElementById(id) { return { "exam-notice": notice, "btn-copy-template": copy, "code": input }[id] ?? null; },
};
const context = vm.createContext({
  window: { ScipOJEditor: { getInputElement: () => editor } },
  document, Date, Set,
});
vm.runInContext(fs.readFileSync("site/js/exam-integrity.js", "utf8"), context);
const module = context.window.ScipOJExam;
module.bind();
module.activate("standard", "P001");
let prevented = false;
listeners.get("paste")({ type: "paste", target: editorTarget, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, false);
module.activate("exam_block", "P001");
assert.equal(notice.hidden, false);
assert.equal(copy.disabled, true);
listeners.get("paste")({ type: "paste", target: editorTarget, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true);
assert.equal(module.snapshot().paste_events, 1);
assert.equal(module.snapshot().blocked_pastes, 1);
module.activate("standard", "P001");
assert.equal(notice.hidden, true);
assert.equal(copy.disabled, false);
assert.equal(module.snapshot().paste_events, 0);
console.log("Exam-mode UI integrity checks passed");
