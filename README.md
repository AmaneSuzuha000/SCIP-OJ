# SCIP-OJ

系统建模与仿真 · SCIP/Python **力扣式**练习站（**坚持 GitHub Pages**）。

## 已冻结判分政策

| 项 | 值 |
|----|----|
| 层级 | **仅 L1**（浏览器）；L2 后补 |
| 多实例 | **算术平均** |
| 通过线 | **90** |

L1 分数**不作正式成绩**。

## 当前骨架

- 静态站：`site/`（题单 + P001 L1 判分演示）
- 共享判分：`judge/`（Python，与浏览器 JS 规则对齐）
- 题库：`problems/P001_knapsack`
- Pages 工作流：`.github/workflows/deploy.yml`

## 启用 Pages

1. 推送 `main` 到 GitHub。
2. Settings → Pages → Source: **GitHub Actions**。
3. 等待 `Deploy GitHub Pages` 成功后打开 https://AmaneSuzuha000.github.io/SCIP-OJ/ 。

## Phase 0+（下一步）

- 接入 JupyterLite + emscripten-forge `pyscipopt`（见 `environment.yml`）
- 用 Pyodide / 内核执行 textarea 中的学生 Python，替换当前内置 DP demo
- 补 P002–P005；需要时再上 L2 Actions 重判

## 本地烟测

```bash
cd SCIP-OJ
python -c "from pathlib import Path; from judge.runner_l1 import load_solve, run_l1; import json; meta=json.load(open('problems/P001_knapsack/meta.json')); print(run_l1(load_solve(Path('problems/P001_knapsack/template.py')), meta))"
```
