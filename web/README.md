# @scip-oj/web

课程平台的新前端。与旧 site/ 并存，直到切换完成。

## 栈

React 19 + TypeScript (strict) + Vite 6 + Tailwind v4 + TanStack Query + Zustand + CodeMirror 6。

## 命令

    npm install
    npm run dev        # 本地开发
    npm run build      # tsc --noEmit && vite build
    npm run typecheck
    npm test           # vitest

## 设计约束

- 所有颜色、间距、圆角只能来自 src/styles/tokens.css，组件里不允许写死数值。
- Supabase 实例只允许从 src/lib/supabase.ts 获取，禁止在别处再建一个 client。
- 服务端仍然是唯一权威：浏览器不做任何准入或判分决策，只展示服务端返回的结果。
- 路由级懒加载是硬要求，/workbench 的编辑器不得进入首屏分块。

## 部署

产物是纯静态文件。dist/404.html 由构建插件从 index.html 复制而来，用于 GitHub Pages
的 SPA 回退。运行配置通过 config.js 注入 window.SCIP_OJ_CONFIG，或使用
VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 环境变量。
