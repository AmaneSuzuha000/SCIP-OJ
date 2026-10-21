# SCIP-OJ

系统建模与仿真 · SCIP/Python **力扣式**练习站（**GitHub Pages**）+ **JupyterLite**（浏览器真跑 PySCIPOpt）。

- **OJ 站点（力扣壳）**：https://AmaneSuzuha000.github.io/SCIP-OJ/
- **JupyterLab (PySCIPOpt)**：https://AmaneSuzuha000.github.io/SCIP-OJ/lab/index.html
- **REPL 入口**：https://AmaneSuzuha000.github.io/SCIP-OJ/repl/index.html

## 判分政策与运行模式

| 层次 | 说明 |
|---|---|
| **L1** | **浏览器练习判分**：WebAssembly 真实执行文本框中的学生 Python；多实例**算术平均**；通过线 **90**；**首次加载约需数秒**；**不作正式成绩** |
| **L2** | **正式提交作业**：PR + GitHub Actions 重判；**作业认 L2** |

## 功能与入口

- 学生指南：[docs/学生指南.md](docs/学生指南.md)
- 老师出题：[docs/出题指南.md](docs/出题指南.md)
- 判分协议：[docs/判分协议-已冻结.md](docs/判分协议-已冻结.md)
- JupyterLab 入门 Notebook：
  - `content/01_P001_knapsack_PySCIPOpt.ipynb`（背包问题 MIP 建模）
  - `content/02_P002_assignment_PySCIPOpt.ipynb`（指派问题 MIP 建模）

## 架构

1. **GitHub Pages 根路径 (`/`)**：
   - 力扣壳（题单、题面渲染、Python 代码编辑框、实时 L1 判分）。
   - 浏览器内通过 WebAssembly 运行学生代码，获取 `solve(instance)` 结果送入 `knapsack_judge.js` / `assignment_judge.js` 计算分值与约束违反报告。
   - 首次点击判分需下载 WASM 解释器（约 6MB），加载后秒级响应；若网络阻断则安全降级为 Demo 求解器并清晰提示。
2. **JupyterLite (`/lab/`)**：
   - 基于 `jupyterlite-xeus` 构建，预装 `xeus-python` + `pyscipopt` + `numpy`（来自 `emscripten-forge-4x` 频道）。
   - 学生可在浏览器内无需安装本地环境直接运行 `from pyscipopt import Model` 进行复杂的运筹优化建模实验。
3. **L2 评测（GitHub Actions）**：
   - 学生提交 `submissions/<username>/<problem_id>.py`，开 PR 触发自动化重判与评论。

## 仓库结构

- `site/` — 力扣壳前端页面与判分脚本
  - `site/js/python_runtime.js` — WASM 运行时控制器（支持 Web Worker 与超时控制）
  - `site/js/pyodide_worker.js` — Web Worker 隔离执行沙箱
  - `site/js/knapsack_judge.js` — P001 L1 评分逻辑
  - `site/js/assignment_judge.js` — P002 L1 评分逻辑
- `content/` — JupyterLite 示例 Notebook
- `problems/` — 题库（P001 背包、P002 指派）
- `judge/` — Python 性质验证判分内核（与 JS 保持严格对齐）
- `submissions/` — 学生 L2 交卷目录
- `environment.yml` — JupyterLite xeus 内核预装依赖（`pyscipopt`, `xeus-python`, `numpy`）
- `.github/build-environment.yml` — JupyterLite 构建环境定义
- `.github/workflows/deploy.yml` — Pages 构建与部署流水线
- `.github/workflows/l2-grade.yml` — L2 重判流水线

## 本地烟测

```bash
cd SCIP-OJ
PYTHONPATH=. python3 -c "
import json
from pathlib import Path
from judge.runner_l1 import load_solve, run_l1
for p in ['P001_knapsack','P002_assignment']:
    meta=json.load(open(f'problems/{p}/meta.json'))
    print(p, run_l1(load_solve(Path(f'problems/{p}/template.py')), meta)['score'])
"
```
