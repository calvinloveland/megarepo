/*
 * Capture the documentation screenshots.
 *
 *   node scripts/screenshot.mjs            # -> docs/images/{desktop,mobile,gameover}.png
 *
 * Starts its own server, freezes the page clock, and drives the engine through
 * the test surface so the board shows a real mid-game stack instead of an empty
 * grid. Requires Playwright's browser (the system Chrome on NixOS).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'images');
const PORT = 8131;

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();

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

/** Play a plausible stack through the debug surface, then leave a piece falling. */
const BUILD_BOARD = () => {
  const t = window.__tetris;
  t.api.freeze();
  t.api.reset({ seed: 'arena' });
  const plan = [0, 2, 4, 6, 8, 1, 3, 5, 7, 0, 4, 8, 2, 6, 3, 5, 1, 7];
  for (let i = 0; i < plan.length; i += 1) {
    if (!t.engine.piece) break;
    if (i % 3 === 1) t.api.press('rotate_cw');
    let guard = 0;
    while (t.engine.piece && guard++ < 12) {
      const left = Math.min(...t.engine.cellsOf(t.engine.piece).map((c) => c[0]));
      if (left === plan[i]) break;
      if (!t.api.press(left > plan[i] ? 'left' : 'right')) break;
    }
    if (!t.engine.piece) break;
    if (i < plan.length - 1) t.api.press('hard_drop');
  }
  t.api.advance(1300, 10);
  t.api.advance(5000, 10); // let the intro card retire
};

const server = spawn('node', [path.join(ROOT, 'server.mjs'), '--port', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
});
let browser = null;

try {
  await new Promise((resolve) => setTimeout(resolve, 700));
  browser = await chromium.launch({
    executablePath: findBrowser(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await desktop.goto(`http://127.0.0.1:${PORT}/index.html`);
  await desktop.waitForFunction(() => window.__tetris);
  await desktop.evaluate(BUILD_BOARD);
  await desktop.waitForTimeout(400);
  await desktop.locator('.boiler').screenshot({ path: path.join(OUT_DIR, 'desktop.png') });

  // The boiler at critical pressure: embers, flames, rivets, rattling panels.
  const ablaze = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ablaze.goto(`http://127.0.0.1:${PORT}/index.html`);
  await ablaze.waitForFunction(() => window.__tetris);
  await ablaze.evaluate(() => {
    const t = window.__tetris;
    t.api.freeze();
    t.api.press('KeyM'); // no audio in a headless capture
    t.api.reset({ seed: 'arena' });
    t.api.advance(6000, 16); // retire the intro card
    const plan = [0, 2, 4, 6, 8, 1, 3, 5, 7, 0, 4, 8, 2, 6, 3, 5, 1, 7, 2, 5, 8, 1];
    for (let i = 0; i < plan.length; i += 1) {
      if (!t.engine.piece) break;
      if (i % 3 === 1) t.api.press('rotate_cw');
      let guard = 0;
      while (t.engine.piece && guard++ < 12) {
        const left = Math.min(...t.engine.cellsOf(t.engine.piece).map((c) => c[0]));
        if (left === plan[i]) break;
        if (!t.api.press(left > plan[i] ? 'left' : 'right')) break;
      }
      if (!t.engine.piece) break;
      if (i < plan.length - 1) t.api.press('hard_drop');
    }
    t.engine.level = 23; // the boiler at full chat
  });
  await ablaze.waitForTimeout(4200);
  await ablaze.locator('.boiler').screenshot({ path: path.join(OUT_DIR, 'critical.png') });

  const over = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await over.goto(`http://127.0.0.1:${PORT}/index.html`);
  await over.waitForFunction(() => window.__tetris);
  await over.evaluate(() => {
    const t = window.__tetris;
    t.api.freeze();
    t.api.reset({ seed: 'arena', sequence: 'O'.repeat(40) });
    for (let i = 0; i < 40; i += 1) {
      if (t.api.state().game_over) break;
      while (t.engine.piece && Math.min(...t.engine.cellsOf(t.engine.piece).map((c) => c[0])) > 0) {
        if (!t.api.press('left')) break;
      }
      t.api.press('hard_drop');
    }
  });
  await over.waitForTimeout(300);
  await over.locator('.chamber-frame').screenshot({ path: path.join(OUT_DIR, 'gameover.png') });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5 });
  await phone.goto(`http://127.0.0.1:${PORT}/index.html`);
  await phone.waitForFunction(() => window.__tetris);
  await phone.evaluate(BUILD_BOARD);
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(OUT_DIR, 'mobile.png'), fullPage: true });

  for (const file of ['desktop.png', 'critical.png', 'gameover.png', 'mobile.png']) {
    const size = fs.statSync(path.join(OUT_DIR, file)).size;
    console.log(`docs/images/${file} — ${(size / 1024).toFixed(0)} KiB`);
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
