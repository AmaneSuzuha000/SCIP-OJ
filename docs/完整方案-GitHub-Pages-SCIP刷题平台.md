# 系统建模与仿真 · SCIP/Python 力扣式网课刷题平台  
## 完整落地方案（坚持 GitHub Pages）

| 项 | 内容 |
|----|------|
| 版本 | v1.0 |
| 日期 | 2026-10-21（Asia/Shanghai） |
| 目标用户 | 西南交大工业工程 / 运筹调度方向网课与自学 |
| 硬约束 | **站点托管在 GitHub Pages**；学生写 **Python**；尽量用 **SCIP / PySCIPOpt**；零自建后端 |
| 裁决 | **有条件可行**：浏览器内判题 + Pages 静态站 |

---

## 1. 产品目标

做一个类似力扣的「建模刷题站」：

1. 打开网页即可选题、看题、写 Python、点提交  
2. 自动给出正确率 / 分数 / 失败原因（约束违反、非最优、超时等）  
3. 教学内容覆盖：LP / MIP、约束建模、简单 Job-Shop / 调度、网络相关建模  
4. 部署成本接近零：仓库 + GitHub Pages（`*.github.io`）

**非目标（MVP 不做）：** 云端账号体系、服务端隐藏测例强校验、实时多人排行榜、商业级沙箱隔离。

---

## 2. 总体架构（Pages-first）

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Repository: scip-oj（建议）                      │
│                                                         │
│  main 分支 ──Actions 构建──► GitHub Pages                │
│       │                         │                       │
│       │                         ▼                       │
│       │              https://AmaneSuzuha000.github.io/scip-oj/ │
│       │                         │                       │
│       │              ┌──────────┴──────────┐            │
│       │              │ 前端壳（题库 UI）    │            │
│       │              │ + JupyterLite/内核  │            │
│       │              │ + 浏览器内 judge    │            │
│       │              └──────────┬──────────┘            │
│       │                         │ 学生本机 WASM 执行    │
│       │                         ▼                       │
│       │              PySCIPOpt / SCIP（emscripten）     │
│       │              或降级：SciPy HiGHS                 │
│       │                                                 │
│       └─ submissions/（可选）学生 PR 交作业              │
│       └─ .github/workflows/deploy-pages.yml             │
└─────────────────────────────────────────────────────────┘
```

**核心原则：** Pages 只负责「交付静态资源」；「跑代码 + 判分」全部在学生浏览器完成。

---

## 3. 技术选型

### 3.1 运行时（主路径 vs 降级）

| 层级 | 主路径（坚持 SCIP） | 降级路径（工程更稳） |
|------|---------------------|----------------------|
| 站点壳 | 静态 HTML/JS 或轻量 Vite 构建产物 | 同左 |
| Python in browser | **JupyterLite + xeus-python** | **Pyodide** |
| 求解器 | **PySCIPOpt（emscripten-forge WASM）** | `scipy.optimize.milp`（HiGHS） |
| 证据 | [PySCIPOpt #1226](https://github.com/scipopt/PySCIPOpt/issues/1226)、[example-milp](https://notebook.link/@AntoinePrv/example-milp)、[emscripten-forge pyscipopt](https://github.com/emscripten-forge/recipes/tree/main/recipes/recipes_emscripten/pyscipopt) | [Pyodide](https://pyodide.org)、SciPy milp 文档 |
| 部署模板 | [jupyterlite/xeus-lite-demo](https://github.com/jupyterlite/xeus-lite-demo) → Pages | 自建 `index.html` + pyodide CDN |
| 教学 API | `from pyscipopt import Model` | `from scipy.optimize import milp` |

**方案默认采用主路径。** 若构建失败或包体积过大导致弱网难用，文档中保留降级开关。

### 3.2 前端体验

| 组件 | 选型 | 说明 |
|------|------|------|
| 题目列表 / 题面 | Markdown → 静态 HTML 或前端渲染 | 题面与测例元数据分离 |
| 代码编辑器 | Monaco 或 CodeMirror 6 | Python 高亮；MVP 可用 JupyterLite 自带编辑器 |
| 提交 / 运行 | 调内核执行 `template` + `judge` | 超时（如 30–60s）+ 友好错误 |
| 进度 | `localStorage` | 本机进度；可选导出 JSON |
| COOP/COEP | 默认不需要；需要 WASM 线程时用 [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | Pages 不能自定义响应头 |

### 3.3 可选增强（仍属 GitHub，不算自建后端）

| 增强 | 作用 | 何时加 |
|------|------|--------|
| Actions 部署 Pages | 标准 CI 发布 | 第 1 天就加 |
| 学生 Fork + PR 交 `submissions/` | 作业存档 + commit 历史 | 第 2 周 |
| Actions 对 PR **重判** | 教师侧可信分数 | Phase 2 |
| Actions 生成静态 `leaderboard.json` | 伪排行榜 | Phase 2 |

---

## 4. 仓库结构（建议）

```
scip-oj/
├── README.md
├── LICENSE                     # 建议 MIT 或 Apache-2.0
├── environment.yml             # xeus + pyscipopt（主路径）
├── jupyter-lite.json           # JupyterLite 配置（若用模板）
├── .github/workflows/
│   ├── deploy.yml              # 构建 JupyterLite / 前端 → Pages
│   └── grade-pr.yml            # （Phase 2）PR 重判
├── site/                       # 自定义题库壳（可选，与 Lite 并列）
│   ├── index.html
│   ├── app.js
│   ├── judge-bridge.js         # 调用内核 / Pyodide
│   └── coi-serviceworker.js    # 可选
├── content/                    # JupyterLite 预置 notebook（可选）
│   └── tutorials/
├── problems/
│   ├── index.json              # 题单：id、标题、难度、标签、路径
│   ├── P001_knapsack/
│   │   ├── README.md           # 题面（中文）
│   │   ├── meta.json           # 时限、满分、容差、随机种子策略
│   │   ├── template.py         # 学生起点
│   │   ├── judge.py            # 性质验证（可公开）
│   │   ├── gen.py              # （可选）参数化出题
│   │   └── fixtures/           # 公开小测例（演示用）
│   ├── P002_blend_lp/
│   ├── P003_assignment/
│   ├── P004_jobshop_toy/
│   └── P005_network_flow/
├── judge/
│   ├── common.py               # EPS、可行性、整数性、目标 gap
│   └── report.py               # 统一返回 {score, passed, messages[]}
├── submissions/                # 学生 PR 投放区
│   └── .gitkeep
└── docs/
    ├── 学生指南.md
    ├── 出题指南.md
    └── 降级-HiGHS.md
