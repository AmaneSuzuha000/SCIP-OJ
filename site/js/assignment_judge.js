/** Mirror of judge assignment grading + L1 runner. */
function genAssignment(seed) {
  const rng = mulberry32a(seed);
  const n = 3 + Math.floor(rng() * 3); // 3..5
  const costs = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 1 + Math.floor(rng() * 20))
  );
  return { n, costs, optimal_value: assignmentOpt(costs) };
}

function assignmentOpt(costs) {
  const n = costs.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let best = Infinity;
  function permute(a, l) {
    if (l === a.length) {
      let s = 0;
      for (let i = 0; i < n; i++) s += costs[i][a[i]];
      if (s < best) best = s;
      return;
    }
    for (let i = l; i < a.length; i++) {
      [a[l], a[i]] = [a[i], a[l]];
      permute(a, l + 1);
      [a[l], a[i]] = [a[i], a[l]];
    }
  }
  permute(idx.slice(), 0);
  return best;
}

function asMatrix(solution, n) {
  if (Array.isArray(solution)) {
    if (solution.length === n && Array.isArray(solution[0])) {
      return solution.map((row) => row.map(Number));
    }
    if (solution.length === n * n) {
      const m = [];
      for (let i = 0; i < n; i++) m.push(solution.slice(i * n, (i + 1) * n).map(Number));
      return m;
    }
  }
  if (solution && typeof solution === "object") {
    const m = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const keys = [`${i},${j}`, `${i}-${j}`, i * n + j, String(i * n + j)];
        for (const k of keys) {
          if (solution[k] != null) {
            m[i][j] = Number(solution[k]);
            break;
          }
        }
        const row = solution[i] ?? solution[String(i)];
        if (row && typeof row === "object" && !Array.isArray(solution)) {
          if (row[j] != null || row[String(j)] != null) {
            m[i][j] = Number(row[j] ?? row[String(j)]);
          }
        }
      }
    }
    return m;
  }
  throw new Error("solution 形状无法解析为 nxn");
}

function gradeAssignment(result, instance, meta) {
  const weights = Object.assign({ F: 10, C: 35, I: 10, O: 35 }, meta.weights || {});
  const breakdown = { F: 0, C: 0, I: 0, O: 0 };
  const messages = [];
  const eps = meta.eps_feas ?? 1e-5;
  if (!result || typeof result !== "object" || result.objective == null || result.solution == null) {
    messages.push("缺少 objective/solution");
    return packA(0, false, breakdown, messages, meta);
  }
  breakdown.F = weights.F;
  messages.push("格式 OK");
  let x;
  try {
    x = asMatrix(result.solution, instance.n);
  } catch (e) {
    messages.push(String(e));
    return packA(breakdown.F, false, breakdown, messages, meta);
  }
  for (let i = 0; i < instance.n; i++) {
    for (let j = 0; j < instance.n; j++) {
      if (x[i][j] < -eps || x[i][j] > 1 + eps) {
        messages.push(`x[${i},${j}]=${x[i][j]} 超出 [0,1]`);
        return packA(sumA(breakdown), false, breakdown, messages, meta);
      }
    }
  }
  for (let i = 0; i < instance.n; i++) {
    const s = x[i].reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > eps) {
      messages.push(`行 ${i} 和=${s}（应为 1）`);
      return packA(sumA(breakdown), false, breakdown, messages, meta);
    }
  }
  for (let j = 0; j < instance.n; j++) {
    let s = 0;
    for (let i = 0; i < instance.n; i++) s += x[i][j];
    if (Math.abs(s - 1) > eps) {
      messages.push(`列 ${j} 和=${s}（应为 1）`);
      return packA(sumA(breakdown), false, breakdown, messages, meta);
    }
  }
  breakdown.C = weights.C;
  messages.push("可行");
  for (let i = 0; i < instance.n; i++) {
    for (let j = 0; j < instance.n; j++) {
      if (Math.abs(x[i][j] - Math.round(x[i][j])) > (meta.eps_int ?? 1e-5)) {
        messages.push(`x[${i},${j}]=${x[i][j]} 非整数`);
        return packA(sumA(breakdown), false, breakdown, messages, meta);
      }
    }
  }
  breakdown.I = weights.I;
  messages.push("整数性 OK");
  let recomputed = 0;
  for (let i = 0; i < instance.n; i++)
    for (let j = 0; j < instance.n; j++) recomputed += instance.costs[i][j] * x[i][j];
  if (Math.abs(recomputed - Number(result.objective)) > eps) {
    messages.push("objective 与 solution 不一致");
    return packA(sumA(breakdown), false, breakdown, messages, meta);
  }
  const opt = instance.optimal_value;
  const obj = Number(result.objective);
  const gap = Math.max(0, (obj - opt) / Math.max(1, Math.abs(opt)));
  let oRatio = 0;
  if (gap <= (meta.eps_obj ?? 1e-4)) oRatio = 1;
  else if (gap <= 0.01) oRatio = 0.75;
  else if (gap <= 0.05) oRatio = 0.5;
  else if (gap <= 0.1) oRatio = 0.25;
  breakdown.O = Math.round(weights.O * oRatio);
  messages.push(`目标 gap=${gap.toExponential(2)}`);
  const score = sumA(breakdown);
  return packA(score, score >= (meta.pass_score ?? 90), breakdown, messages, meta);
}

async function runL1Assignment(solveFn, meta) {
  const n = meta.n_instances_l1 ?? 3;
  const base = meta.seed_base ?? 20261022;
  const instances = [];
  for (let i = 0; i < n; i++) {
    const inst = genAssignment(base + i);
    let rep;
    try {
      const result = await solveFn(inst);
      rep = gradeAssignment(result, inst, meta);
    } catch (e) {
      rep = { score: 0, passed: false, breakdown: { F: 0, C: 0, I: 0, O: 0 }, messages: ["运行错误: " + (e?.message || e)] };
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
    breakdown: avgBA(instances),
    instances,
    messages: [`N=${n} 实例平均分`],
  };
}

function demoSolveAssignment(instance) {
  const { n, costs } = instance;
  const idx = Array.from({ length: n }, (_, i) => i);
  let best = Infinity,
    bestPerm = idx.slice();
  function permute(a, l) {
    if (l === a.length) {
      let s = 0;
      for (let i = 0; i < n; i++) s += costs[i][a[i]];
      if (s < best) {
        best = s;
        bestPerm = a.slice();
      }
      return;
    }
    for (let i = l; i < a.length; i++) {
      [a[l], a[i]] = [a[i], a[l]];
      permute(a, l + 1);
      [a[l], a[i]] = [a[i], a[l]];
    }
  }
  permute(idx.slice(), 0);
  const sol = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) sol[i][bestPerm[i]] = 1;
  return { status: "optimal", objective: best, solution: sol };
}

function avgBA(reps) {
  const keys = Object.keys(reps[0].breakdown);
  const out = {};
  for (const k of keys) out[k] = Math.round(reps.reduce((s, r) => s + (r.breakdown[k] || 0), 0) / reps.length);
  return out;
}
function packA(score, passed, breakdown, messages, meta) {
  return { score, passed, breakdown, messages, pass_score: meta.pass_score ?? 90 };
}
function sumA(o) {
  return Object.values(o).reduce((a, b) => a + b, 0);
}
function mulberry32a(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

window.ScipOJAssignment = { genAssignment, gradeAssignment, runL1Assignment, demoSolveAssignment };
