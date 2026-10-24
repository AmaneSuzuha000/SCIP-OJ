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
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".md": "text/plain; charset=utf-8", ".ipynb": "application/json", ".py": "text/plain" };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://preview.local");
    const requested = decodeURIComponent(url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    if (/^\/(lab|repl)(\/|$)/.test(requested)) { res.writeHead(302, { Location: "https://amanesuzuha000.github.io/SCIP-OJ" + requested }); res.end(); return; }
    let base = path.join(root, "site"), relative = requested === "/" ? "index.html" : requested.slice(1);
    if (requested.startsWith("/problems/")) { base = path.join(root, "problems"); relative = requested.slice(10); }
    if (requested.startsWith("/docs/")) { base = path.join(root, "docs"); relative = requested.slice(6); }
    if (requested === "/README.md") { base = root; relative = "README.md"; }
    if (relative.split("/").some(part => part.startsWith("."))) { res.writeHead(403); res.end(); return; }
    let file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, host, () => console.log(`SCIP/LAB static preview on ${host}:${port}`));