```

---

## 5. 题目与判题规范

### 5.1 学生提交约定

学生实现约定入口，例如：

```python
# template.py
from pyscipopt import Model

def solve(instance: dict) -> dict:
    """
    输入: instance 字典（容量、价值、约束系数等）
    输出: {
      "status": "optimal" | "feasible" | ...,
      "objective": float,
      "solution": {变量名或索引: 值},
    }
    """
    ...
    return {"status": "optimal", "objective": obj, "solution": sol}
```

### 5.2 判分维度（满分 100 建议拆分）

| 项 | 分 | 规则 |
|----|----|------|
| 接口/格式 | 10 | 能解析返回结构 |
| 可行性 | 40 | 约束违反 ≤ `EPS_FEAS`（如 1e-5） |
| 整数性 | 10 | 整数变量偏差 ≤ `EPS_INT` |
| 目标质量 | 40 | 相对 gap ≤ 1e-4 满分；≤1%、5%、10% 给部分分 |
| 超时 | 0 | 内核/前端 `timeout` 杀掉，记失败 |

**不要**只比对「打印的最优值」——必须验可行性，否则学生可硬编码。

### 5.3 防硬编码（在无隐藏测例前提下）

1. **`gen.py` 参数化**：打开题目时用种子生成一组系数；`judge` 对当次实例验性质  
2. **多实例连跑**：一次提交跑 3–5 组随机实例，取平均分或全过才满分  
3. **参考最优**：可由教师在构建时预计算写入 `meta`（仍可被看到），但没有可行解只抄目标值过不了  

### 5.4 `judge.py` 伪代码

```python
from judge.common import check_feasibility, check_integrality, score_objective

