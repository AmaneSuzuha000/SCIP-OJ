# SCIP-OJ

系统建模与优化 · **全链路作业与判题平台**（WASM 客户端练习 + 服务端权威评测成绩中心）

- **OJ 站点（力扣壳）**：https://AmaneSuzuha000.github.io/SCIP-OJ/
- **教师面板**：https://AmaneSuzuha000.github.io/SCIP-OJ/teacher.html
- **JupyterLab (PySCIPOpt)**：https://AmaneSuzuha000.github.io/SCIP-OJ/lab/index.html
- **REPL 入口**：https://AmaneSuzuha000.github.io/SCIP-OJ/repl/index.html

---

## 运行模式与判分双轨制

SCIP-OJ 采用**双轨制**，兼顾轻量免配置练习与可信正式成绩：

| 层次 | 适用场景 | 运行方式 | 成绩记录 |
|---|---|---|---|
| **L1 练习轨** | 课堂即时自测、算法探索 | 浏览器内 WebAssembly 运行学生 Python 代码；多实例**算术平均**；通过线 **90** | **仅本地练习反馈**，记录在浏览器缓存，**不作正式课程成绩** |
| **JupyterLab** | MIP 建模交互调试 | 浏览器 WASM 预装 `xeus-python` + `pyscipopt`，支持 `from pyscipopt import Model` | 用于交互式建模实验、画图与调试 |
| **正式作业轨** | 课程正式作业提交与评定 | 学生在网页端登录账号直接点击「提交正式作业」；服务端通过 **GitHub Actions** 权威运行 PySCIPOpt 评测，HMAC 签名回调入库 | **正式课程成绩**：记录于数据库 `course_gradebook`，教师面板可查并支持 CSV 导出 |

> [!NOTE]
> **学生零摩擦**：学生提交正式作业**不需要**注册 GitHub 账号、无需 Fork 仓库、无需提 PR、无需关注 Actions 运行日志，所有交互直接在网页端完成。
> （原有 PR 自测流 `.github/workflows/l2-grade.yml` 保留供出题者与助教本地自测使用）。

---

## 功能与文档导航

- **平台阶段 1 架构与部署文档**：[docs/平台-阶段1.md](docs/平台-阶段1.md)
- **学生指南**：[docs/学生指南.md](docs/学生指南.md)
- **出题指南（教师）**：[docs/出题指南.md](docs/出题指南.md)
- **判分协议（已冻结）**：[docs/判分协议-已冻结.md](docs/判分协议-已冻结.md)
- **JupyterLab 示例 Notebook**：
  - `content/01_P001_knapsack_PySCIPOpt.ipynb`（背包问题 MIP 建模）
  - `content/02_P002_assignment_PySCIPOpt.ipynb`（指派问题 MIP 建模）

---

## 架构体系

1. **力扣壳前端 (`site/`)**：
   - 题单、Markdown 题面渲染、Python 代码编辑框。
   - **双按钮设计**：并列提供「⚡ L1 练习评分（浏览器 WASM）」与「🚀 提交正式作业（服务端评测）」。
   - **历史提交列表**：实时展示提交状态（排队中 `queued`、评测中 `running`、已完成 `done`、系统故障 `system_error`）与得分。
   - **无后端优雅降级**：无 `config.js` 时自动降级为「离线练习模式」，完全不干扰 L1 本地练习。
2. **服务端数据与 API (`supabase/`)**：
   - 核心数据库表：`profiles`（学号/姓名/角色）、`courses`、`enrollments`、`assignments`、`submissions`（代码哈希/不可变）、`gradings`、`grade_audits`（复判审计）。
   - 行级安全 (RLS)：学生仅见自己数据，教师仅见授课班级，评测结果独占写入。
   - Edge Functions：`submit-assignment`、`grade-callback`（HMAC 验签）、`regrade`。
3. **权威判卷 Runner (`.github/workflows/grade-submission.yml`)**：
   - 自动化触发、拉取学生代码，在 Linux 环境下安装 PySCIPOpt 进行多实例性质验证判分。
   - 异常隔离：若 runner 环境出现缺少依赖或系统故障，判定为 `system_error` 且分数置空，**绝不扣减为学生 0 分**。
4. **教师面板 (`site/teacher.html`)**：
   - 班级成绩簿（默认按 `highest_before_due` 截止前最高分汇总）、学生代码审阅、一键发起复判、一键导出 UTF-8 CSV。

---

## 仓库结构

- `site/` — 前端静态站点（力扣壳、教师面板、平台层鉴权 SDK）
  - `site/js/platform.js` — Supabase 鉴权、提交与成绩交互 SDK
  - `site/js/teacher.js` — 教师面板逻辑
  - `site/config.example.js` — 前端配置模板
- `supabase/` — 服务端数据库与云函数
  - `supabase/migrations/` — SQL 迁移脚本（表结构、RLS 策略、视图）
  - `supabase/functions/` — Deno Edge Functions
  - `supabase/seed.sql` — 演示数据
- `problems/` — 题库（P001 背包、P002 指派）
  - `problems/P001_knapsack/reference_pyscipopt.py` — P001 PySCIPOpt MIP 参考解答
- `judge/` — 性质验证评测内核（Python 实现）
- `.github/workflows/grade-submission.yml` — 平台端自动化评测流水线
- `platform/scripts/smoke_phase1.sh` — Phase 1 全链路自动化烟测脚本

---

## 本地全链路烟测

在本地快速验证评测契约、系统异常隔离、HMAC 验签与 SQLite 替身数据库生命周期：

```bash
./platform/scripts/smoke_phase1.sh
```
