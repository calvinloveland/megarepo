import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const server = spawn('node', ['server.mjs', '--port', '8155'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.goto('http://127.0.0.1:8155/tests/harness/bot-runner.html');
const limit = parseInt(process.argv[2] || '70000', 10);
const result = await page.evaluate(
  (ms) => window.botRunner.run({ botUrl: '/bots/dist/boiler-stoker.js', gameUrl: '/index.html', seed: 'arena', timeLimitMs: ms }),
  limit,
);
console.log(JSON.stringify({ score: result.maxScore, lines: result.maxLines, level: result.maxLevel, pieces: result.maxPiece, actions: result.actions, ms: result.ms, tetrises: result.tetrises, otherClears: result.otherClears, error: result.error }, null, 2));
await browser.close();
server.kill();
