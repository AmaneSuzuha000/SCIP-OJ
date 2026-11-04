# SCIP-OJ · 工业工程系统建模与仿真课程

此目录存放课程案例，案例数据均为合成教学示例，直接编译进课程前端。

- [课程主站](https://amanesuzuha000.github.io/SCIP-OJ/)
- [拓展学习：11 个建模案例](https://amanesuzuha000.github.io/SCIP-OJ/learn)

## 课程案例

1. **01_P001_knapsack_PySCIPOpt.ipynb** — 0/1 背包、容量约束与目标函数
2. **02_P002_assignment_PySCIPOpt.ipynb** — 人员任务指派与 MILP
3. **03_IE_Facility_Location_PySCIPOpt.ipynb** — 容量约束设施选址、变量联动和独立穷举核验
4. **04_IE_Bin_Packing_PySCIPOpt.ipynb** — 仓储装箱、容量约束和独立递归 oracle
5. **05_IE_Flow_Shop_PySCIPOpt.ipynb** — 排列流水车间、Cmax 与独立排列枚举
6. **06_IE_Stochastic_Inventory_PySCIPOpt.ipynb** — 场景式随机库存优化与期望成本穷举
7. **07_IE_Transportation_PySCIPOpt.ipynb** — 两仓三店辅料运输与运费枚举
8. **08_IE_Cutting_Stock_PySCIPOpt.ipynb** — 铝材下料、裁法与最少母材
9. **09_IE_TSP_MTZ_PySCIPOpt.ipynb** — 五点巡检回路（MTZ）与顺序枚举
10. **10_IE_CVRP_PySCIPOpt.ipynb** — 带容量的社区店配送
11. **11_IE_Single_Machine_PySCIPOpt.ipynb** — 单机位置模型与总延误

阅读顺序见仓库 `docs/课程学习路径.md`。广义指派、带时间窗的车辆路径和并行机调度仍是后续题目，这里没有对应 Notebook。

## 成绩与运行环境说明

- 案例在浏览器内直接运行：前端用 Pyodide 启动 CPython，通过 SciPy 的 HiGHS 求解。后端不再需要 JupyterLab 或任何 Notebook 服务。
- 浏览器里的 `pyscipopt` 是兼容层（`web/public/runtime/pyscipopt.py`），只实现课程用到的建模接口。**正式评测不使用它**：评分在隔离容器中由原生 PySCIPOpt 重新求解，浏览器结果只作练习，不计入成绩。
- 修改这些 `.ipynb` 后运行 `node scripts/gen-lessons.mjs` 重新生成前端课程数据。
