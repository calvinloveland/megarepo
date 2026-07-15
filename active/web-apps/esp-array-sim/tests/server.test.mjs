import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 5293;
const BASE = `http://127.0.0.1:${PORT}`;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, text };
}

test('server serves the page and ESM assets', async () => {
  const srv = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((r) => srv.stdout.on('data', (d) => /listening/.test(d) && r()));
    const idx = await get('/');
    assert.equal(idx.status, 200);
    assert.ok(idx.text.includes('ESP Speaker Array Simulator'));

    const app = await get('/app.js');
    assert.equal(app.status, 200);
    assert.ok(app.text.includes('runScenario'));

    const mod = await get('/src/scenario.mjs');
    assert.equal(mod.status, 200);
    assert.ok(mod.text.includes('export function runScenario'));

    const css = await get('/styles.css');
    assert.equal(css.status, 200);

    const missing = await get('/nope.txt');
    assert.equal(missing.status, 404);
  } finally {
    srv.kill();
  }
});