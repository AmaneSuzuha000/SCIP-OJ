# 前端工具链评估报告：为何本学期暂缓全面迁移至 Vite / TypeScript

- **文档类型**：架构决策与技术债评估笔记 (ADR)
- **评估日期**：2026-10-28
- **当前决策**：**暂缓（本学期保持当前轻量 esbuild 体系，不做全面重构）**

---

## 1. 现状分析
当前 SCIP-OJ 前端采用 **esbuild 核心编译打包 + 独立多页 HTML + 纯静态交付** 的轻量级工程架构：
- 源码架构：`site/src/{platform,student,teacher}/**/*.js`（标准 ES 模块拆分清晰）；
- 构建驱动：`scripts/build_portal.mjs`（基于 `esbuild` 编译生成 IIFE 产物到 `.portal-build/js/`）；
- 最终组装：`scripts/assemble_site.py`（负责将门户产物、JupyterLite 运行核、题目集与文档统一输出至 `dist/`）；
- 构建性能：全量构建仅耗时 **11 ~ 26 毫秒**，无冷启动延迟。

---

## 2. 迁移 Vite + TypeScript 的成本收益权衡

| 评估维度 | 引入 Vite + TS 的潜在收益 | 当前开课阶段的实际代价与风险 | 综合判定 |
| :--- | :--- | :--- | :---: |
| **工程稳定性** | 强类型静态类型检查，避免属性拼写或空值传递错误 | 需要对 `site/src/` 下 20+ 个模块重写类型定义；若类型收紧不当，会引入大量编译级阻断 | **风险 > 收益** |
| **Pages 部署契约** | Vite 现代化的 Rollup 插件生态 | 当前 `assemble_site.py` 与 GitHub Pages 部署流存在严格的固定相对路径（`base: /SCIP-OJ/`）依赖。Vite 默认的 Hash 命名和多 HTML 注入极易破坏现有的单页内联逻辑和版本缓存机制 | **风险高** |
| **JupyterLite 桥接** | 现代模块热重载 (HMR) 体验 | 项目核心包含与 `notebooks/` 内 JupyterLite / Pyodide 的 `postMessage` 消息桥与 single-document 模式。Vite 开发服务器的代理或打包重定向易引发跨域和 iframe 内部通信时序错乱 | **破坏性风险** |
| **构建速度与依赖** | 现代工具链统一 | esbuild 单次运行在 20ms 内完成，比 Vite 开发服务器冷启动与插件解析更快；依赖仅 1 个 `esbuild`，node_modules 极度清爽 | **现有架构更优** |
| **开课时间窗口** | 无直接教学功能新增 | 当前处于秋季学期教学开课前夕，所有工程改动必须以“保障真实作业评分与教学稳定性”为绝对第一优先级 | **禁止盲目折腾** |

---

## 3. 结论与后续演进建议

1. **本学期明确维持现状**：
   - 维持 `node scripts/build_portal.mjs` 构建体系；
   - 继续以原生 ES 模块（ES2020）为主要源码规范；
   - 依赖现有的 50+ 项端到端及契约单元测试（`npm run test:grading`, `test_grading_database.mjs`, `test_ui_contract.py`）提供质量护栏。

2. **后续演进路线（建议于寒假迭代）**：
   - **阶段一（无侵入类型检查）**：先引入 `tsconfig.json` 配置 `checkJs: true` 和 JSDoc，在不改变文件后缀与打包工具的前提下，在 CI 中利用 `tsc --noEmit` 进行纯静态类型巡检；
   - **阶段二（打包评估）**：在无教学任务的休课期间，建立独立的 `feat/vite-migration` 分支验证与 JupyterLite 及 `assemble_site.py` 的产物兼容性；通过全量视觉回归与 E2E 确认后方可合入。
