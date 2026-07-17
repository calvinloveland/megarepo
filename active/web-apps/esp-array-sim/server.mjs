// Minimal static file server for the ESP speaker-array simulator.
// Serves index.html plus app/sim assets in the project root and src/. No build
// step: the browser imports the ES modules directly via a /src/* alias.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5193);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function cacheControl(ext) {
  if (ext === '.html') return 'no-cache, no-store, must-revalidate';
  if (ext === '.mjs' || ext === '.js' || ext === '.css') return 'no-cache';
  return 'public, max-age=600';
}

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
  if (urlPath === '/') urlPath = '/index.html';
  // /src/* resolves to the project's src/ directory (ESM imports from the page).
  const fsPath = join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!fsPath.startsWith(root) || !existsSync(fsPath) || statSync(fsPath).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = extname(fsPath);
  const type = mimeTypes[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl(ext) });
  res.end(readFileSync(fsPath)); // Buffer -> sent as-is
});

server.listen(port, '0.0.0.0', () => {
  console.log(`esp-array-sim listening on http://127.0.0.1:${port}`);
});

export { server };