def grade(solve_fn, instance, meta):
    try:
        out = solve_fn(instance)
    except Exception as e:
        return {"score": 0, "passed": False, "messages": [f"运行错误: {e}"]}

    score, msgs = 10, ["格式 OK"]
    ok, m = check_feasibility(out, instance, meta["eps_feas"])
    if not ok:
        return {"score": score, "passed": False, "messages": msgs + [m]}
    score += 40
    ok, m = check_integrality(out, instance, meta["eps_int"])
    if not ok:
        return {"score": score, "passed": False, "messages": msgs + [m]}
    score += 10
    s, m = score_objective(out["objective"], meta["opt"], meta["eps_obj"])
    score += s
    msgs.append(m)
    return {"score": score, "passed": score >= meta.get("pass_score", 100), "messages": msgs}
```

---

## 6. 页面交互流（类力扣）

1. 打开首页 → 题单（难度 / 标签：LP、MIP、调度、网络）  
2. 点进题目 → 渲染 `README.md` + 加载 `template.py` 到编辑器  
3. 「运行样例」→ 公开 fixture，只看输出  
4. 「提交评分」→ 生成/加载实例 → 执行 `solve` → 跑 `judge` → 展示分数与 messages  
5. 「保存进度」→ `localStorage`；「导出成绩」→ 下载 JSON  
6. （作业模式）按学生指南：Fork → 把代码放进 `submissions/<github_login>/P001.py` → 开 PR  

---

## 7. 构建与部署

### 7.1 environment.yml（主路径示意）

```yaml
name: xeus-kernel
channels:
  - https://repo.prefix.dev/emscripten-forge-dev
  - https://repo.prefix.dev/conda-forge
dependencies:
  - xeus-python
  - pyscipopt
  - numpy
```

> 实际 channel / 包名以构建时 emscripten-forge 最新可用名为准；CI 里锁版本。

### 7.2 Pages 设置

1. 仓库 Settings → Pages → Source: **GitHub Actions**  
2. `deploy.yml`：checkout → 构建 JupyterLite/前端 → `actions/upload-pages-artifact` → `deploy-pages`  
3. 站点地址：`https://AmaneSuzuha000.github.io/scip-oj/`（以最终仓库名为准）  
4. 若启用多线程 WASM：页面首屏加载 `coi-serviceworker.js`（须同源、勿打包进 bundle）

### 7.3 体积与首屏

- PySCIPOpt WASM + 内核体积可能数 MB～数十 MB：用 CDN/缓存、展示「首次加载进度条」  
- 弱网备选：降级路径文档（HiGHS / 更小包）  

---

## 8. 题库规划（首期 5 题）

| ID | 标题 | 知识点 | 求解器用法 |
|----|------|--------|------------|
| P001 | 0-1 背包 | 二元变量、目标最大化 | PySCIPOpt 建模 |
| P002 | 配料 LP | 连续变量、线性约束 | LP |
| P003 | 指派问题 | 二元、行列和约束 | 运输/指派 |
| P004 | 玩具 Job-Shop | 工序先后、机器互斥（简化） | MIP 或与 PyJobShop 思想对齐 |
| P005 | 最大流 / 最小费用流（简化） | 网络流建模 | 边容量、守恒 |

