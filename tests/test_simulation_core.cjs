"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../site/js/simulation-core.js");

const defaults = {
  arrivalMean: 8, serviceMean: 12, serversA: 2, serversB: 3,
  horizon: 480, warmup: 60, replications: 30, seed: 20261023
};
const a = core.compare(defaults);
const b = core.compare(defaults);
assert.deepEqual(a, b, "Fixed seeds and parameters must be reproducible");
assert.equal(a.waitDifferences.length, defaults.replications);
assert.equal(a.runs.length, defaults.replications, "Raw paired replicates must be exportable");
for (let i = 0; i < a.runs.length; i++) {
  const run = a.runs[i];
  assert.equal(run.index, i + 1);
  assert.equal(run.seed, (defaults.seed + Math.imul(i, 2654435761)) >>> 0);
  assert.equal(run.resultA.arrivals, run.resultB.arrivals);
  assert(Math.abs(run.waitDifference - (run.resultB.avgWait - run.resultA.avgWait)) < 1e-10);
}

assert.equal(a.waitDiffCI.replications, defaults.replications);
assert(a.baseline.avgWait > a.alternative.avgWait, "Expected seeded demonstration to benefit from extra server");
assert(a.baseline.avgWait > 0);
assert(a.alternative.utilization <= 1 && a.alternative.utilization >= 0);
assert(a.baseline.utilization <= 1 && a.baseline.utilization >= 0);
assert.equal(a.baseline.arrivals, a.alternative.arrivals, "Paired alternatives must see identical arrivals");
assert(a.waitDiffCI.low <= a.waitDiffCI.mean && a.waitDiffCI.high >= a.waitDiffCI.mean);
assert(Math.abs(a.waitDiffCI.mean - (a.alternative.avgWait - a.baseline.avgWait)) < 1e-10);

const same = core.compare({ ...defaults, serversB: defaults.serversA });
assert(same.waitDifferences.every(value => value === 0), "Identical alternatives must have zero paired differences");
assert.equal(same.waitDiffCI.halfWidth, 0);

for (const bad of [
  { ...defaults, arrivalMean: 0 },
  { ...defaults, replications: 1 },
  { ...defaults, serversA: 2.5 },
  { ...defaults, warmup: defaults.horizon },
  { ...defaults, seed: Number.NaN },
  { ...defaults, serviceMean: Infinity }
]) assert.throws(() => core.compare(bad), RangeError);

const events = core.workload(defaults, defaults.seed);
assert(events.length > 0);
assert(events.every((j, i) => j.arrival >= 0 &&
  j.arrival < defaults.horizon && j.service > 0 &&
  (i === 0 || events[i - 1].arrival < j.arrival)));
const single = core.simulate(events, 1, 60, 480);
assert(single.avgWait >= 0 && single.meanQueue >= 0 && single.meanWip >= single.meanQueue);

// The page contracts that used to be checked here -- that case-studio.html
// loaded this core, exposed export-json-button and printed the replay command --
// went with the page. The statistics above are the part that still has a
// subject: simulation-core.js is what the Python reference implementation is
// checked against, so it keeps its tests even though nothing renders it now.
console.log("IE simulation case statistical and reproducibility contracts passed");
