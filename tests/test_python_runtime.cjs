"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("site/js/python_runtime.js", "utf8");
assert(!source.includes("inThreadPyodide"), "Student code must not execute on the UI thread");
const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert(!executable.includes("py.runPython("), "The practice runtime must never use synchronous main-thread execution");

async function check() {
  const created = [];
  class WorkerStub {
    constructor(url) { this.url = url; this.terminated = false; created.push(this); }
    postMessage(message) {
      if (message.type === "init") {
        setImmediate(() => this.onmessage({ data: { type: "init_ok" } }));
      } else if (message.type === "solve" && message.code !== "INFINITE_LOOP") {
        setImmediate(() => this.onmessage({
          data: { type: "solve_ok", id: message.id,
            resultJson: JSON.stringify({ objective: 7, solution: [1] }) }
        }));
      }
    }
    terminate() { this.terminated = true; }
  }
  const window = { location: { href: "https://example.github.io/SCIP-OJ/index.html" } };
  const document = { currentScript: { src: "https://example.github.io/SCIP-OJ/js/python_runtime.js?v=1" } };
  vm.runInNewContext(source, { window, document, Worker: WorkerStub, URL,
    setTimeout, clearTimeout, console }, { filename: "python_runtime.js" });

  // DOM currentScript is null after evaluation; the captured URL must still work.
  document.currentScript = null;
  await window.ScipOJRuntime.ensureReady();
  assert.equal(created[0].url, "https://example.github.io/SCIP-OJ/js/pyodide_worker.js");
  assert.equal(window.ScipOJRuntime.isReady(), true);
  const answer = await window.ScipOJRuntime.runSolve("OK", { n: 1 }, 1);
  assert.equal(answer.objective, 7);
  assert.equal(answer.solution[0], 1);

  await assert.rejects(
    window.ScipOJRuntime.runSolve("INFINITE_LOOP", { n: 1 }, 0.01),
    /已终止隔离 Worker/
  );
  assert.equal(created[0].terminated, true);
  assert.equal(window.ScipOJRuntime.isReady(), false);

  class BrokenWorker { constructor() { throw new Error("Blocked by browser policy"); } }
  const brokenWindow = { location: { href: "https://example.github.io/SCIP-OJ/index.html" } };
  const brokenDocument = { currentScript: { src: "https://example.github.io/SCIP-OJ/js/python_runtime.js" } };
  vm.runInNewContext(source, { window: brokenWindow, document: brokenDocument,
    Worker: BrokenWorker, URL, setTimeout, clearTimeout, console });
  await assert.rejects(brokenWindow.ScipOJRuntime.ensureReady(), /已停止本地执行/);
  assert.equal(brokenWindow.ScipOJRuntime.isReady(), false);
  console.log("Worker path, execution isolation, timeout and fail-closed regressions passed");
}
check().catch(error => { console.error(error); process.exitCode = 1; });
