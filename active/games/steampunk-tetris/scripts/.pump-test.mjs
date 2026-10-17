import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8156'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
for (const pump of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('http://127.0.0.1:8156/tests/harness/bot-runner.html');
  const r = await page.evaluate((p) => window.botRunner.run({ botUrl: '/bots/dist/boiler-stoker.js', gameUrl: '/index.html', seed: 'arena', timeLimitMs: 60000, arenaPump: p }), pump);
  console.log(`${pump ? 'Arena-style 60ms state pump' : 'normal harness          '}: score ${String(r.maxScore).padStart(8)}  level ${String(r.maxLevel).padStart(2)}  lines ${String(r.maxLines).padStart(3)}  pieces ${r.maxPiece}`);
  await page.close();
}
await browser.close();
server.kill();
