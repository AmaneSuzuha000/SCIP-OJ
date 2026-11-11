# SCIP-OJ

工业工程《系统建模与仿真》课程在线编程与建模实验平台，支持浏览器内交互式 PySCIPOpt 案例探索与云端隔离容器作业评测。

- **在线平台**：<https://amanesuzuha000.github.io/SCIP-OJ/>
- **课程文档**：[课程学习路径](docs/课程学习路径.md) · [学生使用指南](docs/学生指南.md) · [拓展学习指南](docs/拓展学习指南.md) · [课程实验与评价规范](docs/课程实验与评价规范.md)

---

## 平台能力

- **课程教学与作业工作台**：提供题面与数学公式阅读、Python 代码编辑与草稿保存、浏览器本地样例自测、一键正式提交以及实时评测明细回溯。
- **班级管理与教学工具**：支持邀请码选课、学生花名册匹配与身份核验、作业策略配置、成绩簿汇总导出与批量复判，以及脱敏班级排行榜。
- **11 套交互式建模案例**：内置 `P001`、`P002` 与 `IE-OPT-03` 至 `IE-OPT-11`（覆盖背包、指派、设施选址、装箱、流水车间、随机库存、运输、下料、巡检回路、带容量配送及单机调度），无需本地配置求解器即可直接在浏览器中运行、调参和对照验证。

---

## 体系结构与工作流

平台严格区分**浏览器本地练习路径**与**服务端正式评测路径**：

- **浏览器本地运行（练习用途）**：工作台「本地自测」与「拓展学习」页面基于 Pyodide 与兼容求解层在前端 Web Worker 内运行，用于教学演示与即时调试，不作为课程成绩依据。
- **云端隔离评测（正式成绩）**：学生提交后进入异步评测队列，在无网络隔离的 Docker 容器中运行原生 PySCIPOpt 求解并完成多维度校核，最终写回成绩簿。若发生服务端基础设施临时异常，任务会进入异常状态而不计为 0 分，并支持教师复判。

---

## 仓库目录结构

- `web/`：React 19 + TypeScript + Vite 前端单页应用与 Pyodide 运行时集成。
- `content/`：11 套课堂交互式 PySCIPOpt `.ipynb` 教学案例源文件。
- `docs/`：课程使用说明、学习路径与评价规范 Markdown 原文。
- `problems/` 与 `judge/`：题面定义、测试数据集构建、隔离容器定义与评分内核。
- `supabase/`：数据库架构迁移与 Edge Functions 服务实现。
- `scripts/`：静态文档与课程内容构建脚本、站点组装工具及辅助检查工具。
- `tests/`：涵盖判题规则、安全边界与数据库行为的自动化测试套件。

---

## 本地开发与验证

```bash
# 安装依赖与启动前端开发服务器
npm --prefix web ci
npm --prefix web run dev

# 前端类型检查、单测与生产构建
npm --prefix web run typecheck && npm --prefix web test && npm --prefix web run build

# 组装完整静态发布包
python scripts/assemble_site.py --web-dist web/dist --output dist

# 运行自动化测试集
npm test
npm run test:database
npm run test:parity
python scripts/check_notebooks_shim.py
```