后续可接：分支定界直觉题、参数调优（时限内 gap）、与 [PyJobShop](https://github.com/PyJobShop/PyJobShop) 教学衔接的调度专题。

---

## 9. 分阶段路线图

### Phase 0（0.5–1 天）— 验通

- 从 xeus-lite-demo 建仓，`environment.yml` 加入 `pyscipopt`  
- Actions 成功部署到 Pages，浏览器里 `from pyscipopt import Model` 能跑通小例子  

### Phase 1（约 2 周）— MVP

| 周 | 交付 |
|----|------|
| W1 | 部署通；`judge/common.py`；P001–P002；最简提交按钮（Notebook 内或薄壳） |
| W2 | P003–P005；题单页；localStorage 进度；学生指南；导出成绩 JSON |

**MVP 验收标准**

- [ ] 手机热点下首次加载可完成（有进度提示）  
- [ ] 至少 5 题可提交得分  
- [ ] 故意硬编码目标值无法通过可行性检查  
- [ ] README 可让同学 10 分钟内开始做第 1 题  

### Phase 2（1–2 月）— 课程可用

- Monaco 力扣风 UI（若仍用 Lite，可 iframe + 自定义壳）  
- PR 作业流 + Actions 重判  
- 静态排行榜  
- 出题指南 + 更多题（15–20）  
- 可选：HiGHS 降级开关  

### Phase 3（按需）— 增强

- 仅当 Pages 客户端不够时：再引入 Judge0 / 小 VPS（**明确偏离纯 Pages**）  
- 查重（JPlag 等离线跑）  
- 与学校 LMS 对接  

---

## 10. 角色与分工（对应你之前的统筹方式）

| 角色 | 职责 |
|------|------|
| **你（GitHub Assistant 统筹）** | 需求边界、方案版本、仓库规范、验收、PR 审查、是否降级 |
| **Antigravity CLI / 云端编程代理** | 脚手架、CI、题与 judge 实现、前端壳 |
| **课程方（你本人）** | 定教学大纲、题意、是否必须 SCIP API、作业规则 |

---

## 11. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| emscripten-forge 上 pyscipopt 构建/体积问题 | 高 | Phase 0 先验通；失败则临时 HiGHS，文档标明 API 差异 |
| 浏览器内存 / 卡死 | 中 | 题规模上限；Web Worker；超时 |
| 学生改 judge / 改分 | 中 | 性质验证；作业靠 PR + Actions 重判 |
| Pages 无自定义头 | 低 | coi-serviceworker；或单线程 |
| Classroom 已下线 | 信息 | 不依赖 Classroom；用本仓库 + PR |

---

## 12. 许可与合规

- PySCIPOpt / SCIP：遵循其开源许可（注意 SCIP 学术使用惯例，课程场景通常可接受）  
- 学生代码默认私有交作业时可要求 private fork；公开刷题站注意不要泄露未发布考试题  

---

## 13. 成功定义（一句话）

> 学生只打开一个 GitHub Pages 链接，就能用 **Python + PySCIPOpt** 做题并拿到自动评分；教师零服务器运维，用仓库 + Actions 即可开课。

---

---

## 已冻结的产品决策（2026-10-21）

- **判分政策**：暂时只做 **L1（浏览器内判分）**；**L2（PR / Actions 重判）后补**。
- 计入成绩的规则待 L2 上线后再定；当前 L1 分数仅作练习反馈，文档中需向学生说明「可被本机篡改、不作正式成绩」。
- Phase 1 工程优先级：共用 `judge/` + 浏览器接入 + 防硬编码（性质验证 + 多 seed）；`grade-pr.yml` 可先放空模板，不作为 MVP 验收项。
- **L1 多实例计分**：对各实例得分取 **算术平均**（不是一票否决）。
- **L1 通过提示线**：`pass_score=90`。

## 14. 立即下一步（执行清单）

1. 创建公开仓库 `scip-oj`（或你指定的名字）  
2. 基于 xeus-lite-demo 接通 Pages + `pyscipopt`（Phase 0）  
3. 落地 `problems/P001` + `judge/common.py`  
4. 写 `docs/学生指南.md`  
5. 内测 3 人后冻结 MVP  

---

## 附录 A · 关键链接

- JupyterLite → Pages：https://jupyterlite.readthedocs.io/en/stable/quickstart/deploy.html  
- xeus-lite 模板：https://github.com/jupyterlite/xeus-lite-demo  
- PySCIPOpt 浏览器公告：https://github.com/scipopt/PySCIPOpt/issues/1226  
- 浏览器 MILP 示例：https://notebook.link/@AntoinePrv/example-milp  
- coi-serviceworker：https://github.com/gzuidhof/coi-serviceworker  
- 你的相关仓库：[PyJobShop fork](https://github.com/AmaneSuzuha000/PyJobShop)

## 附录 B · 与「纯 Actions 判题」方案的关系

此前调研中的「Pages 展示 + Actions 判题」仍然有效，但作为 **Phase 2 作业可信度增强**，不是 Pages-first 的前提。本方案主路径不依赖 Actions 才能得分。
