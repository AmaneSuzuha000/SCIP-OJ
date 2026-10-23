# SCIP-OJ · 工业工程系统建模与仿真课程

此目录由 JupyterLite 构建成浏览器 Notebook 工作区，案例数据均为合成教学示例。

- [案例总览 / 检修排队](https://AmaneSuzuha000.github.io/SCIP-OJ/case-studio.html)
- [随机库存](https://AmaneSuzuha000.github.io/SCIP-OJ/inventory-lab.html)
- [双工序生产线](https://AmaneSuzuha000.github.io/SCIP-OJ/flow-lab.html)
- [SCIP/Gurobi 官方示例导航](https://AmaneSuzuha000.github.io/SCIP-OJ/official-examples.html)
- [算法 OJ 主站](https://AmaneSuzuha000.github.io/SCIP-OJ/)
- [教师控制台](https://AmaneSuzuha000.github.io/SCIP-OJ/teacher.html)

## JupyterLite 内置 Notebook

1. **01_P001_knapsack_PySCIPOpt.ipynb** — 0/1 背包、容量约束与目标函数
2. **02_P002_assignment_PySCIPOpt.ipynb** — 人员任务指派与 MILP
3. **03_IE_Facility_Location_PySCIPOpt.ipynb** — 容量约束设施选址、变量联动和独立穷举核验
4. **04_IE_Bin_Packing_PySCIPOpt.ipynb** — 仓储装箱、容量约束和独立递归 oracle
5. **05_IE_Flow_Shop_PySCIPOpt.ipynb** — 排列流水车间、Cmax 与独立排列枚举
6. **06_IE_Stochastic_Inventory_PySCIPOpt.ipynb** — 场景式随机库存优化与期望成本穷举

## 成绩与运行环境说明

- JupyterLite（xeus-python + PySCIPOpt）是浏览器建模实验环境。浏览器 L1 练习使用另一条 Pyodide Worker 运行时；**两者尚非同一内核**。
- 三个案例交互实验全部在浏览器本地运行，不上传数据、不写正式成绩。
- 正式作业通过学生网页登录、选课门禁及后台隔离 PySCIPOpt 私有测试后存入教师成绩簿；学生**不需要 Fork、提交 PR 或使用 Actions**。
- 只有已有判题协议的 P001/P002 是目前 L2 支持的题型；新增 IE-OPT-03～06 Notebook 与 DES/库存案例不自动进入 L2。
- 真实教学前仍需师生账号端到端验收、成绩申诉和隐私流程核对。

仓库 README、docs/课程实验与评价规范.md 及 docs/课程精品案例建设路线.md 是课程设计与正式使用口径的准绳。
