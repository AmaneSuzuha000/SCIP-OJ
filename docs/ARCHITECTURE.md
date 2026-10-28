# SCIP-OJ 架构

课程教学与拓展学习分别拥有导航和内容入口。课程包含题库、作业、Notebook、正式提交与成绩；拓展案例独立使用，不自动计入成绩。

## 模块与数据边界

| 目录 | 职责 |
| --- | --- |
| `site/src/student/` | 课程导航、题目、草稿、运行生命周期、提交记录、环境状态 |
| `site/src/platform/` | 认证与账号上下文、课程服务、分页读取、正式提交协议、共用弹窗 |
| `site/src/teacher/` | 成绩簿、作业、花名册、邀请码、证据、人工相似度初筛；异步响应绑定账号、课程和请求 |
| `site/src/markdown/` | 题目和文档共用的 Markdown / LaTeX 渲染；先清洗 HTML，再使用受限 KaTeX 渲染公式 |
| `site/js/` | 编辑器、考试交互、练习评分、工业工程仿真、消息适配器及固定版本的浏览器依赖 |
| `notebook/` | iframe 内的 Jupyter 模型、Python/SCIP 检测、独立内核、源码同步；消息命令白名单 |
| `supabase/` | 身份、权限、课程、正式提交、成绩、事务入队及任务恢复 |
| `judge/` | 私有测例、Docker 执行、可信验证与评分；学生源码不在宿主 Python 导入 |
| `problems/`、`content/`、`docs/` | 题目、Notebook 教材、文档，各自只有一个来源 |
| `scripts/`、`.github/workflows/` | 构建、预览、评测传输、部署和验证 |

前端采用原生 ES 模块与 esbuild。构建生成 app、platform、teacher、markdown 脚本及公式字体，不维护另一套手写主脚本。公共页头由 `site/layout/` 唯一组件生成，学生、教师、文档与实验页都使用同样的两空间导航；原有实验视觉和业务控件保留。

## 页面进入与运行

页面进入后，环境准备和课程服务恢复并行进行。环境检测实际启动 xeus-python，导入 PySCIPOpt，并完成一个微型 SCIP 求解。成功后保留一个没有运行学生代码的独立内核，页面显示「Python 就绪」。测试按钮在题目和环境均就绪后启用，测试报告只展示执行过程与结果。

每次测试消费独立内核，执行后销毁，再在后台准备下一份。不同运行不共享学生 globals。停止或超时会销毁 iframe；门户草稿保留，环境重新准备。消息带版本和请求标识，旧页面、旧题目、旧 Notebook 的结果不能回写当前工作区。

原始教学 Notebook 和进阶 Notebook 在共用工作台打开，分别返回课程实验和拓展学习；作业 Notebook 唯一带 `submission` 标签的代码单元与门户草稿同步，其他单元保留为实验笔记。缺少或重复该单元会阻止运行和提交。浏览器环境仅用于练习；正式评分独立执行。

## 正式成绩

正式请求由 Supabase 校验身份、选课、考试核验和限额，在一个事务中保存提交快照、评分任务与派发记录。派发使用租约；Actions 抢占具体评分任务后检出冻结的判题版本，在无网络 Docker 容器中执行源码。可信宿主重新验证结果，HMAC 回调原子完成任务和审计。

任务进度与有效成绩分别解释。排队、失败的复判保留最近一次成功成绩；成功的较低复判分数可以更新成绩。浏览器不能直接写提交、评分和审计表。详见 [正式提交与成绩契约](GRADING_CONTRACT.md)。

报告区分本地 Docker Image ID 和实际 registry digest。仅记录 ID 不代表镜像已推送、保留或可逐位重建。

## 构建与验证

`npm ci && npm run build` 生成门户与公式资产；`jupyter lite build --contents content --output-dir lite-build` 独立生成环境。`scripts/assemble_site.py` 统一组装完整站点，环境位于 `/notebooks/`；可见 Notebook 链接直接指向门户工作台，不再打开独立应用；旧 Lab/REPL 地址仅兼容跳转到同一门户。

`npm test` 运行全部 Python 与非浏览器 JavaScript 单元回归。数据库测试另外执行真实迁移、事务失败注入、RLS/ACL 和并发消费者。Chromium 验证实际按钮、自动环境准备、真实 PySCIPOpt、Notebook/草稿同步、公式字体、窄屏布局、超时及恢复。开发预览支持 `--lite lite-build`，不会把 iframe 重定向到异源线上环境。

生产迁移、函数状态和权限的只读核对不等于真实课堂验收。真实学生 OAuth → 选课 → 正式提交 → 教师成绩及复判，仍须在隔离演练课程中以真实师生账号验证。

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
