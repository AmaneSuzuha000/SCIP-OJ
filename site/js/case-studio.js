/* IE Case Studio — presentation only; simulation engine is in simulation-core.js. */
(function () {
  "use strict";
  const defaults = {
    arrivalMean: 8, serviceMean: 12, serversA: 2, serversB: 3,
    horizon: 480, warmup: 60, replications: 30, seed: 20261023
  };
  let last = null;

  function field(id) { return document.getElementById(id); }
  function setText(id, value) { field(id).textContent = value; }
  function number(value, digits) { return Number(value).toFixed(digits); }
  function sample() {
    const raw = {};
    for (const key of Object.keys(defaults)) raw[key] = Number(field(key).value);
    return raw;
  }
  function render(result) {
    const a = result.baseline;
    const b = result.alternative;
    const ci = result.waitDiffCI;
    setText("wait-a", number(a.avgWait, 2));
    setText("wait-b", number(b.avgWait, 2));
    setText("wait-diff", (ci.mean > 0 ? "+" : "") + number(ci.mean, 2));
    setText("ci-value", "[" + number(ci.low, 2) + ", " + number(ci.high, 2) + "] 分钟");
    for (const [key, metric, digits] of [
      ["throughput", "throughput", 2], ["queue", "meanQueue", 2], ["wip", "meanWip", 2]
    ]) {
      setText(key + "-a", number(a[metric], digits));
      setText(key + "-b", number(b[metric], digits));
    }
    setText("util-a", number(a.utilization * 100, 1) + "%");
    setText("util-b", number(b.utilization * 100, 1) + "%");
    const maxWait = Math.max(a.avgWait, b.avgWait, 0.01);
    field("bar-a").style.width = (100 * a.avgWait / maxWait) + "%";
    field("bar-b").style.width = (100 * b.avgWait / maxWait) + "%";
    setText("bar-label-a", number(a.avgWait, 1) + " min");
    setText("bar-label-b", number(b.avgWait, 1) + " min");

    const p = result.params;
    const rhoA = p.serviceMean / (p.arrivalMean * p.serversA);
    const rhoB = p.serviceMean / (p.arrivalMean * p.serversB);
    const risky = rhoA >= 1 || rhoB >= 1;
    const warning = risky
      ? "注意：至少一个方案的理论负荷率 ≥ 1。在无限时间的 M/M/c 假设下，该方案不存在有限稳态排队均值。这里报告的只是有限时域结果。"
      : "理论负荷率 A=" + number(rhoA, 2) + "、B=" + number(rhoB, 2) + "。均小于 1 仅意味着理想 M/M/c 理论上可能稳定，并不保证真实系统满足指数分布或独立性。";
    setText("stability-note", warning + " 预热后至终点统计利用率、在制品与完成量；到达于观察区间内任务的等待时间允许延伸到终点之后。");
    setText("run-status", "已完成 " + p.replications + " 组独立配对实验 · 相同输入及种子可重复生成相同结果");
    field("export-button").disabled = false;
    field("export-json-button").disabled = false;
  }

  function exportCsv() {
    if (!last) return;
    const p = last.params;
    const rows = [
      ["case_id", "IE-DES-01"],
      ["arrival_mean_min", p.arrivalMean],
      ["service_mean_min", p.serviceMean],
      ["servers_A", p.serversA],
      ["servers_B", p.serversB],
      ["horizon_min", p.horizon],
      ["warmup_min", p.warmup],
      ["replications", p.replications],
      ["seed", p.seed],
      [],
      ["metric", "A", "B"],
      ["avg_wait_min", last.baseline.avgWait, last.alternative.avgWait],
      ["throughput_per_hour", last.baseline.throughput, last.alternative.throughput],
      ["utilization", last.baseline.utilization, last.alternative.utilization],
      ["mean_queue", last.baseline.meanQueue, last.alternative.meanQueue],
      ["mean_wip", last.baseline.meanWip, last.alternative.meanWip],
      [],
      ["replication", "wait_difference_B_minus_A_min"]
    ];
    last.waitDifferences.forEach(function (value, index) { rows.push([index + 1, value]); });
    const csv = "\uFEFF" + rows.map(function (cols) { return cols.join(","); }).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "IE-DES-01-experiment.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function exportJson() {
    if (!last) return;
    const report = {
      schemaVersion: "ie-des01-experiment/1",
      caseId: "IE-DES-01",
      provenance: "Synthetic teaching simulation; local-only; not a formal grade",
      params: last.params,
      summary: {
        baseline: last.baseline,
        alternative: last.alternative,
        waitDiffCI: last.waitDiffCI
      },
      runs: last.runs
    };
    const blob = new Blob([JSON.stringify(report, null, 2) + "\n"], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "IE-DES-01-verifiable-experiment.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function run() {
    const error = field("form-error");
    error.hidden = true;
    try {
      if (!window.IESimLab) throw new Error("仿真引擎未加载，请刷新页面");
      const result = window.IESimLab.compare(sample());
      last = result;
      render(result);
    } catch (err) {
      last = null;
      field("export-button").disabled = true;
      field("export-json-button").disabled = true;
      error.textContent = String(err.message || err);
      error.hidden = false;
      setText("run-status", "参数有误，上一轮结果仅供参考");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    field("experiment-form").addEventListener("submit", function (event) {
      event.preventDefault();
      run();
    });
    field("reset-button").addEventListener("click", function () {
      for (const [key, value] of Object.entries(defaults)) field(key).value = String(value);
      run();
    });
    field("export-button").addEventListener("click", exportCsv);
    field("export-json-button").addEventListener("click", exportJson);
    field("experiment-form").addEventListener("input", function () {
      if (last) {
        last = null;
        field("export-button").disabled = true;
        field("export-json-button").disabled = true;
        setText("run-status", "实验设置已改变；请重新运行后再导出新证据。");
      }
    });
    run();
  });
})();
