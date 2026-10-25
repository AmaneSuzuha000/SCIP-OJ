# 运行与作业契约

## 边界

- 门户：题目、班级作业、草稿、正式提交与成绩展示。
- 浏览器建模：唯一 xeus-python / PySCIPOpt 环境，代码视图和 Notebook 视图共用运行适配器；不再提供能力不同的 Pyodide 分支。
- 课程服务：认证、作业权限、正式评测、成绩与教师记录；不接受浏览器评分作为正式成绩。
- 开放案例：独立拓展学习资源，保持与课程成绩分离。

## 源码与状态

作业源码依然是 `solve(instance) -> dict`。代码编辑器是提交源码的当前表示；作业内 Notebook 唯一带 `submission` 标签的单元同步该表示并触发相同的草稿保存路径。测试、绘图等其他单元不进入提交源码。删除或重复作业单元时，运行和提交被阻止。考试模式禁止切换 Notebook；服务端考试策略不依赖此 UI 限制。

每次练习使用独立内核和新 Python globals，输出必须可序列化为 JSON。运行超时销毁承载内核的 iframe；恢复后重新启动，不回退到另一种不支持 SCIP 的运行时。作业源码保存在门户草稿中；Notebook 的其他实验单元仍属于浏览器 Notebook 存储，不承诺跨设备同步。

## 构建

`content/` → JupyterLite build → `lite-build/`。

`site/` + `docs/` + `problems/` + `lite-build/` → `scripts/assemble_site.py` → `dist/`。

生成运行环境保持完整地放在 `dist/notebooks/`。门户根页无需包含 JupyterLite 的配置脚本；不再先覆盖后修补。根目录 `docs/` 为文档唯一来源。旧 Lab/REPL 路由保留查询参数和片段。显式维持既有内容存储名称，不主动删除学生的浏览器文件。

## 验证

单元测试检查资源边界、唯一文档来源、失败不覆盖目录、运行协议、超时销毁与恢复。Chromium 集成测试构建完整 JupyterLite，实际执行 PySCIPOpt 背包求解、Notebook 源码同步与草稿保存、超时与恢复。既有判题、权限、考试与仿真回归继续运行。浏览器与服务端 Python 包版本可能不同，因此最终成绩仍独立判定。
