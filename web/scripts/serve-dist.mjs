/**
 * Serve a built site the way GitHub Pages does.
 *
 * Pages is static: a missing path returns 404.html with a 404 status, and the
 * SPA router in that document takes over. Node's http server and python's
 * http.server both return their own error page instead, which would hide a
 * broken deploy, so this replicates the real behaviour.
 *
 * A project page is served under /<repo>/, so --base strips that prefix before
 * resolving a file. Testing without it only exercises the root deployment and
 * misses exactly the bugs a project page produces.
 *
 * Usage: node scripts/serve-dist.mjs [--base=/SCIP-OJ/] [directory] [port]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const baseArg = args.find((arg) => arg.startsWith('--base='));
const BASE = normalize(baseArg ? baseArg.slice('--base='.length) : '/').replace(/\\/g, '/');
const positional = args.filter((arg) => !arg.startsWith('--'));
const ROOT = resolve(positional[0] ?? 'dist');
const PORT = Number(positional[1] ?? 4180);

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
  let pathname = decodeURIComponent(url.pathname);

  // Mirror the project-page prefix: it belongs to the deployment, not the tree.
  if (BASE !== '/') {
    if (!pathname.startsWith(BASE)) {
      response.writeHead(404).end('Not found');
      return;
    }
    pathname = pathname.slice(BASE.length - 1);
  }

  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const target = join(ROOT, relative);

  // Refuse traversal outside the served directory.
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end();
    return;
  }

  // "/" and "/docs/" are directories, and Pages answers those with the
  // index.html inside -- serving the 404 shell for the site root would hide
  // every problem behind a page that looks like a working SPA.
  const indexTarget = join(target, 'index.html');
  const asIndex = await fileAt(indexTarget);
  const direct = asIndex ?? (await fileAt(target));
  const servedPath = asIndex ? indexTarget : target;
  if (direct) {
    response.writeHead(200, {
      'content-type': TYPES[extname(servedPath)] ?? 'application/octet-stream',
      'content-length': direct.size,
    });
    createReadStream(servedPath).pipe(response);
    return;
  }

  // A missing path is answered with the shell, exactly as Pages does.
  const fallback = await fileAt(join(ROOT, '404.html'));
  if (fallback) {
    response.writeHead(404, { 'content-type': TYPES['.html'] });
    createReadStream(join(ROOT, '404.html')).pipe(response);
    return;
  }
  response.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' at http://127.0.0.1:' + PORT + BASE);
});
