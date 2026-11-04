/**
 * Serve a built site the way GitHub Pages does.
 *
 * Pages is static: a missing path returns 404.html with a 404 status, and the
 * SPA router in that document takes over. Node's http server and python's
 * http.server both return their own error page instead, which would hide a
 * broken deploy, so this replicates the real behaviour.
 *
 * Usage: node scripts/serve-dist.mjs [directory] [port]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.argv[3] ?? 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function fileAt(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const target = join(ROOT, relative);

  // Refuse traversal outside the served directory.
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end();
    return;
  }

  const direct = await fileAt(target);
  if (direct) {
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'content-length': direct.size,
    });
    createReadStream(target).pipe(response);
    return;
  }

  const fallback = await fileAt(join(ROOT, '404.html'));
  if (fallback) {
    response.writeHead(404, { 'content-type': TYPES['.html'] });
    createReadStream(join(ROOT, '404.html')).pipe(response);
    return;
  }
  response.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT);
});
