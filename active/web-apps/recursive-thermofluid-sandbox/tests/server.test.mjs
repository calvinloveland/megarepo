import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 5292;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start at ${url}`);
}

test('server serves ES modules with javascript MIME type', async () => {
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${BASE}/`);
    const response = await fetch(`${BASE}/sim-core.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/javascript/);
  } finally {
    proc.kill('SIGTERM');
  }
});

test('server serves blueprint CRUD endpoints', async () => {
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '5294' },
    stdio: 'ignore',
  });
  const BASE = 'http://127.0.0.1:5294';
  try {
    for (let i = 0; i < 30; i += 1) {
      try { const r = await fetch(BASE); if (r.ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }

    // Save a blueprint
    const saveResp = await fetch(BASE + '/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-machine', data: { level: 0, cells: [] } }),
    });
    assert.equal(saveResp.status, 200);
    const saved = await saveResp.json();
    assert.ok(saved.ok);
    assert.ok(saved.id);

    // List blueprints
    const listResp = await fetch(BASE + '/api/blueprints');
    assert.equal(listResp.status, 200);
    const list = await listResp.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.some((bp) => bp.id === saved.id));

    // Get individual blueprint
    const getResp = await fetch(BASE + '/api/blueprints/' + saved.id);
    assert.equal(getResp.status, 200);
    const record = await getResp.json();
    assert.equal(record.name, 'test-machine');

    // Delete
    const delResp = await fetch(BASE + '/api/blueprints/' + saved.id, { method: 'DELETE' });
    assert.equal(delResp.status, 200);

    // Verify gone
    const getGone = await fetch(BASE + '/api/blueprints/' + saved.id);
    assert.equal(getGone.status, 404);
  } finally {
    proc.kill('SIGTERM');
  }
});

