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
  listEl.innerHTML = "<h2>题单</h2>" + index.map(p =>
    `<a class="card" href="#${p.id}" data-id="${p.id}" data-path="${p.path}"><strong>${p.id}</strong> ${p.title}<br/><small>${p.difficulty} · ${(p.tags||[]).join(", ")}</small></a>`
  ).join("");

  listEl.querySelectorAll("a.card").forEach(a => a.addEventListener("click", async (e) => {
    e.preventDefault();
    await openProblem(a.dataset.path, a.dataset.id);
  }));

  if (location.hash) {
    const id = location.hash.slice(1);
    const p = index.find(x => x.id === id);
    if (p) await openProblem(p.path, p.id);
  }
}

async function openProblem(path, id) {
  const ws = document.getElementById("workspace");
  ws.hidden = false;
  const meta = await loadJSON(`${path}/meta.json`);
  const readme = await loadText(`${path}/README.md`);
  const template = await loadText(`${path}/template.py`);
  document.getElementById("title").textContent = `${meta.id} · 通过线 ${meta.pass_score}`;
  document.getElementById("readme").innerHTML = `<pre>${escapeHtml(readme)}</pre>`;
  document.getElementById("code").value = template;
  document.getElementById("report").textContent = "";
  document.getElementById("status").textContent = "";

  document.getElementById("btn-grade").onclick = () => {
    // MVP: run built-in demoSolve (same DP as template). Later: Pyodide exec textarea.
    const solveFn = window.ScipOJJudge.demoSolve;
    const report = window.ScipOJJudge.runL1(solveFn, meta);
    document.getElementById("report").textContent = JSON.stringify(report, null, 2);
    const st = document.getElementById("status");
    st.textContent = report.passed ? `通过 · ${report.score}` : `未通过 · ${report.score}`;
    st.className = report.passed ? "pass" : "fail";
    localStorage.setItem("scip-oj:" + id, JSON.stringify({ score: report.score, at: Date.now() }));
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

main().catch(err => {
  document.getElementById("problem-list").textContent = String(err);
});
