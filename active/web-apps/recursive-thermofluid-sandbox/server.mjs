import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5192);
const feedbackFile = join(root, 'data', 'feedback.json');
const blueprintsDir = join(root, 'data', 'blueprints');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Return a Cache-Control value based on file extension.
 * HTML is never cached so the browser always gets fresh markup.
 * JS/CSS are cached for 1 hour — fine for a dev app and avoids
 * the need to manually bump version strings on every change.
 */
function cacheControl(ext) {
  if (ext === '.html') return 'no-cache, no-store, must-revalidate';
  if (ext === '.json') return 'no-cache';
  if (ext === '.js' || ext === '.mjs' || ext === '.css') return 'public, max-age=3600';
  return 'public, max-age=86400';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  const method = req.method;
  const pathname = req.url.split('?')[0];

  // ── API: feedback ──────────────────────────────────────
  if (method === 'POST' && pathname === '/api/feedback') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      mkdirSync(dirname(feedbackFile), { recursive: true });
      let existing = [];
      try { existing = JSON.parse(readFileSync(feedbackFile, 'utf8')); } catch {}
      existing.push({ ...data, serverTimestamp: new Date().toISOString() });
      writeFileSync(feedbackFile, JSON.stringify(existing, null, 2));
      jsonResponse(res, 200, { ok: true });
    } catch (e) {
      jsonResponse(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/feedback') {
    try {
      const data = readFileSync(feedbackFile, 'utf8');
      jsonResponse(res, 200, JSON.parse(data));
    } catch {
      jsonResponse(res, 200, []);
    }
    return;
  }

  if (method === 'DELETE' && pathname === '/api/feedback') {
    try {
      writeFileSync(feedbackFile, '[]');
      jsonResponse(res, 200, { ok: true });
    } catch (e) {
      jsonResponse(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  // ── API: blueprints ────────────────────────────────────
  if (pathname === '/api/blueprints') {
    mkdirSync(blueprintsDir, { recursive: true });

    if (method === 'GET') {
      try {
        const files = readdirSync(blueprintsDir).filter((f) => f.endsWith('.json'));
        const list = files.map((f) => {
          try {
            const data = JSON.parse(readFileSync(join(blueprintsDir, f), 'utf8'));
            return { id: f.replace('.json', ''), name: data.name || f, updatedAt: data.updatedAt };
          } catch {
            return null;
          }
        }).filter(Boolean).sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1));
        jsonResponse(res, 200, list);
      } catch {
        jsonResponse(res, 200, []);
      }
      return;
    }

    if (method === 'POST') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const id = data.id || 'bp_' + Date.now();
        const record = { ...data, id, updatedAt: new Date().toISOString() };
        writeFileSync(join(blueprintsDir, id + '.json'), JSON.stringify(record, null, 2));
        jsonResponse(res, 200, { ok: true, id });
      } catch (e) {
        jsonResponse(res, 400, { ok: false, error: e.message });
      }
      return;
    }

    if (method === 'DELETE') {
      try {
        for (const f of readdirSync(blueprintsDir).filter((f) => f.endsWith('.json'))) {
          rmSync(join(blueprintsDir, f));
        }
        jsonResponse(res, 200, { ok: true });
      } catch (e) {
        jsonResponse(res, 500, { ok: false, error: e.message });
      }
      return;
    }
  }

  // Blueprint by ID
  const bpPrefix = '/api/blueprints/';
  if (pathname.startsWith(bpPrefix) && pathname.length > bpPrefix.length) {
    const id = pathname.slice(bpPrefix.length);
    const bpFile = join(blueprintsDir, id + '.json');

    if (method === 'GET') {
      try {
        jsonResponse(res, 200, JSON.parse(readFileSync(bpFile, 'utf8')));
      } catch {
        jsonResponse(res, 404, { ok: false, error: 'Not found' });
      }
      return;
    }

    if (method === 'DELETE') {
      try {
        rmSync(bpFile);
        jsonResponse(res, 200, { ok: true });
      } catch {
        jsonResponse(res, 404, { ok: false, error: 'Not found' });
      }
      return;
    }
  }

  // ── Static files ────────────────────────────────────────
  const safePath = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^\/+/, '');
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const stream = createReadStream(filePath);
  res.writeHead(200, {
    'content-type': mimeTypes[ext] || 'application/octet-stream',
    'cache-control': cacheControl(ext),
  });
  stream.pipe(res);
}).listen(port, () => {
  console.log(`Recursive Thermofluid Sandbox running at http://localhost:${port}`);
});
