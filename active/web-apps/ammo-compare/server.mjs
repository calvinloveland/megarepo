// Minimal static server for the ammo comparison table. No build step: the page
// is plain HTML/CSS plus native ES modules, so the browser loads them directly.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5113);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let fsPath = join(root, normalize(urlPath === '/' ? '/index.html' : urlPath));
  // Refuse anything that escapes the project root.
  if (!fsPath.startsWith(root)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Forbidden');
  }
  if (existsSync(fsPath) && statSync(fsPath).isDirectory()) fsPath = join(fsPath, 'index.html');
  if (!existsSync(fsPath)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = extname(fsPath);
  res.writeHead(200, {
    'content-type': mimeTypes[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'no-cache',
  });
  res.end(readFileSync(fsPath));
});

server.listen(port, () => {
  console.log(`Ammo comparison table: http://localhost:${port}`);
});
