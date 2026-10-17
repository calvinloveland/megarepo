import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8160'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8160/index.html?skin=doom');
await page.waitForFunction(() => window.__tetris && window.__tetris.api.doom());
await page.evaluate(() => {
  const t = window.__tetris;
  t.api.freeze();
  t.api.reset({ seed: 'arena' });
  t.api.advance(6000, 16);
  // A stack in progress, so the corridor feels under pressure.
  const plan = [0, 2, 4, 6, 8, 1, 3, 5, 7, 2, 5, 8];
  for (let i = 0; i < plan.length; i++) {
    if (!t.engine.piece) break;
    let guard = 0;
    while (t.engine.piece && guard++ < 12) {
      const left = Math.min(...t.engine.cellsOf(t.engine.piece).map((c) => c[0]));
      if (left === plan[i]) break;
      if (!t.api.press(left > plan[i] ? 'left' : 'right')) break;
    }
    if (!t.engine.piece) break;
    t.api.press('hard_drop');
  }
  t.engine.level = 9;
  const doom = t.api.doom();
  for (const d of [2.2, 3.4, 4.6, 6.4]) doom.debugSpawnAt(d);
});
await page.waitForTimeout(1400);
await page.screenshot({ path: '/tmp/doom-before.png' });
// Fire a Tetris: four kills, blood, MULTI KILL banner.
await page.evaluate(() => { window.__tetris.engine.lines += 4; window.__tetris.engine.tetrises = 7; });
await page.waitForTimeout(260);
await page.screenshot({ path: '/tmp/doom-kill.png' });
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/doom-after.png' });
console.log('errors:', errors.length ? errors : 'none');
console.log('skin:', await page.evaluate(() => window.__tetris.api.skin()));
await browser.close();
server.kill();
