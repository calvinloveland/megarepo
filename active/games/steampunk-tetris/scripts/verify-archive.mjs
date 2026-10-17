/*
 * Verify the archive the Arena will receive.
 *
 * Builds the submission zip, unpacks it somewhere else, serves that copy, and
 * runs the official Protocol v2 conformance suite against it through the same
 * harness the browser suite uses. This catches the classic packaging failures:
 * index.html in a wrapper folder, a missing file, an absolute path that only
 * worked because the dev server rooted at the project.
 *
 *   node scripts/verify-archive.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* `playwright` and `playwright-core` both work; the test runner only guarantees
   one of them is installed, and we always pass an explicit executable path. */
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'dist-zip', 'brass-and-boiler.zip');
const GAME_PORT = 8123;

function findBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/run/current-system/sw/bin/google-chrome-stable',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return undefined;
}

async function waitForServer(url, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server at ${url} never came up`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-and-boiler-'));
execFileSync('node', [path.join(ROOT, 'scripts', 'package.mjs')], { cwd: ROOT, stdio: 'inherit' });
execFileSync('unzip', ['-q', '-o', ZIP, '-d', tmp]);

const entries = fs.readdirSync(tmp);
if (!entries.includes('index.html')) throw new Error(`no index.html at the top level: ${entries.join(', ')}`);

const dev = spawn('node', [path.join(ROOT, 'server.mjs'), '--dir', tmp, '--port', String(GAME_PORT)], {
  cwd: ROOT, stdio: 'inherit',
});
let harness = null;
let browser = null;
let exitCode = 0;

try {
  await waitForServer(`http://127.0.0.1:${GAME_PORT}/index.html`);
  harness = spawn('node', [path.join(ROOT, 'server.mjs'), '--port', '8099'], { cwd: ROOT, stdio: 'ignore' });
  await waitForServer('http://127.0.0.1:8099/tests/harness/conformance.html');

  browser = await chromium.launch({
    executablePath: findBrowser(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto('http://127.0.0.1:8099/tests/harness/conformance.html');
  const summary = await page.evaluate(
    (url) => window.harness.run(url),
    `http://127.0.0.1:${GAME_PORT}/index.html`,
  );

  for (const result of summary.results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name} — ${result.note}`);
  }
  console.log(`\n${summary.passed}/${summary.total} checks passed against the packaged archive`);
  if (pageErrors.length) console.log(`page errors: ${pageErrors.join(' | ')}`);

  if (!summary.pass) {
    console.error('\nThe packaged archive does not pass conformance:');
    console.error(summary.report);
    exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  if (harness) harness.kill();
  dev.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.exit(exitCode);
