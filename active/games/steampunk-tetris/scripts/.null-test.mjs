import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8157'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
for (const [label, opts] of [['normal', {}], ['game blanks piece (60ms)', { nullPump: true }], ['blanks + arena pump', { nullPump: true, arenaPump: true }]]) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('http://127.0.0.1:8157/tests/harness/bot-runner.html');
  const r = await page.evaluate((o) => window.botRunner.run({ botUrl: '/bots/dist/boiler-stoker.js', gameUrl: '/index.html', seed: 'arena', timeLimitMs: 45000, ...o }), opts);
  console.log(`${label.padEnd(26)}: score ${String(r.maxScore).padStart(8)}  level ${String(r.maxLevel).padStart(2)}  lines ${String(r.maxLines).padStart(3)}  pieces ${String(r.maxPiece).padStart(4)}  (${(r.ms/1000).toFixed(0)}s)`);
  await page.close();
}
await browser.close();
server.kill();
