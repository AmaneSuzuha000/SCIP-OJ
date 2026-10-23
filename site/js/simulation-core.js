/*
 * IE Simulation Lab — reproducible FCFS multi-server discrete-event simulation.
 * Educational parameters are synthetic; do not represent railway operational data.
 * No external dependencies. Paired alternatives reuse identical arrival/service draws.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IESimLab = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function requireRange(value, label, min, max, integer) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < min || num > max ||
        (integer && !Number.isInteger(num))) {
      throw new RangeError(label + " 须在 " + min + "–" + max + " 范围内");
    }
    return num;
  }

  function validate(raw) {
    const params = {
      arrivalMean: requireRange(raw.arrivalMean, "平均到达间隔（分钟）", 1, 120),
      serviceMean: requireRange(raw.serviceMean, "平均检修工时（分钟）", 1, 180),
      serversA: requireRange(raw.serversA, "方案 A 工位数", 1, 16, true),
      serversB: requireRange(raw.serversB, "方案 B 工位数", 1, 16, true),
      horizon: requireRange(raw.horizon, "仿真时长（分钟）", 120, 10080, true),
      warmup: requireRange(raw.warmup, "预热时长（分钟）", 0, 9999, true),
      replications: requireRange(raw.replications, "独立重复次数", 5, 100, true),
      seed: requireRange(raw.seed, "随机种子", 1, 4294967295, true)
    };
    if (params.warmup >= params.horizon) {
      throw new RangeError("预热时长必须小于仿真时长");
    }
    return params;
  }

  function generator(seed) {
    let state = seed >>> 0;
    return function () {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return (state + 0.5) / 4294967296;
    };
  }

  function workload(params, seed) {
    const random = generator(seed);
    const jobs = [];
    let time = 0;
    while (time < params.horizon) {
      time += -params.arrivalMean * Math.log(random());
      if (time >= params.horizon) break;
      if (jobs.length >= 20000) throw new RangeError("到达事件超过 20,000 个，请缩短实验时间");
      const service = -params.serviceMean * Math.log(random());
      jobs.push({ arrival: time, service });
    }
    return jobs;
  }

  function overlap(start, end, low, high) {
    return Math.max(0, Math.min(end, high) - Math.max(start, low));
  }

  function simulate(jobs, servers, warmup, horizon) {
    const available = Array(servers).fill(0);
    let waiting = 0;
    let cohortSize = 0;
    let completions = 0;
    let busyTime = 0;
    let queueArea = 0;
    let wipArea = 0;

    for (const job of jobs) {
      let worker = 0;
      for (let i = 1; i < servers; i++) {
        if (available[i] < available[worker]) worker = i;
      }
      const start = Math.max(job.arrival, available[worker]);
      const end = start + job.service;
      available[worker] = end;
      if (job.arrival >= warmup && job.arrival < horizon) {
        waiting += start - job.arrival;
        cohortSize++;
      }
      if (end >= warmup && end < horizon) completions++;
      busyTime += overlap(start, end, warmup, horizon);
      queueArea += overlap(job.arrival, start, warmup, horizon);
      wipArea += overlap(job.arrival, end, warmup, horizon);
    }
    const measured = horizon - warmup;
    return {
      avgWait: cohortSize ? waiting / cohortSize : 0,
      throughput: completions / measured * 60,
      utilization: busyTime / (measured * servers),
      meanQueue: queueArea / measured,
      meanWip: wipArea / measured,
      arrivals: jobs.length,
      cohortSize,
      completions
    };
  }

  function average(rows, key) {
    return rows.reduce(function (total, row) { return total + row[key]; }, 0) / rows.length;
  }

  function pairedCI(differences) {
    const n = differences.length;
    const mean = differences.reduce(function (a, b) { return a + b; }, 0) / n;
    const variance = differences.reduce(function (acc, value) {
      return acc + (value - mean) * (value - mean);
    }, 0) / (n - 1);
    const halfWidth = 1.96 * Math.sqrt(variance / n);
    return { mean, low: mean - halfWidth, high: mean + halfWidth, halfWidth,
      method: "normal_approx_95", replications: n };
  }

  function compare(raw) {
    const params = validate(raw);
    const a = [];
    const b = [];
    const waitDifferences = [];
    for (let r = 0; r < params.replications; r++) {
      const seed = (params.seed + Math.imul(r, 2654435761)) >>> 0;
      const events = workload(params, seed);
      const resultA = simulate(events, params.serversA, params.warmup, params.horizon);
      const resultB = simulate(events, params.serversB, params.warmup, params.horizon);
      a.push(resultA);
      b.push(resultB);
      waitDifferences.push(resultB.avgWait - resultA.avgWait);
    }
    const keys = ["avgWait", "throughput", "utilization", "meanQueue", "meanWip", "arrivals"];
    function aggregate(rows) {
      const obj = {};
      for (const key of keys) obj[key] = average(rows, key);
      return obj;
    }
    return {
      params,
      baseline: aggregate(a),
      alternative: aggregate(b),
      waitDiffCI: pairedCI(waitDifferences),
      waitDifferences,
      notes: {
        assumptions: "Poisson arrivals; independent exponential service times; FCFS; identical parallel servers; infinite waiting room",
        scope: "finite horizon, starting empty; arrivals before horizon; cohort waiting measured until start even if after horizon",
        paired: true
      }
    };
  }

  return { validate, workload, simulate, compare };
});
