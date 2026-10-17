import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();

const GAME = process.argv[2];
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname, '--port', '8144'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/run/current-system/sw/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('http://127.0.0.1:8144/tests/harness/conformance.html');
  const out = await page.evaluate(async (url) => {
    const summary = await window.harness.run(url);
    // Grab the state straight from the frame for a look at the mechanics.
    const detail = await new Promise(async (resolve) => {
      const frame = document.getElementById('stage');
      const client = (await import('/vendor/conformance/conformance.js')).createClient(frame);
      const s = await client.newGame({ seed: 'arena' });
      const rows = [];
      for (let i = 0; i < 3; i++) {
        const st = await client.state();
        rows.push({ gravity_ms: st.gravity_ms, lock_timer_ms: st.lock_timer_ms, level: st.level, pieces: st.piece_count });
        await new Promise((r) => setTimeout(r, 700));
      }
      const dropped = await client.input('hard_drop');
      client.destroy();
      resolve({ start: s.piece && s.piece.type, next: s.next, rows, droppedScore: dropped.state.score });
    });
    return { summary, detail };
  }, GAME);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
  server.kill();
}
