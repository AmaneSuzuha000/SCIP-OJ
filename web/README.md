# @scip-oj/web

SCIP-OJ 课程平台的 React 19 前端应用，构建为纯静态单页站点。

## 技术栈

React 19 + TypeScript (strict) + Vite 6 + Tailwind v4 + TanStack Query + Zustand + CodeMirror 6 + KaTeX + Pyodide (Web Worker)。

## 常用命令

```bash
npm install
npm run dev        # 本地开发服务器
npm run typecheck  # TypeScript 严格类型检查
npm test           # Vitest 单元测试与组件回归
npm run build      # 类型检查、生产打包并缓存 Pyodide 运行时
```

> 更新 `docs/*.md`、`problems/*` 或 `content/*.ipynb` 后，请在仓库根目录执行对应的 `node scripts/gen-docs.mjs`、`node scripts/gen-problems.mjs` 与 `node scripts/gen-lessons.mjs` 以同步前端静态模块。

## 工程架构约定

- **设计令牌统一**：颜色、间距与圆角均维护在 `src/styles/tokens.css`，组件统一引用语义令牌与自适应明暗主题。
- **单一服务客户端**：平台后端接口统一经由 `src/lib/supabase.ts` 调度；认证、权限、提交节流与评分全部以服务端权威校验为准。
- **按需代码分割**：代码编辑器、KaTeX 公式引擎、本地样例自测及浏览器端 Pyodide Web Worker 均按路由或交互触发按需懒加载，保证首屏轻量化。
- **静态产物组装**：构建后的 `web/dist/` 由根目录 `scripts/assemble_site.py` 整合为最终发布目录，配合 `404.html` 回退支持单页路由直访。
