# SCIP-OJ

系统建模与仿真 · SCIP/Python **力扣式**练习站（**GitHub Pages**）。

站点：https://AmaneSuzuha000.github.io/SCIP-OJ/

## 判分政策

| 项 | 值 |
|----|----|
| L1 | 浏览器练习；多实例**算术平均**；通过线 **90**；**不作正式成绩** |
| L2 | PR + Actions 重判；**作业认 L2** |

## 入口

- 学生：[docs/学生指南.md](docs/学生指南.md)
- 老师出题：[docs/出题指南.md](docs/出题指南.md)
- 协议：[docs/判分协议-已冻结.md](docs/判分协议-已冻结.md)

## 仓库结构

- `site/` — Pages 前端
- `problems/` — 题库（P001 背包、P002 指派）
- `judge/` — Python 性质验证（与 JS 对齐）
- `submissions/` — 学生 L2 交卷目录
- `.github/workflows/deploy.yml` — Pages
- `.github/workflows/l2-grade.yml` — L2 重判

## 本地烟测

```bash
cd SCIP-OJ
PYTHONPATH=. python -c "
import json
from pathlib import Path
from judge.runner_l1 import load_solve, run_l1
for p in ['P001_knapsack','P002_assignment']:
    meta=json.load(open(f'problems/{p}/meta.json'))
    print(p, run_l1(load_solve(Path(f'problems/{p}/template.py')), meta)['score'])
"
```

## Phase 0+

- JupyterLite + emscripten-forge `pyscipopt`（见 `environment.yml`）
- Pyodide/内核执行 textarea 学生代码
