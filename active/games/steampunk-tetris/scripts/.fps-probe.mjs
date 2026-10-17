import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8152'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://127.0.0.1:8152/index.html');
await page.waitForFunction(() => window.__tetris);
await page.evaluate(() => { window.__tetris.api.freeze(); });

const measure = (label, setup) => page.evaluate(async ([lbl, code]) => {
  // eslint-disable-next-line no-new-func
  new Function(code)();
  await new Promise((r) => setTimeout(r, 900));
  const fps = await new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick); else resolve((frames / (performance.now() - t0)) * 1000); };
    requestAnimationFrame(tick);
  });
  return `${lbl}: ${fps.toFixed(1)} fps`;
}, [label, setup]);

console.log(await measure('level 1 (no heat)', 'window.__tetris.engine.level = 1;'));
console.log(await measure('level 24 (critical)', 'window.__tetris.engine.level = 24;'));
console.log(await measure('level 24, CSS overlays hidden', "window.__tetris.engine.level = 24; for (const s of ['.heat-veil','.scanlines','.critical-vignette','.forge-glow','.gear']) document.querySelectorAll(s).forEach(e => e.style.display='none');"));
console.log(await measure('level 24, canvas effects off', "window.__tetris.engine.level = 24; window.__tetris.renderer.spawnAmbient = () => {}; window.__tetris.renderer.particles.length = 0; window.__tetris.renderer.steam.length = 0;"));
await browser.close();
server.kill();
