import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);

async function readLocal(path) {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8');
}

test('index.html includes a dedicated UI feedback workspace tab', async () => {
  const html = await readLocal('index.html');
  assert.match(html, /data-workspace-tab="feedback"/);
  assert.match(html, /id="feedbackForms"/);
  assert.match(html, /Submit all to server/);
});

test('app.js defines persistent per-component UI feedback storage', async () => {
  const source = await readLocal('app.js');
  assert.match(source, /FEEDBACK_API/);
  assert.match(source, /FEEDBACK_COMPONENTS/);
  assert.match(source, /function submitAllFeedback\(/);
});

test('index.html has canvas toolbar', async () => {
  const html = await readLocal('index.html');
  assert.match(html, /id="canvasToolbar"/);
  assert.match(html, /id="toggleToolbarButton"/);
  assert.match(html, /id="toolbarButtons"/);
});

test('index.html has telemetry toggle and hidden-by-default stats', async () => {
  const html = await readLocal('index.html');
  assert.match(html, /id="telemetryToggle"/);
  assert.match(html, /class="stats-grid hidden" id="globalStats"/);
});

test('server serves POST /api/feedback endpoint', async () => {
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(root),
    env: { ...process.env, PORT: '5293' },
    stdio: 'ignore',
  });
  const BASE = 'http://127.0.0.1:5293';
  try {
    // Wait for server start
    for (let i = 0; i < 30; i += 1) {
      try {
        const r = await fetch(BASE);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }

    // POST feedback
    const postResp = await fetch(BASE + '/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ test: true, feedback: [] }),
    });
    assert.equal(postResp.status, 200);
    const postBody = await postResp.json();
    assert.equal(postBody.ok, true);

    // GET feedback
    const getResp = await fetch(BASE + '/api/feedback');
    assert.equal(getResp.status, 200);
    const body = await getResp.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 1);

    // DELETE feedback
    const delResp = await fetch(BASE + '/api/feedback', { method: 'DELETE' });
    assert.equal(delResp.status, 200);
  } finally {
    proc.kill('SIGTERM');
  }
});

test('index.html no longer has preset buttons', async () => {
  const html = await readLocal('index.html');
  assert.doesNotMatch(html, /data-preset=/);
});

test('index.html uses clean script URL without version query', async () => {
  const html = await readLocal('index.html');
  assert.match(html, /src="\.\/app\.js"/);
});

test('app.js imports sim-core without version query', async () => {
  const source = await readLocal('app.js');
  assert.ok(source.includes("'./sim-core.mjs'"), 'expected clean import of ./sim-core.mjs');
});

test('app.js wires up browser error logger', async () => {
  const source = await readLocal('app.js');
  assert.ok(source.includes('createErrorLogger'), 'app.js uses createErrorLogger');
  assert.ok(source.includes('/api/feedback'), 'error logger targets /api/feedback endpoint');
});

test('vendor/browser-error-logger.js exists', async () => {
  const logger = await readLocal('vendor/browser-error-logger.js');
  assert.ok(logger.includes('createErrorLogger'), 'vendored logger exports createErrorLogger');
  assert.ok(logger.includes('captureUnhandled'), 'vendored logger handles window.onerror');
});


