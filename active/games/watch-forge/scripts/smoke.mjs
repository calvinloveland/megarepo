// scripts/smoke.mjs — browser smoke probe for Watch Forge (dev tool, not part of npm test)
// =======================================================================================
// Starts the static server, loads the page in Nix-managed Chrome, collects
// console/page errors, steps the evolution, and saves screenshots.
//
// Usage: node scripts/smoke.mjs [--out DIR]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5199;
const OUT = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : path.join(ROOT, 'screenshots');

// Playwright resolves from the vernissage node_modules on NixOS dev boxes;
// fall back to a local install if present.
const NODE_PATH = process.env.NODE_PATH || '';
const pwPath = (() => {
  try { return require.resolve('playwright', { paths: [NODE_PATH] }); }
  catch { return require.resolve('playwright'); }
})();
const { chromium } = require(pwPath);

function startServer() {
  const proc = spawn('node', ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', d => {
      if (String(d).includes('Watch Forge')) resolve(proc);
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

const errors = [];
const wins = {};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: '/run/current-system/sw/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  // 1. Engine loaded + champion exists
  await page.waitForFunction(() => window.WATCH_FORGE && window.WATCH_FORGE.G.champion, null, { timeout: 8000 });
  const initial = await page.evaluate(() => ({
    gen: window.WATCH_FORGE.G.generation,
    name: window.WATCH_FORGE.G.champion.pheno.name,
    score: window.WATCH_FORGE.G.champion.score,
    comps: window.WATCH_FORGE.G.champion.pheno.compCount,
    parts: window.WATCH_FORGE.G.champion.pheno.componentCount,
    challenges: Object.keys(window.WATCH_FORGE.E.CHALLENGES),
  }));
  wins.stage1_engine = initial;
  await page.screenshot({ path: path.join(OUT, '01-initial.png'), fullPage: false });

  // 2. Step 40 generations and check the champion improved
  await page.evaluate(() => { window.WATCH_FORGE.stepMany(40); });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    gen: window.WATCH_FORGE.G.generation,
    score: window.WATCH_FORGE.G.champion.score,
    name: window.WATCH_FORGE.G.champion.pheno.name,
  }));
  wins.stage2_evolved = after;
  await page.screenshot({ path: path.join(OUT, '02-evolved.png') });

  // 3. Switch challenge; champion re-scores under the new objective
  await page.evaluate(() => {
    document.querySelector('[data-id="grandComplication"]').click();
  });
  await page.waitForTimeout(300);
  const switched = await page.evaluate(() => ({
    challenge: window.WATCH_FORGE.G.challengeId,
    champScore: window.WATCH_FORGE.G.champion.score,
    breakdownShown: document.querySelectorAll('#scoreBreakdown .sb-row').length,
  }));
  wins.stage3_switch = switched;

  // 4. Watchmaker: load champion into the bench, seed population, verify gen 0
  await page.evaluate(() => document.querySelector('#wmLoadBtn').click());
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#wmSeedBtn').click());
  await page.waitForTimeout(200);
  const seeded = await page.evaluate(() => ({ gen: window.WATCH_FORGE.G.generation, name: window.WATCH_FORGE.G.champion.pheno.name }));
  wins.stage4_seed = seeded;

  // 5. Hall of fame: save + render
  await page.evaluate(() => document.querySelector('#saveHofBtn').click());
  await page.waitForTimeout(200);
  const hof = await page.evaluate(() => ({
    rows: document.querySelectorAll('.hof-row').length,
    total: JSON.parse(localStorage.getItem('watchforge.hof') || '[]').length,
  }));
  wins.stage5_hof = hof;
  await page.screenshot({ path: path.join(OUT, '03-final.png') });

  await browser.close();
  server.kill();

  const ok = errors.length === 0;
  console.log(JSON.stringify(wins, null, 2));
  if (!ok) {
    console.error('\nERRORS:');
    errors.forEach(e => console.error(' -', e));
    process.exit(1);
  }
  console.log('\n✓ smoke OK, screenshots in', OUT);
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});