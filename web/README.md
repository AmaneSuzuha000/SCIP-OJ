# @scip-oj/web

SCIP-OJ 课程平台的 React 19 前端应用，由 GitHub Pages 部署为纯静态单页站点。

## 技术栈

React 19 + TypeScript (strict) + Vite 6 + Tailwind v4 + TanStack Query + Zustand + CodeMirror 6 + KaTeX + Pyodide (Web Worker)。

## 常用命令

```bash
npm install
npm run dev        # 本地开发服务器
npm run typecheck  # TypeScript 严格类型检查
npm test           # Vitest 单元测试与组件回归
npm run build      # tsc --noEmit && vite build && node scripts/stage-runtime.mjs
```

> `npm run build` 同时执行 `scripts/stage-runtime.mjs`：从 `node_modules/pyodide` 复制运行时核心并将 `numpy`/`scipy` WASM wheel 缓存至 `dist/runtime/pyodide/`；兼容层位于 `public/runtime/pyscipopt.py`。若更新了 `docs/*.md` 或 `problems/*`，请同步运行仓库根目录下的 `node scripts/gen-docs.mjs` 与 `node scripts/gen-problems.mjs`。

## 设计与安全约束

- **样式令牌**：所有颜色、间距、圆角语义均定义在 `src/styles/tokens.css`，组件中使用语义变量与断点类，不引入平行主题变量体系。
- **单一客户端**：Supabase 客户端只允许通过 `src/lib/supabase.ts` 创建与访问，禁止在其他模块重复实例化。
- **服务端权威**：浏览器仅承担展示与本地调试；站点准入、选课、身份核验、作业防作弊校验、提交节流与正式判分全部由 PostgreSQL RLS / RPC / Edge Functions 与无网络隔离 Docker 容器权威裁决。
- **代码分割与按需加载**：`/workbench` 编辑器、`KaTeX` 数学渲染、本地自测（`selftest.ts`）与 `Pyodide` Web Worker（约 29 MB 运行时）严禁进入首屏初始 JS 分块；`CodeMirror` 根据系统/用户深浅色解析主题动态切换明暗风格。

## 部署产物

构建产物输出于 `web/dist/`，经由根目录 `scripts/assemble_site.py` 拼装进最终部署目录（绝不包含 `problems/` 源码目录）。`dist/404.html` 由 Vite 构建插件自动复制 `index.html` 生成，用于 GitHub Pages 的 SPA 路由回退；线上运行时配置由工作流注入 `config.js` 内的 `window.SCIP_OJ_CONFIG` 提供。
