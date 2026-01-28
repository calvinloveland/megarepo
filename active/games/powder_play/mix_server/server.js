const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8787', 10);
const DATA_PATH = process.env.MIX_CACHE_PATH || path.join(__dirname, 'mix_cache.json');

function loadCache() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[mix_server] load error', err);
    return {};
  }
}

function saveCache(cache) {
  try {
    const tmp = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, DATA_PATH);
  } catch (err) {
    console.error('[mix_server] save error', err);
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body || {});
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', { 'Content-Length': '0' });
  }

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true });
  }

  const cache = loadCache();

  if (url.pathname === '/mixes' && req.method === 'GET') {
    return send(res, 200, cache);
  }

  if (url.pathname === '/mixes' && req.method === 'DELETE') {
    saveCache({});
    return send(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/mixes/') && (req.method === 'GET' || req.method === 'POST' || req.method === 'PUT')) {
    const key = decodeURIComponent(url.pathname.replace('/mixes/', ''));
    if (!key) return send(res, 400, { error: 'missing key' });

    if (req.method === 'GET') {
      if (!cache[key]) return send(res, 404, { error: 'not found' });
      return send(res, 200, cache[key]);
    }

    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'invalid body' });
      if (!cache[key]) {
        cache[key] = body;
        saveCache(cache);
      }
      return send(res, 200, cache[key]);
    } catch (err) {
      return send(res, 400, { error: 'invalid json' });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[mix_server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mix_server] data file: ${DATA_PATH}`);
});
