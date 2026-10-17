import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8151'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.goto('http://127.0.0.1:8151/index.html');
await page.waitForFunction(() => window.__tetris);
await page.evaluate(() => {
  const t = window.__tetris;
  t.api.freeze();
  t.api.reset({ seed: 'arena' });
  t.api.press('KeyM');
  t.api.advance(6000, 16); // let the intro card retire
  // A real mid-game stack, then crank the level so the pressure system lights up.
  const cols = [0, 2, 4, 6, 8, 1, 3, 5, 7, 0, 4, 8, 2, 6, 3, 5, 1, 7];
  for (let i = 0; i < cols.length; i++) {
    if (!t.engine.piece) break;
    if (i % 3 === 1) t.api.press('rotate_cw');
    let guard = 0;
    while (t.engine.piece && guard++ < 12) {
      const left = Math.min(...t.engine.cellsOf(t.engine.piece).map((c) => c[0]));
      if (left === cols[i]) break;
      if (!t.api.press(left > cols[i] ? 'left' : 'right')) break;
    }
    if (!t.engine.piece) break;
    if (i < cols.length - 1) t.api.press('hard_drop');
  }
});
for (const [name, level] of [['calm', 2], ['warm', 8], ['rising', 14], ['critical', 21]]) {
  await page.evaluate((lv) => { window.__tetris.engine.level = lv; }, level);
  await page.waitForTimeout(name === 'calm' ? 600 : 2600);
  await page.screenshot({ path: `/tmp/chaos-${name}.png` });
  if (name === 'critical') {
    await page.waitForTimeout(90);
    await page.screenshot({ path: '/tmp/chaos-critical-2.png' });
  }
  const heat = await page.evaluate(() => ({ heat: window.__tetris.renderer.heat, particles: window.__tetris.renderer.particles.length, steam: window.__tetris.renderer.steam.length, cssHeat: getComputedStyle(document.documentElement).getPropertyValue('--heat') }));
  console.log(name, JSON.stringify(heat));
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
server.kill();
