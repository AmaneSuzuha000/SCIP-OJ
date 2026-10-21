const BASE = new URL(".", location.href);

async function loadJSON(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("load failed " + path);
  return r.json();
}

async function loadText(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error("load failed " + path);
  return r.text();
}

async function main() {
  const listEl = document.getElementById("problem-list");
  const index = await loadJSON("problems/index.json");
  listEl.innerHTML =
    "<h2>题单</h2>" +
    index
      .map(
        (p) =>
          `<a class="card" href="#${p.id}" data-id="${p.id}" data-path="${p.path}"><strong>${p.id}</strong> ${p.title}<br/><small>${p.difficulty} · ${(p.tags || []).join(", ")}</small></a>`
      )
      .join("");

  listEl.querySelectorAll("a.card").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      await openProblem(a.dataset.path, a.dataset.id);
    })
  );

  if (location.hash) {
    const id = location.hash.slice(1);
    const p = index.find((x) => x.id === id);
    if (p) await openProblem(p.path, p.id);
  }

  // Pre-warm Python WASM runtime in the background
  if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
    window.ScipOJRuntime.ensureReady().catch((e) => {
      console.log("Background Python pre-warm:", e);
    });
  }
}

async function openProblem(path, id) {
  const ws = document.getElementById("workspace");
  ws.hidden = false;
  const meta = await loadJSON(`${path}/meta.json`);
  const readme = await loadText(`${path}/README.md`);
  const template = await loadText(`${path}/template.py`);
  document.getElementById("title").textContent = `${meta.id} · 通过线 ${meta.pass_score}`;
  document.getElementById("readme").innerHTML = window.marked ? marked.parse(readme) : `<pre>${escapeHtml(readme)}</pre>`;
  document.getElementById("code").value = template;
  document.getElementById("report").textContent = "";
  document.getElementById("status").textContent = "";

  const btnGrade = document.getElementById("btn-grade");
  const statusEl = document.getElementById("status");
  const reportEl = document.getElementById("report");

  btnGrade.onclick = async () => {
    const userCode = document.getElementById("code").value;
    const grader = meta.grader || "knapsack";
    const timeLimitSec = meta.time_limit_sec || 10;

    btnGrade.disabled = true;
    reportEl.textContent = "";
    statusEl.className = "";
    statusEl.textContent = "⏳ 正在准备 Python WASM 运行环境（首次加载需数秒）...";

    let runtimeAvailable = false;
    if (window.ScipOJRuntime && typeof window.ScipOJRuntime.ensureReady === "function") {
      try {
        await window.ScipOJRuntime.ensureReady((msg) => {
          statusEl.textContent = msg;
        });
        runtimeAvailable = true;
      } catch (err) {
        console.warn("Python runtime init failed, falling back to demo solver:", err);
      }
    }

    try {
      let report;
      if (runtimeAvailable) {
        statusEl.textContent = `⏳ 正在执行学生 Python 代码（L1 判分，超时限制 ${timeLimitSec}s）...`;
        const studentSolve = async (instance) => {
          return await window.ScipOJRuntime.runSolve(userCode, instance, timeLimitSec);
        };
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(studentSolve, meta);
        } else {
          report = await window.ScipOJJudge.runL1(studentSolve, meta);
        }
        report.execution_mode = "python-wasm-student-code";
        report.execution_note = "已在浏览器 WASM Python 环境中执行学生代码";
      } else {
        statusEl.textContent = "⚠️ Python 运行时不可用，降级使用内置最优 Demo 评分...";
        if (grader === "assignment") {
          report = await window.ScipOJAssignment.runL1Assignment(window.ScipOJAssignment.demoSolveAssignment, meta);
        } else {
          report = await window.ScipOJJudge.runL1(window.ScipOJJudge.demoSolve, meta);
        }
        report.execution_mode = "demo-solve-fallback";
        report.execution_note = "降级提示：浏览器 Python 运行时未能启动，此评分为内置 Demo 评分，未执行学生代码。";
        report.messages = report.messages || [];
        report.messages.unshift("[降级警告] 未能启动浏览器 Python 运行时，此评分为内置 Demo 兜底评分。");
      }

      reportEl.textContent = JSON.stringify(report, null, 2);
      statusEl.textContent = report.passed
        ? `通过 · ${report.score} 分`
        : `未通过 · ${report.score} 分`;
      statusEl.className = report.passed ? "pass" : "fail";
      if (!runtimeAvailable) {
        statusEl.textContent += "（Demo 兜底）";
        statusEl.className = "warn";
      }
      localStorage.setItem("scip-oj:" + id, JSON.stringify({ score: report.score, at: Date.now() }));
    } catch (e) {
      statusEl.textContent = "判分异常: " + (e?.message || e);
      statusEl.className = "fail";
      reportEl.textContent = String(e?.stack || e);
    } finally {
      btnGrade.disabled = false;
    }
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

main().catch((err) => {
  document.getElementById("problem-list").textContent = String(err);
});
