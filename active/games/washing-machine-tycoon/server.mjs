// server.mjs — Minimal static file server for production / launcher use
// ====================================================================
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.env.PORT || '3002', 10);
const ROOT = new URL('.', import.meta.url).pathname;

const MIME = {
  '.html' : 'text/html; charset=utf-8',
  '.css'  : 'text/css; charset=utf-8',
  '.js'   : 'application/javascript; charset=utf-8',
  '.json' : 'application/json',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.svg'  : 'image/svg+xml',
};

http.createServer((req, res) => {
  // Strip query parameters for file lookup (supports cache-busting like ?v=2)
  const urlPath = req.url.split('?')[0];
  let file = urlPath === '/' ? '/index.html' : urlPath;
  file = path.join(ROOT, file);
  // Basic path traversal guard
  if (!file.startsWith(ROOT)) {
    const h403 = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache, no-store, must-revalidate' };
    res.writeHead(403, h403); res.end('Forbidden');
    return;
  }
  const ext = path.extname(file);
  fs.readFile(file, (err, data) => {
    if (err) {
      const h404 = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache, no-store, must-revalidate' };
      res.writeHead(404, h404);
      res.end('Not found');
      return;
    }
    // No-cache for HTML/CSS/JS so Cloudflare doesn't cache 404s
    const noCache = ['.html', '.css', '.js'].includes(ext);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (noCache) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`🧺 Washing Machine Tycoon → http://localhost:${PORT}`);
});
