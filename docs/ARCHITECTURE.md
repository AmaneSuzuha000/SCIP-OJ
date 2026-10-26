# SCIP-OJ 架构与重构方案

核查日期：2026-10-26。当前代码基线：`fdc22a25bf1090ea8954a3f103dfc56cabc9f43e`。

本文区分已实现行为、源码中发现的缺口和拟议设计。未连接生产数据库核对迁移部署情况，未执行真实师生账号的正式成绩提交。外部项目仅做源码与官方文档对标，未部署，也未复制其实现。

## 决策

保留 GitHub Pages、Supabase、隔离 Docker 判题及 JupyterLite / xeus-python / PySCIPOpt。先固定正式提交、评测和成绩的合同，再迁移前端模块。课程教学与拓展学习继续独立；拓展案例不自动进入课程成绩。

不将四个平台拼接成四个新服务。PrairieLearn 用于参考教学和评测任务模型，Hydro 用于参考题目、记录和作业边界，DMOJ 用于参考执行与校验分离，QingdaoU 用于参考页面、API 与判题调度分离。

前端建议采用 Vite + TypeScript，随后按功能迁入 Vue 3。这是一项实施选择，不是外部对标证明的唯一技术答案；切换框架不能替代状态、接口和样式边界的梳理。每次迁移只保留一份业务实现，避免长期并存两套平台。

## 已完成的基础

本轮正式评测改造的实现与部署合同见 [正式提交与成绩契约](GRADING_CONTRACT.md)。下文缺口表记录原审计基线，不表示后续实现仍缺少相同功能；部署状态应以该改动的实际验收记录为准。

- PR #32：编辑器和作业内 Notebook 使用同一运行适配器；唯一 `submission` 单元同步提交源码；其他实验单元不进入正式提交。移除旧 Pyodide 分支。
- PR #32：门户与 JupyterLite 独立构建，运行环境完整部署到 `/notebooks/`；根目录 `docs/` 为文档唯一来源。
- PR #33：Notebook 占满工作区，返回代码视图恢复题目与编辑器布局。
- 实际运行、源码同步、实验笔记保留及超时恢复已通过真实浏览器测试。正式师生提交与成绩验收仍待完成。

详细行为见 [运行与作业契约](WORKBENCH_RUNTIME_CONTRACT.md)。下面的计划不重复建设上述功能。

## 四个项目的源码对标

下列链接固定到本次读取的提交，避免默认分支变化后无法复核。每项结论仅限列出的源码范围。

