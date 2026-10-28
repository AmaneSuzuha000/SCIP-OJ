"use strict";
/* Tests the actual UI export path with DOM mocks, without extra dependencies. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../site/js/simulation-core.js");

const params = {
  arrivalMean: 8, serviceMean: 12, serversA: 2, serversB: 3,
  horizon: 480, warmup: 60, replications: 30, seed: 20261023
};
const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      value: id in params ? String(params[id]) : "",
      textContent: "", hidden: false, disabled: false, style: {},
      handlers: {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      dispatch(name, event = {}) { assert(this.handlers[name]); this.handlers[name](event); }
    });
  }
  return elements.get(id);
}
const blobs = new Map(), clicks = [];
const document = {
  readyState: "loading",
  getElementById: el,
  addEventListener(name, callback) {
    assert.equal(name, "DOMContentLoaded");
    this.ready = callback;
  },
  createElement(tag) {
    assert.equal(tag, "a");
    return {
      href: "", download: "",
      click() { clicks.push({ href: this.href, download: this.download }); },
      remove() {}
    };
  },
  body: { appendChild() {} }
};
const URL = {
  createObjectURL(blob) {
    const key = "blob:test-" + blobs.size;
    blobs.set(key, blob);
    return key;
  },
  revokeObjectURL() {}
};
vm.runInNewContext(fs.readFileSync("site/js/case-studio.js", "utf8"), {
  window: { IESimLab: core }, document, URL, Blob,
  setTimeout() {} // suppress delayed URL cleanup in this deterministic test
}, { filename: "case-studio.js" });
document.ready();

async function main() {
  assert.equal(el("export-json-button").disabled, false);
  el("export-json-button").dispatch("click");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].download, "IE-DES-01-verifiable-experiment.json");
  let report = JSON.parse(await blobs.get(clicks[0].href).text());
  assert.equal(report.schemaVersion, "ie-des01-experiment/1");
  assert.equal(report.runs.length, 30);
  assert.equal(report.summary.waitDiffCI.method, "normal_approx_95");
  assert.equal(report.runs[0].resultA.arrivals, report.runs[0].resultB.arrivals);
  assert(!JSON.stringify(report).includes("access_token"));

  el("serversB").value = "4";
  el("experiment-form").dispatch("input");
  assert.equal(el("export-json-button").disabled, true,
    "Edited parameters invalidate previously exportable evidence");
  assert.equal(el("export-button").disabled, true);
  el("experiment-form").dispatch("submit", { preventDefault() {} });
  el("export-json-button").dispatch("click");
  report = JSON.parse(await blobs.get(clicks.at(-1).href).text());
  assert.equal(report.params.serversB, 4, "After rerun, export current experiment");

  if (process.argv.includes("--emit-json")) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    console.log("IE-DES-01 browser export, stale-evidence protection, and data contract passed");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
