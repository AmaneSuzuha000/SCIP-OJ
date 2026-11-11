# SCIP-OJ

工业工程《系统建模与仿真》在线编程与建模实验平台（React 19 单页应用 + Supabase/PostgreSQL + GitHub Actions 无网络 Docker 隔离判题）。

线上站点：https://amanesuzuha000.github.io/SCIP-OJ/

- **课程教学**：班级管理、作业工作台（题目阅读 / CodeMirror 编辑器 / 本地自测 / 正式提交）、实时评测报告（`F/C/I/O` 与私有实例明细）、提交记录回放与班级排行榜。
- **拓展学习**：11 个内置交互式 PySCIPOpt 建模 Notebook 课程（`P001`、`P002`、`IE-OPT-03` 至 `IE-OPT-11`），浏览器本地直接执行，无需安装配置。
- **课程指南与规范**：[课程学习路径](docs/课程学习路径.md) · [学生使用指南](docs/学生指南.md) · [拓展学习指南](docs/拓展学习指南.md) · [课程实验与评价规范](docs/课程实验与评价规范.md)。

---

## 快速启动与构建

```bash
# 前端开发与测试
npm --prefix web ci
npm --prefix web run dev
npm --prefix web run typecheck
npm --prefix web test

# 前端生产构建（同时缓存并注入 Pyodide + SciPy/NumPy WASM 运行时）
npm --prefix web run build

# 拼装 GitHub Pages 发布产物（只含应用、runtime 与 docs 白名单，严格剔除 problems/）
python scripts/assemble_site.py --web-dist web/dist --output dist
```

---

## 双轨运行架构：浏览器本地练习 vs. 服务端可信评测

平台严格分离**浏览器练习路径**与**服务端正式评分路径**：

| 轨道 | 适用场景 | 执行引擎 | 成绩效力 |
|---|---|---|---|
| **浏览器本地练习 / 拓展学习** | 11 课互动学习、作业工作台「本地自测」 | Web Worker 内加载 Pyodide（CPython WASM）+ SciPy HiGHS 兼容层 [`web/public/runtime/pyscipopt.py`](web/public/runtime/pyscipopt.py)，首屏按需懒加载 | **仅本地反馈，绝不计入正式成绩** |
| **服务端 L2 正式评测** | `P001`（0-1 背包）、`P002`（指派优化） | `submit-assignment` Edge Function → PostgreSQL 原子入队 → GitHub Actions 调起无网络非 root Docker 沙箱 [`judge/Dockerfile.sandbox`](judge/Dockerfile.sandbox) 运行原生 PySCIPOpt，可信宿主进程计算精确真值与评分并 HMAC 签名回调入库 | **唯一正式成绩**，持久化于 `course_gradebook`，教师台支持审阅、单条/批量复判与导出 |

> **系统故障保护机制**：当评测任务在 Runner 启动或回调阶段出现基础设施错误时，系统状态标记为 `system_error`（界面展示“系统异常，不计分”），**绝不误判为 0 分**；教师可在控制台执行单条或批量复判，也可由定时调度工作流 `recover-gradings.yml` 自动重租约调度恢复。

---

## 核心教学与安全能力

1. **访问控制与身份对齐**：
   - 白名单门禁控制站点登录入口（GitHub OAuth 授权 + `site_access_only` 数据库访问策略）；
   - **选课与邀请码**：教师轮换/撤销班级邀请码与设置名额上限，学生通过原子 RPC [`join_course_by_code`](supabase/migrations/20261112000000_audit_fixes.sql) 加入班级；
   - **花名册双向对齐与身份核验**：支持导入学生花名册 CSV（自动去 BOM、支持引号与字母数字混合学号），支持学生绑号后自动匹配以及教师在花名册中人工核验；修改学号或清空学号会自动失效旧核验记录，防止越权复用。
2. **考试防作弊分层策略**：
   - 教师可在发布或编辑作业时按题目设置 `standard`（常规）、`exam_warn`（编辑/粘贴/切屏行为采样监测）与 `exam_block`（禁用代码编辑器粘贴，并在服务端强制要求已绑定学号且经教师花名册核验方可提交）。
   - 客户端行为统计与禁贴均可被本地绕过，仅作为教学监测与辅助复核依据，不单独作为违规自动裁决依据；代码相似度离线审查脚本位于 [`scripts/audit_similarity.py`](scripts/audit_similarity.py)。
3. **教师控制台与成绩单**：
   - 单页集成 4 个工作标签页：**邀请码**、**花名册与核验**、**作业发布**（支持配置题目、截止时间、及格分、实例数、计分规则与诚信策略，无需手写 SQL）与 **提交与成绩**（支持成绩簿聚合查看、不可变提交源码与评测明细弹窗审阅、单条复判、多选/整班批量复判 `regrade-batch`，以及带 UTF-8 BOM 与 CSV 公式注入防护的成绩单导出）。
4. **班级脱敏排行榜**：
   - `get_course_leaderboard` 仅汇总在籍学生有效正式成绩，教师/助教自测提交不混入学生排名，学号在服务端自动脱敏（如 `2026****01`）。

---

## 仓库目录结构

- `web/`：React 19 + TypeScript + Vite 前端单页应用与 Pyodide Web Worker。
- `supabase/`：PostgreSQL 数据库迁移（含安全加固、RPC 与触发器）与 Deno Edge Functions（`submit-assignment`、`regrade`、`regrade-batch`、`grade-callback`、`join-course`、`publish-assignment`）。
- `judge/` & `problems/`：无网络 Docker 沙箱容器定义、有限管道/超时隔离执行器（`judge/sandbox.py`）、可信评分器（`judge/common.py`、`judge/runner_l2_isolated.py`）以及 `P001`、`P002` 私密测试生成器与参考题解（构建发布时**严禁进入前端输出**）。
- `content/`：11 套课堂交互式 PySCIPOpt Notebook 源定义（供前端构建脚本与 CI 容器真值回归共享）。
- `docs/`：对外发布文档真源（由 `scripts/gen-docs.mjs` 同步打包进前端文档阅读器，[ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md) 仅留存仓库内部不公开发布）。
- `scripts/`：前端内容生成（`gen-docs.mjs`、`gen-problems.mjs`、`gen-lessons.mjs`）、站点组装（`assemble_site.py`）、Actions 签名传输（`grading_transport.py`）、Notebook WASM 兼容层自检（`check_notebooks_shim.py`）、评分基线校验（`parity_report.py`）及并发压测工具（`loadtest_submit.mjs`）。

---

## 全量测试与验证命令

```bash
# Python 后端/判题单元测试 & JS 核心契约回归（含 pyscipopt 兼容层与传输单测）
npm test

# PostgreSQL 真实迁移、权限、并发抢占、双向对齐与站点准入回归（本地嵌入式 PGlite / CI PostgreSQL 17）
npm run test:database
node tests/test_site_access_database.mjs

# P001 / P002 评分契约与分档得分基线一致性校验（56 组基线用例）
npm run test:parity

# 11 课 Notebook 与 P001/P002 解法在浏览器 PySCIPOpt 兼容层下的端到端自检
python scripts/check_notebooks_shim.py

# 前端严格类型检查 + Vitest + 构建打包
npm --prefix web run typecheck && npm --prefix web test && npm --prefix web run build
```
