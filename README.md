# SCIP-OJ

工业工程《系统建模与仿真》平台，按用途分为 **课程教学** 与 **拓展学习** 两个独立区域。默认进入课程教学。

- **课程教学**：班级、P001/P002 配套建模实验、编程作业、正式提交、成绩记录和教师管理。入口：`index.html#course`。
- **拓展学习**：开放仿真案例、SCIP/Gurobi 官方示例与四个进阶 Notebook。入口：`index.html#learn`。

- **精品案例总览 / 排队仿真**：https://AmaneSuzuha000.github.io/SCIP-OJ/case-studio.html
- **随机库存仿真**：https://AmaneSuzuha000.github.io/SCIP-OJ/inventory-lab.html
- **双工序生产线仿真**：https://AmaneSuzuha000.github.io/SCIP-OJ/flow-lab.html
- **Gurobi / SCIP 官方示例导航**：https://AmaneSuzuha000.github.io/SCIP-OJ/official-examples.html
- **OJ 站点（力扣壳）**：https://AmaneSuzuha000.github.io/SCIP-OJ/
- **教师控制台**：https://AmaneSuzuha000.github.io/SCIP-OJ/teacher.html
- **JupyterLab (PySCIPOpt)**：https://AmaneSuzuha000.github.io/SCIP-OJ/lab/index.html
- **REPL 入口**：https://AmaneSuzuha000.github.io/SCIP-OJ/repl/index.html

---


## 拓展学习：开放案例与建模资源

拓展案例按 **情境 → 系统抽象 → 模型假设 → 仿真 → 实验设计与统计 → 工程决策** 组织。它们拥有独立的导航与学习入口，不并入课程作业、提交记录或教师成绩管理。

**已实现三套独立可运行的仿真案例：IE-DES-01 / IE-MC-02 / IE-DES-03**

- 使用合成数据搭建多工位 FCFS 离散事件模型，控制随机到达间隔、检修工时、工位数、预热时间和仿真时长；
- 固定随机种子、共用随机数与多次配对独立重复，对比平均等待、完成率、工位利用率、队列长度及 WIP；
- 展示配对等待差值的 95% 正态近似置信区间、负荷率警示、CSV 复现实验导出；
- **IE-DES-01 可核验实验记录**：另可导出按重复编号的 JSON；独立 Python 参考实现逐条复算原始随机流、FCFS 事件与置信区间。详见 [IE-DES-01 教师实验指导书](docs/IE_DES_01_精品案例实验指导书.md)。重放核验不证明作者身份，也不作为 L2 正式成绩；
- **仅供课堂学习，不上传个人数据、不写入正式成绩**；这里的检修数据是教学假设，不是企业实测。

- **IE-MC-02《随机库存与服务水平》**：Poisson 日需求、周期检查补货、确定提前期、丢失销售、运营成本/填补率，配对 Monte Carlo 与导出。
- **IE-DES-03《双工序生产线与缓冲阻塞》**：Poisson 到达、指数工时、有限缓冲与加工后阻塞 BAS、产出/WIP/阻塞率，配对 DES 与导出。
- **IE-OPT-03《容量约束设施选址》Notebook**：3 设施×4 客户，独立穷举 81 个分配对照。
- **IE-OPT-04《仓储装箱》Notebook**：物品—容器 MILP 与独立回溯装箱真值。
- **IE-OPT-05《排列流水车间》Notebook**：位置索引调度模型与 4! 排列枚举真值。
- **IE-OPT-06《单周期随机库存优化》Notebook**：随机需求场景 MILP 与 0～10 件订货量穷举。
- **官方 Examples 资源页**：直接链接 PySCIPOpt 官方背包、EOQ、设施选址、排列流水车间、装箱与资源受限调度，以及 Gurobi Modeling Examples；只提供来源和自主课程模型。

AGV 物流、设备可靠性和动态闭环调度是后续三类进阶方向，**尚未上线**。正式 L2 判题仍仅支持已接入私有评测的题型。教学 Rubric 与模型验证见 [课程实验与评价规范](docs/课程实验与评价规范.md) 和 [精品案例建设路线](docs/课程精品案例建设路线.md)。课程质量验收 Gate 与建模口径见 [精品案例建设路线](docs/课程精品案例建设路线.md)。

## 运行模式与判分双轨制

SCIP-OJ 采用**双轨制**，兼顾轻量免配置练习与可信正式成绩：

| 层次 | 适用场景 | 运行方式 | 成绩记录 |
|---|---|---|---|
| **L1 练习轨** | 课堂即时自测、算法探索 | 浏览器内 WebAssembly (Pyodide) 运行学生 Python 代码；多实例**算术平均**；通过线 **90** | **仅本地练习反馈**，记录在浏览器缓存，**绝不作为正式课程成绩** |
| **JupyterLab** | MIP 建模交互调试 | 浏览器 WASM 预装 `xeus-python` + `pyscipopt`，支持 `from pyscipopt import Model` | 用于交互式建模实验、画图与调试 |
| **正式作业轨** | 课程正式作业提交与评定 | 学生在网页端使用 GitHub OAuth 登录并绑定学号，输入邀请码选课；服务端通过 **GitHub Actions 隔离 Docker / PySCIPOpt** 运行私有随机测试，可信主进程独立判分，按评分任务 UUID + Actions 运行引用 HMAC 签名回调入库 | **正式课程成绩**：持久化记录于数据库 `course_gradebook`，教师面板可查、支持证据核验、批量复判与 CSV 导出 |