| 项目与固定版本 | 目录、界面和 API 边界 | 数据与评测生命周期 | 对 SCIP-OJ 的取舍 |
| --- | --- | --- | --- |
| [PrairieLearn `7bc0684`](https://github.com/PrairieLearn/PrairieLearn/tree/7bc06844ff1a98fe87f71571e080e763a29af893) | `apps/prairielearn/src/pages/` 按教学页面组织；`src/lib/externalGrader*.ts` 管外部评测；`apps/grader-host/` 管执行端。教师人工评分页面有局部组件，不等于全站纯 SPA | `database/tables/` 分开 `assessments`、`assessment_instances`、`submissions`、`grading_jobs`；任务记录请求、接收、开始和完成时间；外部评分支持队列，源码另有死信处理 | 借鉴教学对象、任务审计和失败处理；不引入其整套数据库、AWS 基础设施或企业功能 |
| [Hydro `0dba6c4`](https://github.com/hydro-dev/Hydro/tree/0dba6c4ac1870a96ef83dc2b0e514142181b7075) | `packages/hydrooj/src/handler/` 与 `model/` 分开；`packages/ui-default/` 管模板及页面资源；`packages/hydrojudge/` 管评测 | `model/record.ts` 管提交记录，`model/task.ts` 管任务及消费并发；`handler/homework.ts` 单列作业；`common/status.ts` 共享状态。任务获取使用数据库原子删除，这不能单独证明端到端不丢任务 | 借鉴题目、作业、提交和状态的职责划分；不移植 MongoDB、插件框架或假设其任务语义可原样复用 |
| [DMOJ 平台 `6aaddea`](https://github.com/DMOJ/online-judge/tree/6aaddea6aaeabf4927b83787714509ff9fff8897) / [判题端 `1245dc4`](https://github.com/DMOJ/judge-server/tree/1245dc4158dbb9e906c4c103e1ea939e012ee79b) | 平台 `judge/models/`、`views/`、`bridge/` 分开；判题端 `dmoj/executors/`、`graders/`、`checkers/` 分开 | 平台区分任务进度 `status` 和判题结论 `result`，保留测试点记录；`problem.py` 解析测试组、分值和依赖；`graders/standard.py` 执行后调用 checker，接受布尔或带分数的校验结果 | 借鉴执行、可信校验、分数聚合三层；数学规划题继续验证解的可行性、重算目标值和质量，不改成单纯标准输出匹配 |
| [QingdaoU 后端 `df87327`](https://github.com/QingdaoU/OnlineJudge/tree/df873278ab1b29510aa3a0979677d7aa9a53ca0e) / [前端 `44fa474`](https://github.com/QingdaoU/OnlineJudgeFE/tree/44fa4744c21ad5098c21b1c5d974f4413a171319) | Django 按 `problem/`、`submission/`、`contest/` 分模块；前端分 `pages/oj/`、`pages/admin/`，各有 API 与路由；Vue 页面通过 API 层访问服务 | `judge/tasks.py` 提交后台任务，`dispatcher.py` 选择评测机、调用 JudgeServer、更新测试点与总分；选择评测机时使用事务锁，无空闲机器时进入等待队列 | 借鉴页面不直接调度执行器、API 不夹杂 DOM 的边界；不照搬旧 Vue、认证、队列或整个 JudgeServer 协议 |

主要核查文件：

- PrairieLearn：`database/tables/grading_jobs.pg`、`assessment_instances.pg`；`apps/prairielearn/src/lib/externalGraderSqs.ts`、`externalGraderResults.ts`、`externalGraderDeadLetters.ts`；`apps/grader-host/src/lib/gradingResultMessage.ts`。
- Hydro：`packages/hydrooj/src/model/record.ts`、`task.ts`、`handler/homework.ts`；`packages/hydrojudge/src/task.ts`、`judge/default.ts`；`packages/ui-default/templates/record_detail.html`。
- DMOJ：平台 `judge/models/submission.py`、`judge/bridge/judge_handler.py`；判题端 `dmoj/problem.py`、`graders/standard.py`、`checkers/`。
- QingdaoU：后端 `submission/models.py`、`judge/tasks.py`、`judge/dispatcher.py`；前端 `src/pages/oj/api.js`、`views/submission/`、`src/store/modules/user.js`。

官方文档：[PrairieLearn 外部评分](https://docs.prairielearn.com/externalGrading/)、[DMOJ](https://docs.dmoj.ca/)、[JupyterLite iframe 通信](https://jupyterlite.readthedocs.io/en/stable/howto/configure/advanced/iframe.html)。

## 当前代码的具体缺口

| 优先级 | 可复核证据 | 影响与修复方向 |
| --- | --- | --- |
| 先做 | `supabase/functions/submit-assignment/index.ts` 分别写入 `submissions`、`gradings`，第二次失败后另发删除请求；`010_submission_atomic_quota.sql` 只保护提交配额及次数 | 配额原子化不等于完整入队原子化；进程中断或补偿删除失败仍可能留下不完整记录。用一次数据库事务创建提交、评测和派发待办 |
| 先做 | 同一函数和 `_shared/github.ts` 同步调用 workflow dispatch，异常后写 `system_error`；`.github/`、`supabase/`、`scripts/` 未发现对应定时恢复器 | 提示“等待重试”尚无仓库内自动恢复依据。增加持久派发待办与恢复器；HTTP 响应丢失时可能已经派发，必须允许安全重复派发 |
| 先做 | `.github/workflows/grade-submission.yml` 通过 `grading_id + submission_id + queued` 条件认领；`grade-callback` 校验签名、任务归属和终态 | 这些保护已存在，应保留。补取消、平台故障、回调失败后的对账；不能把所有异常再次评分或记成学生零分 |
| 先做 | `assignments.scoring_policy_version` 已有字段，但 workflow 使用执行时读取的 `pass_score`、`n_instances`；dispatch 固定 `main`，checkout 未按每次评测冻结提交 | 版本字段尚未形成可重现执行合同。记录配置快照、评分器提交、题目版本、实例集标识和镜像摘要；后续改作业或合并代码不能悄悄改变排队中的评分 |
| 接着做 | 学生 `app.js` 和教师 `teacher.js` 取 `gradings[0]` 显示最新任务；成绩簿迁移 `008` 先选每份提交最新成功评分 | “当前任务失败”和“仍有有效成绩”是两件事，现有不同页面可能给出不同表象。共享 DTO 同时返回 `latestAttempt` 与 `effectiveGrade`，分别展示任务状态和有效成绩 |
| 接着做 | `platform.js` 同时包含客户端、认证、服务调用及 DOM；`teacher.js` 仍直接查询嵌套 submissions/gradings；三个主 JS 文件分别约 1262、1635、1128 行 | 问题在跨层职责，而非单纯文件长度。先抽共享 API 与状态选择函数，再按课程、工作台、提交、教师拆页面 |
| 随前端迁移 | 首页依次加载基础、刷新、编辑器、工作台、分区等样式，教师页又叠加另一组样式 | 多文件本身不必然错误，但顺序覆盖难以界定所有权。按组件归并选择器，建立视觉基线后逐段移除旧规则；不再增加下一版覆盖文件，也不直接拼接所有 CSS |
| 随运行适配器迁移 | `python_runtime.js` 访问 `window.jupyterapp`、服务管理器、Notebook model 和 commands | 已集中在一处，但存在升级耦合。将模型操作放入 Lite 扩展，门户仅使用窄通信接口；不能用“换成 postMessage”直接替代源码同步、文件存储与超时隔离的实际实现 |

证据限定：以上为当前仓库静态审计，不证明生产环境已经应用全部 SQL，也不证明外部未部署其他调度器。

## 数据合同与任务生命周期

延续现有 `submissions` 与 `gradings`，避免另造含义相同的 `jobs` 表。新增的派发待办只描述传输与重试，不保存第二份正式分数。

| 对象 | 唯一职责 | 必须稳定的字段或约束 |
| --- | --- | --- |
| `assignments` | 发布规则与当前配置 | 课程、题目、截止时间、成绩选择策略、考试策略；改配置要有明确历史规则 |
| `submissions` | 不可变提交快照 | 用户、作业、源码及哈希、服务端接收时间、提交序号；新增作用域内唯一的请求幂等键 |
| `gradings` | 针对一份提交的一次评测 | 独立 ID、状态、配置快照、评分器/题目版本、运行归属、起止时间、结果、故障原因；复判新增记录 |
| 拟新增派发待办 | 可靠触发执行器 | grading ID、派发次数、下次执行时间、租约、最近错误；每个 grading 一份待办，消费失败不丢记录 |
| `grade_audits` | 教师操作与分数变更审计 | 操作人、原因、旧/新评分关联；与复判创建原子落库，结果回填可对账 |
| 成绩读取 DTO | 各界面一致解读成绩 | `latestAttempt`、`effectiveGrade`、成绩策略依据；前端不自行重算最终课程成绩 |

拟议行为：

1. 学生请求携带幂等键。服务端在单个事务内检查权限、作业规则和配额，写入 submission、首个 queued grading、派发待办；事务整体成功才返回“已保存”。相同键和相同请求返回原结果，不再次扣次数；同键不同源码或作业返回冲突。
2. 派发器通过有期限租约领取待办，调用 Actions。收到 dispatch 接受响应只表示传输被接受，不能将 grading 标记成已运行；Actions 仍用现有条件更新认领 queued grading。网络超时重发可能产生多个 workflow，只有成功认领者可以评分。
3. queued 表示已保存待处理；running 表示已认领；done 表示可信评测完成；system_error 表示基础设施故障且 `score=null`。学生程序错误、不可行解和低质量解属于完成后的评分结论，不等同于系统故障。
4. 回调保留 HMAC、grading/submission 绑定及 runner 归属检查。同一终态重复回调不重复计分；冲突回调记录并拒绝。重试创建新的 grading；不把终态重新改回 queued。
5. 恢复器按租约、排队时限及运行时限对账，结合 Actions 状态处理未启动、取消、超时和丢失回调。达到重试上限后明确展示系统故障并允许教师恢复。时限、重试上限和并发必须可配置，并以课堂压测决定。
6. 保留已有成绩簿规则：每份提交选最新成功评测，再按作业策略选择课程成绩；新的排队或故障评测不抹去旧有效分数。教师修改及格线或计分策略时，明确是仅影响新任务还是发起带审计的重新计算。

拟议 API 应返回 `submission_id`、`grading_id`、状态及有效成绩引用。幂等响应不得重新检查冷却期后拒绝原请求；首次创建仍必须经过现有服务器权限、配额及考试身份检查。

## 前端与 Notebook 的边界

最终目录按当前项目规模保持简洁。以下是迁移目标，不预先创建空目录，也不同时搬动后端和题库根目录。

| 路径 | 归属 |
| --- | --- |
| `site/src/course/` | 课程、作业入口及教学资源 |
| `site/src/workbench/` | 题目、唯一提交源码、草稿、编辑器与 Notebook 视图状态 |
| `site/src/submissions/` | 提交、任务进度、报告与有效成绩展示 |
| `site/src/teacher/` | 名册、发布、成绩簿、复判；复用共享 API 和成绩组件 |
| `site/src/learning/` | 独立拓展案例入口，不依赖课程成绩状态 |
| `site/src/shared/` | API 客户端、类型、基础组件和设计变量；只放确有多个使用方的内容 |
| `contracts/` | API / 评测结果的机器可读 schema 与例子，供 TypeScript 和 Python 两端验证 |
| `supabase/` | 课程业务、数据库权限和事务；保留已有迁移历史 |
| `judge/` | 可信校验、分数聚合、隔离执行适配器 |
| `content/`、JupyterLite 配置及拟新增桥接扩展 | Notebook 内容和运行环境；保持独立构建 |
| `scripts/assemble_site.py` | 将门户产物、运行环境、题目、文档组装为发布目录 |

工作台状态以 assignment ID 和 problem ID 绑定；唯一 `submissionSource` 供编辑器、Notebook 提交单元、草稿和正式提交使用。Notebook 的其他单元不属于该状态。切换题目、课程或异步恢复运行环境时校验当前上下文，避免旧回调覆盖新作业。考试策略继续由服务端执行，客户端只负责交互约束。

桥接接口仅暴露 ready、openAssignment、sourceChanged、run、reset、error，带协议版本、请求 ID 和作业上下文。门户验证来源窗口、origin、消息结构及上下文；扩展内部使用 JupyterLab 服务。官方 `jupyter-iframe-commands` 可用于命令控制，但它不会自动提供本项目的提交单元合同，不能把任意命令透传当作最终接口。

运行环境在迁移前后必须保持：PySCIPOpt 实际可用、每次练习隔离、超时可中止、实验笔记保留、浏览器存储不被清空、正式成绩不接受浏览器计算结果。门户先保留现有适配器，待桥接实测等价后再删除旧路径。

样式迁移保留现有颜色、排版、视觉效果和课程/拓展分区。先抽设计变量与基础组件，再将工作台和教师选择器限定到各自组件。旧 CSS 只有在对应页面迁移并经过截图核对后才删除。

## 实施顺序与验收

| 批次 | 可独立交付的改动 | 验收及回退边界 |
| --- | --- | --- |
| 提交与任务可靠性 | 事务创建、幂等键、配置快照、持久派发、恢复器及共有状态合同 | 本地/隔离数据库注入写入失败；并发相同键仅一份提交；响应丢失可查回；重复派发仅一个运行器认领；回调重复/乱序不改错成绩；恢复不扣学生提交次数。迁移先兼容旧字段，数据库与 Edge 部署单独验收，Pages CI 不代表其上线 |
| 成绩读取一致性 | 学生与教师共享 latestAttempt/effectiveGrade 读取规则；复判与审计一致 | 成功后复判排队、失败、降分、迟到旧回调，以及三种成绩策略的固定例子均一致；旧页面也先使用新 DTO |
| 工作台模块迁移 | Vite/TS 构建；先迁一个工作台，再迁提交记录与教师端，最后门户和拓展入口 | 相同题目、源码、草稿和考试流程行为等价；桌面与窄屏截图核对；课程/拓展互不串内容。按页面切回上个发布产物，避免两套状态同时运行 |
| Notebook 桥接 | 扩展内持有 Jupyter 模型，门户使用版本化接口；锁定验证过的构建依赖 | 继承真实 PySCIPOpt、源码同步、笔记保留、重复/缺失 submission 单元阻止提交、超时恢复；新增跨题目、过期消息和升级兼容测试；通过后删除旧对象访问 |
| 判题职责整理 | 在现有 judge 内拆执行、可信验证、聚合；再增加测试组 schema | 原 P001/P002 分数不变；非法/非有限数值、伪造目标值、错误维度、资源超限均有确定结果；评分版本能重放，私人实例和服务凭据不进入学生容器 |

容量验收采用预期课堂人数的并发提交，测排队时间、开始延迟、完成延迟、失败率和积压恢复时间，再决定是否换独立 Worker。Actions 后续只需替换派发与运行适配器，不能迫使前端、作业模型和评分规则再次改写。

正式上线前，在隔离测试课程使用授权的教师和学生测试账号验收：发布 → 选课/身份核验 → 提交 → 可信出分 → 学生查询 → 教师成绩簿 → 复判 → 故障恢复。保存任务、回调和审计证据，不污染真实课程成绩。

## 外部资料校正

- GitHub 官方确认 Classroom 于 2026-08-28 退役；不应新建依赖。该公告针对 Classroom，不能据此认定 Actions 退役。[官方公告](https://github.blog/changelog/2026-08-27-github-classroom-deprecated/)
- 不将 Stars、活跃标签或搜索结果缩略图作为架构证据；材料中的第一张图来自 Chegg，与 PrairieLearn 源码对标无关。
- PrairieLearn 根 LICENSE 包含 CE、EE、历史贡献和第三方条款，不能把整个仓库简单视为单一 AGPL；Hydro 与 DMOJ 判题端根 LICENSE 为 AGPL，QingdaoU 后端根 LICENSE 为 MIT。本轮只参考边界与设计，没有复制外部源码；若后续复用，需逐文件核对。
- nbgrader、Otter-Grader 等 Notebook 作业工具可作为后续扩展参考；本轮不增加 Notebook 整文件正式评分。当前正式源码仍是唯一提交单元中的 `solve(instance)`，并在可信服务端重新执行。
