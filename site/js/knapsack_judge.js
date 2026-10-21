/** Mirror of judge/common.py knapsack grading + average (L1). */
function genKnapsack(seed) {
  const rng = mulberry32(seed);
  const n = 4 + Math.floor(rng() * 5);
  const weights = Array.from({ length: n }, () => 1 + Math.floor(rng() * 10));
  const values = Array.from({ length: n }, () => 1 + Math.floor(rng() * 12));
  const capacity = Math.max(...weights) + 5 + Math.floor(rng() * 11);
  const dp = Array(capacity + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const w = weights[i], v = values[i];
    for (let c = capacity; c >= w; c--) dp[c] = Math.max(dp[c], dp[c - w] + v);
  }
  return { n, weights, values, capacity, optimal_value: dp[capacity] };
}

function asVector(solution, n) {
  if (Array.isArray(solution)) return solution.map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = solution[i] ?? solution[String(i)] ?? 0;
    out.push(Number(v));
  }
  return out;
}

function gradeKnapsack(result, instance, meta) {
  const weights = Object.assign({ F: 10, C: 35, I: 10, O: 35 }, meta.weights || {});
  const breakdown = { F: 0, C: 0, I: 0, O: 0 };
  const messages = [];
  const eps = meta.eps_feas ?? 1e-5;
  if (!result || typeof result !== "object" || result.objective == null || result.solution == null) {
    messages.push("缺少 objective/solution");
    return pack(0, false, breakdown, messages, meta);
  }
  breakdown.F = weights.F;
  messages.push("格式 OK");
  let x;
  try { x = asVector(result.solution, instance.n); } catch (e) {
    messages.push(String(e));
    return pack(breakdown.F, false, breakdown, messages, meta);
  }
  const load = x.reduce((s, xi, i) => s + xi * instance.weights[i], 0);
  if (load - instance.capacity > eps) {
    messages.push(`超重: load=${load} > capacity=${instance.capacity}`);
    return pack(sum(breakdown), false, breakdown, messages, meta);
  }
  for (let i = 0; i < x.length; i++) {
    if (x[i] < -eps || x[i] > 1 + eps) {
      messages.push(`x[${i}]=${x[i]} 超出 [0,1]`);
      return pack(sum(breakdown), false, breakdown, messages, meta);
    }
  }
  breakdown.C = weights.C;
  messages.push("可行");
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i] - Math.round(x[i])) > (meta.eps_int ?? 1e-5)) {
      messages.push(`x[${i}]=${x[i]} 非整数`);
      return pack(sum(breakdown), false, breakdown, messages, meta);
    }
  }
  breakdown.I = weights.I;
  messages.push("整数性 OK");
  const recomputed = x.reduce((s, xi, i) => s + xi * instance.values[i], 0);
  if (Math.abs(recomputed - Number(result.objective)) > eps) {
    messages.push("objective 与 solution 不一致");
    return pack(sum(breakdown), false, breakdown, messages, meta);
  }
  const opt = instance.optimal_value;
  const obj = Number(result.objective);
  const gap = Math.max(0, (opt - obj) / Math.max(1, Math.abs(opt)));
  let oRatio = 0;
  if (gap <= (meta.eps_obj ?? 1e-4)) oRatio = 1;
  else if (gap <= 0.01) oRatio = 0.75;
  else if (gap <= 0.05) oRatio = 0.5;
  else if (gap <= 0.1) oRatio = 0.25;
  breakdown.O = Math.round(weights.O * oRatio);
  messages.push(`目标 gap=${gap.toExponential(2)}`);
  const score = sum(breakdown);
  return pack(score, score >= (meta.pass_score ?? 90), breakdown, messages, meta);
}

function runL1(solveFn, meta) {
  const n = meta.n_instances_l1 ?? 3;
  const base = meta.seed_base ?? 20261021;
  const instances = [];
  for (let i = 0; i < n; i++) {
    const inst = genKnapsack(base + i);
    let rep;
    try {
      const result = solveFn(inst);
      rep = gradeKnapsack(result, inst, meta);
    } catch (e) {
      rep = { score: 0, passed: false, breakdown: { F: 0, C: 0, I: 0, O: 0 }, messages: ["运行错误: " + e] };
    }
    rep.seed = base + i;
    instances.push(rep);
  }
  const score = Math.round(instances.reduce((s, r) => s + r.score, 0) / instances.length);
  return {
    problem_id: meta.id,
    layer: "L1",
    score,
    passed: score >= (meta.pass_score ?? 90),
    breakdown: avgBreakdown(instances),
    instances,
    messages: [`N=${n} 实例平均分`],
  };
}

function avgBreakdown(reps) {
  const keys = Object.keys(reps[0].breakdown);
  const out = {};
  for (const k of keys) out[k] = Math.round(reps.reduce((s, r) => s + (r.breakdown[k] || 0), 0) / reps.length);
  return out;
}
function pack(score, passed, breakdown, messages, meta) {
  return { score, passed, breakdown, messages, pass_score: meta.pass_score ?? 90 };
}
function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal DP solve matching template.py (for demo button without Pyodide). */
function demoSolve(instance) {
  const { n, weights, values, capacity } = instance;
  const W = Array.from({ length: n + 1 }, () => Array(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const w = weights[i - 1], v = values[i - 1];
    for (let c = 0; c <= capacity; c++) {
      W[i][c] = W[i - 1][c];
      if (c >= w) W[i][c] = Math.max(W[i][c], W[i - 1][c - w] + v);
    }
  }
  let c = capacity;
  const sol = {};
  for (let i = 0; i < n; i++) sol[i] = 0;
  for (let i = n; i >= 1; i--) {
    if (W[i][c] !== W[i - 1][c]) {
      sol[i - 1] = 1;
      c -= weights[i - 1];
    }
  }
  return { status: "optimal", objective: W[n][capacity], solution: sol };
}

window.ScipOJJudge = { genKnapsack, gradeKnapsack, runL1, demoSolve };
