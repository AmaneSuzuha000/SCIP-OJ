# SCIP-OJ

系统建模与优化 · **全链路作业与评测平台**（WASM 客户端练习 + 服务端权威评测 + 教学运营管理中心）

- **OJ 站点（力扣壳）**：https://AmaneSuzuha000.github.io/SCIP-OJ/
- **教师控制台**：https://AmaneSuzuha000.github.io/SCIP-OJ/teacher.html
- **JupyterLab (PySCIPOpt)**：https://AmaneSuzuha000.github.io/SCIP-OJ/lab/index.html
- **REPL 入口**：https://AmaneSuzuha000.github.io/SCIP-OJ/repl/index.html

---

## 运行模式与判分双轨制

SCIP-OJ 采用**双轨制**，兼顾轻量免配置练习与可信正式成绩：

| 层次 | 适用场景 | 运行方式 | 成绩记录 |
|---|---|---|---|
| **L1 练习轨** | 课堂即时自测、算法探索 | 浏览器内 WebAssembly 运行学生 Python 代码；多实例**算术平均**；通过线 **90** | **仅本地练习反馈**，记录在浏览器缓存，**不作正式课程成绩** |
| **JupyterLab** | MIP 建模交互调试 | 浏览器 WASM 预装 `xeus-python` + `pyscipopt`，支持 `from pyscipopt import Model` | 用于交互式建模实验、画图与调试 |
| **正式作业轨** | 课程正式作业提交与评定 | 学生在网页端使用 GitHub OAuth 登录并绑定学号，输入邀请码选课；服务端通过 **GitHub Actions** 权威运行 PySCIPOpt 评测，HMAC 签名回调入库 | **正式课程成绩**：记录于数据库 `course_gradebook`，教师面板可查、支持证据核验、批量复判与 CSV 导出 |

> [!NOTE]
> **学生零摩擦**：学生提交正式作业使用 **GitHub OAuth 身份识别**，但**绝不需要**自己开 PR、不需要 Fork 仓库、也不需要看 Actions 运行细节，所有操作直接在主站力扣壳完成。
> 平台提供学号门禁、选课门禁与系统异常保护（`system_error` 绝不误判学生为 0 分）。

---

## 功能与文档导航

- **平台阶段 2 架构与运营指南（最新）**：[docs/平台-阶段2.md](docs/平台-阶段2.md)
- **平台阶段 1 架构与部署文档**：[docs/平台-阶段1.md](docs/平台-阶段1.md)
- **学生使用指南（阶段 2）**：[docs/学生指南.md](docs/学生指南.md)
- **教师与助教指南（阶段 2）**：[docs/教师指南.md](docs/教师指南.md)
- **出题指南（教师）**：[docs/出题指南.md](docs/出题指南.md)
- **判分协议（已冻结）**：[docs/判分协议-已冻结.md](docs/判分协议-已冻结.md)
- **JupyterLab 示例 Notebook**：
  - `content/01_P001_knapsack_PySCIPOpt.ipynb`（背包问题 MIP 建模）
  - `content/02_P002_assignment_PySCIPOpt.ipynb`（指派问题 MIP 建模）

---

## 阶段 2 核心教学运营能力

1. **选课与邀请码机制**：
   - 课程支持分配与轮换公开邀请码（如 `SCIP2026-FALL`）；
   - 支持设置有效期与名额上限；学生在前端弹窗输入邀请码即可一键加入教学班。
2. **学号绑定与花名册自动对齐**：
   - 教师可直接在控制台导入学生 CSV 花名册（学号、姓名、可选 GitHub 账号）；
   - 学生 GitHub 登录后绑定同学号，系统自动双向对齐，成绩自动归档到对应学号；
   - 提交前学号与选课智能门禁拦截（教师账号免门禁）。
3. **教师评测证据台与批量复判**：
   - **评测证据台**：直接审阅不可变只读源码、结构化 `report_json` 与评测流转时间线；
   - **复判机制**：支持单条证据复判、多选批量复判与整题一键重判，完整记录 `grade_audits` 审计日志；
   - **迟交标记**：超过截止时间的提交自动打上红色「迟交」标记；
   - **导出 CSV**：前端生成包含 UTF-8 BOM 的标准化成绩单，Excel 打开无乱码。
4. **作业发布与管理（免改代码）**：
   - 教师直接在控制台表单中选择题目、截止时间、及格线（默认 90）、测试实例数（默认 3）与计分规则（默认截止前最高分）；
   - 一键保存发布至 `assignments`，无需手写 SQL。
5. **只读课程排行榜**：
   - 提供班级题目最高分排行榜，学号自动脱敏处理（`2026****01`），兼顾教学激励与隐私合规。

---

## 本地自动化全链路烟测

仓库提供两个端到端自动化业务烟测脚本：

```bash
# 1. Phase 1 评测引擎、系统异常隔离与 HMAC 回调验签自测
./platform/scripts/smoke_phase1.sh

# 2. Phase 2 邀请码、花名册对齐、作业发布、迟交标记、批量重判与 CSV 烟测
./platform/scripts/smoke_phase2.sh
```