> [!NOTE]
> **上线前的必要验收**：现有正式评分流程仍需冻结每次提交对应的评分配置与测试协议、实现原子入队和失败恢复，并通过真实师生 E2E（追踪：[#20](https://github.com/AmaneSuzuha000/SCIP-OJ/issues/20)）。该说明不否定既有已验证的网页提交路径。
>
> **学生零摩擦**：学生提交正式作业使用 **GitHub OAuth 身份识别**，但**绝不需要**自己开 PR、不需要 Fork 仓库、也不需要看 Actions 运行细节，所有操作直接在主站力扣壳完成。
> 平台提供学号门禁、选课门禁与系统异常保护（`system_error` 绝不误判学生为 0 分）。

---

## 教师核验考试身份 V5

普通作业继续支持网页登录后提交；**考试提示/限制模式**额外要求本课程教师先通过花名册人工核实学号和 GitHub OAuth 账户。自行填写学号只形成待核实匹配，不算已核验；修改匹配信息将自动作废原确认。教师在花名册页确认后，服务端才允许正式考试提交。详情见 [V5 考试身份验证安全模型](docs/SECURITY_VALIDATION_V5.md)。

---

## 数据库权限与邀请码安全 V4

线上数据库已收紧匿名角色的表权限和 RLS 无法覆盖的 TRUNCATE 权限。选课邀请码现在可事务性轮换并撤销旧码，名额限制和选课入库由单个 PostgreSQL RPC 原子处理；学生/教师网页不再直接写邀请码表。详情见 [V4 数据库安全门控与未完成验收](docs/SECURITY_VALIDATION_V4.md)。

---

## 评测安全与考试诚信

正式作业在网络隔离、非 root Docker 容器中执行学生源码，不向其传递服务端测试种子、最优目标值、评分器和数据库凭据；教师可选择普通、监测提示、限制粘贴模式。浏览器禁粘贴和行为统计均可绕过，**不能直接认定作弊**。代码相似度审查为教师离线人工复核工具。

- [考试模式、隐私、相似度审查与剩余安全门槛](docs/ANTI_CHEATING_AND_EXAM_INTEGRITY.md)
- [正式判题隔离容器](judge/Dockerfile.sandbox) · [隔离判分器](judge/runner_l2_isolated.py)
- **仅网页提交，旧 PR 判题工作流已停止使用。**

---

## 功能与文档导航

- **平台阶段 3 前后端全面打磨指南（最新）**：[docs/平台-阶段3.md](docs/平台-阶段3.md)
- **平台阶段 2 架构与运营指南**：[docs/平台-阶段2.md](docs/平台-阶段2.md)
- **平台阶段 1 架构与部署文档**：[docs/平台-阶段1.md](docs/平台-阶段1.md)
- **学生使用指南**：[docs/学生指南.md](docs/学生指南.md)
- **教师与助教指南**：[docs/教师指南.md](docs/教师指南.md)
- **出题指南（教师）**：[docs/出题指南.md](docs/出题指南.md)
- **判分协议（已冻结）**：[docs/判分协议-已冻结.md](docs/判分协议-已冻结.md)
- **JupyterLab 示例 Notebook**：
  - `content/01_P001_knapsack_PySCIPOpt.ipynb`（背包问题 MIP 建模）
  - `content/02_P002_assignment_PySCIPOpt.ipynb`（指派问题 MIP 建模）
  - `content/03_IE_Facility_Location_PySCIPOpt.ipynb`（单源设施选址）
  - `content/04_IE_Bin_Packing_PySCIPOpt.ipynb`（装箱）
  - `content/05_IE_Flow_Shop_PySCIPOpt.ipynb`（排列流水车间）
  - `content/06_IE_Stochastic_Inventory_PySCIPOpt.ipynb`（单周期随机库存优化）

---

## 正式提交限流与私有测试（V3）

- 正式提交由 PostgreSQL **事务级限制**：同题两次提交至少间隔 20 秒，每道作业每小时最多 12 次，每位用户每日最多 60 次；触发限制返回 HTTP 429，**不产生虚假成绩或提交记录**，本地练习不受影响。
- 服务端使用加锁序号和数据库唯一索引保证并发提交不产生重复 `attempt_no`。
- 正式 L2 评测使用独立随机实例族：背包规模 16–30 个物品，指派规模 6–9 人，最优值只在可信主机计算。浏览器 L1 继续使用小规模教学题。
- 内部开发用的 `GRADE_RUNNER=mock` 不得在生产意外给学生固定分；需额外显式设置 `SCIP_OJ_ALLOW_MOCK_GRADES=true` 才启用。
- 部署详情与安全限制：[正式评测 V3 验收说明](docs/SECURITY_VALIDATION_V3.md)。

---

## 核心教学运营能力

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
6. **现代化 OJ 交互体验 (Phase 3 打磨)**：
   - LeetCode 式题单列表/卡片、搜索筛选、双栏代码编辑器、JSON 自定义测试与深浅对比教学视觉系统；
   - 模块化 Edge Functions 架构（`_shared/` 统一 CORS、JWT 鉴权、Secrets 解析与 GitHub 触发）；
   - 数据库 005 安全防护（防止普通用户提权修改 `profiles.role`，补齐核心索引）。

---

## 本地自动化全链路烟测

仓库提供 3 套端到端自动化业务烟测脚本：

```bash
# 1. Phase 1 评测引擎、系统异常隔离与 HMAC 回调验签自测
./platform/scripts/smoke_phase1.sh

# 2. Phase 2 邀请码、花名册对齐、作业发布、迟交标记、批量重判与 CSV 烟测
./platform/scripts/smoke_phase2.sh

# 3. Phase 3 前端静态代码无密钥扫描、Edge 共享模块、005 安全迁移与 UI 完整性深度验证
./platform/scripts/smoke_phase3.sh
```
