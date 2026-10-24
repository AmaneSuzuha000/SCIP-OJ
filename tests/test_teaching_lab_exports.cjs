"use strict";
/* Execute the real lab UI exporter against deterministic simulation results. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function checkLab(model, params, metricLabel, metricKey, editedKey, editedValue) {
  const core = require("../site/js/" + model + "-core.js");
  const elements = new Map(), blobs = [], downloads = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", disabled: false, hidden: false, style: {}, handlers: {},
      append() {}, replaceChildren() {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      dispatch(name, event = {}) { this.handlers[name](event); }
    });
    return elements.get(id);
  }
  const form = element("lab-form");
  form.requestSubmit = () => form.dispatch("submit", { preventDefault() {} });
  const document = {
    body: { dataset: { lab: model }, appendChild() {} },
    getElementById: element,
    createDocumentFragment: () => ({ append() {} }),
    createElement: () => ({
      append() {}, remove() {},
      click() { downloads.push({ name: this.download, blob: blobs.at(-1) }); }
    })
  };
  const window = { IEInventory: core, IEFlow: core, setTimeout: callback => callback() };
  vm.runInNewContext(fs.readFileSync("site/js/teaching-labs.js", "utf8"), {
    window, document, Blob,
    FormData: class { entries() { return Object.entries(params); } },
    URL: { createObjectURL(blob) { blobs.push(blob); return "blob:lab-test"; }, revokeObjectURL() {} }
  });
  const exporter = element("export-button");
  assert.equal(exporter.disabled, false);
  exporter.dispatch("click");
  assert.equal(downloads.length, 1);
  const csv = await downloads[0].blob.text();
  const row = csv.split(/\r?\n/).find(line => line.startsWith('"' + metricLabel + '"'));
  assert(row, "Missing CSV metric: " + metricLabel);
  const values = [...row.matchAll(/"([^"]*)"/g)].map(match => match[1]);
  const result = core.compare(params);
  assert.equal(values[3], "%");
  assert(Math.abs(Number(values[1]) - 100 * result.baseline[metricKey]) < 1e-9,
    model + " CSV must express percentage values in the declared unit");
  assert(Math.abs(Number(values[2]) - 100 * result.alternative[metricKey]) < 1e-9);

  params[editedKey] = editedValue;
  form.dispatch("input");
  assert.equal(exporter.disabled, true, model + " must invalidate old exports on input");
  exporter.dispatch("click");
  assert.equal(downloads.length, 1, "Even a stale click cannot export an old experiment");
  form.requestSubmit();
  assert.equal(exporter.disabled, false);
  exporter.dispatch("click");
  assert.equal(downloads.length, 2);
  assert((await downloads[1].blob.text()).includes('"parameter:' + editedKey + '","' + editedValue + '"'));
  form.dispatch("reset");
  assert.equal(exporter.disabled, true);
}

(async () => {
  await checkLab("inventory", {
    meanDemand: 3, targetA: 8, targetB: 14, leadDays: 2, reviewDays: 1,
    holdingCost: 1, lostCost: 9, orderCost: 6, days: 365, warmup: 60,
    replications: 30, seed: 20261023
  }, "需求满足率", "fillRate", "targetB", 15);
  await checkLab("flow", {
    arrivalMean: 4, stage1Mean: 3, stage2Mean: 5, bufferA: 0, bufferB: 3,
    horizon: 960, warmup: 180, replications: 30, seed: 20261023
  }, "工序一加工利用率", "station1Util", "bufferB", 4);
  console.log("Teaching lab CSV percentages, input invalidation, rerun and reset: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
