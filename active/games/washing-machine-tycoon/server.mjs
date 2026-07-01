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
  let file = req.url === '/' ? '/index.html' : req.url;
  file = path.join(ROOT, file);
  // Basic path traversal guard
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }
  const ext = path.extname(file);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`🧺 Washing Machine Tycoon → http://localhost:${PORT}`);
});
