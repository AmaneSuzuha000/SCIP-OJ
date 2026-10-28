// Development-only static preview. Production remains the existing Pages build.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(value("--port", "4173"));
const host = value("--host", "0.0.0.0");
const liteRoot = path.resolve(root, value('--lite', 'lite-build'));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".md": "text/plain; charset=utf-8", ".ipynb": "application/json", ".py": "text/plain", '.wasm':'application/wasm', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://preview.local");
    const requested = decodeURIComponent(url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    if (/^\/(lab|repl)(\/|$)/.test(requested)) { const notebook=url.searchParams.get('path');res.writeHead(302, {Location:'/index.html#'+(notebook?'notebook/'+encodeURIComponent(notebook):'course-labs')});res.end();return; }
    let base = path.join(root, "site"), relative = requested === "/" ? "index.html" : requested.slice(1);
    if (requested.startsWith('/notebooks/')) {
      base = liteRoot; relative = requested.slice(11) || 'index.html';
      if (['engine.js','bridge.js'].includes(relative)) base = path.join(root,'notebook');
      else if (relative === 'lab/index.html') {
        try { await stat(path.join(liteRoot,'lab/index.html')); }
        catch {
          res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
          res.end('<!doctype html><meta charset="utf-8"><p>本地课程环境尚未构建。</p><script>window.ScipOJRuntime={prepare:async()=>{throw Error("请先构建本地 JupyterLite 环境，再重试。")}}</script><script src="../bridge.js"></script>');
          return;
        }
      }
    }
    if (requested.startsWith("/problems/")) { base = path.join(root, "problems"); relative = requested.slice(10); }
    if (requested.startsWith("/docs/")) { base = path.join(root, "docs"); relative = requested.slice(6); }
    if (requested === "/README.md") { base = root; relative = "README.md"; }
    if (relative.endsWith('.html') && !relative.includes('/') && base === path.join(root,'site')) base=path.join(root,'.portal-build/html');
    if (relative.split("/").some(part => part.startsWith("."))) { res.writeHead(403); res.end(); return; }
    if (/^js\/(app|platform|teacher|markdown)\.js$/.test(relative) || relative === 'js/markdown.css' || relative.startsWith('assets/katex/')) base=path.join(root,'.portal-build');
    let file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    let content = await readFile(file);
    if (base === liteRoot && relative === 'lab/index.html') {
      const bridge = '<script src="../engine.js?v=prewarm3"></script><script src="../bridge.js?v=prewarm3"></script>';
      content = Buffer.from(content.toString().replace('</body>',bridge+'</body>'));
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, host, () => console.log(`SCIP/LAB static preview on ${host}:${port}`));
