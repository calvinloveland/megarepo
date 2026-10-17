/*
 * Probe a submitted game's *whole* gravity table, not just level 1.
 *
 * The official conformance suite only samples gravity at level 1 (`gravity_ms`
 * must be 1000 there and the piece must fall ~3 rows in 3.2s). A game can pass
 * every check and still have a wrong table at higher levels, which is the one
 * thing that would let every bot on the board suddenly score a million points:
 * score multiplies by the level, and slower gravity means a bot survives to a
 * much higher level before topping out.
 *
 * Drive it directly with `sequence` O pieces (five clear two rows), reading
 * `state.gravity_ms` after each clear, and compare with PROTOCOL.md §4.
 *
 *   node scripts/probe-gravity-table.mjs <game-url> [more-urls...]
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = [1000, 770, 593, 457, 352, 271, 208, 160, 124, 95, 73, 56, 43, 33, 26, 20, 15, 12, 9, 7, 5, 4, 3, 2, 2, 1];
const LOCK_SPEC = [500, 410, 336, 276, 226, 185, 152, 125, 102, 84, 69, 56, 46, 38, 31, 25, 21, 17, 14, 12, 9, 8, 6, 5, 5, 5];

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node scripts/probe-gravity-table.mjs <game-url> [...]');
  process.exit(2);
}

const server = spawn('node', [path.join(ROOT, 'server.mjs'), '--port', '8145'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

try {
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.goto('http://127.0.0.1:8145/tests/harness/conformance.html');
    const result = await page.evaluate(async (gameUrl) => {
      const frame = document.getElementById('stage');
      frame.src = 'about:blank';
      await new Promise((r) => setTimeout(r, 50));
      const { createClient } = await import('/vendor/conformance/conformance.js');
      const client = createClient(frame);
      frame.src = gameUrl;
      const ready = await client.waitForReady(15000);
      // A long run of O pieces: five of them fill two rows, so ten lines per
      // twenty pieces, and the level climbs fast.
      await client.newGame({ seed: 'arena', sequence: 'O'.repeat(400) });
      const samples = new Map();
      let guard = 0;
      while (guard < 400) {
        const state = await client.state();
        if (state.game_over) break;
        if (!samples.has(state.level)) {
          samples.set(state.level, { gravity_ms: state.gravity_ms, lock_timer_ms: null, lines: state.lines });
        }
        const target = [0, 2, 4, 6, 8][guard % 5];
        let moves = 0;
        while (moves++ < 12) {
          const cur = await client.state();
          if (cur.game_over || !cur.piece) break;
          const left = Math.min(...cur.piece.cells.map((c) => c[0]));
          if (left === target) break;
          const res = await client.input(left > target ? 'left' : 'right');
          if (!res.legal) break;
        }
        await client.input('hard_drop');
        guard += 1;
      }
      const final = await client.state();
      // Sample the lock timer while a piece rests, for the lock-delay table.
      let resting = null;
      for (let i = 0; i < 25; i++) {
        const res = await client.input('soft_drop');
        if (!res.legal) break;
        resting = res.state;
      }
      client.destroy();
      return {
        name: ready && ready.name,
        author: ready && ready.author,
        levels: [...samples.entries()].map(([level, s]) => ({ level, ...s })),
        finalLevel: final.level,
        finalLines: final.lines,
        restingLockTimer: resting && resting.lock_timer_ms,
        restingLevel: resting && resting.level,
      };
    }, url);

    console.log(`\n=== ${result.name} (${result.author})\n${url}`);
    console.log(`reached level ${result.finalLevel} with ${result.finalLines} lines; resting lock timer at level ${result.restingLevel}: ${result.restingLockTimer}ms`);
    const bad = [];
    for (const s of result.levels) {
      const wantGravity = s.level >= 26 ? 1 : SPEC[s.level - 1];
      const wantLock = s.level >= 26 ? 5 : LOCK_SPEC[s.level - 1];
      const ok = s.gravity_ms === wantGravity;
      if (!ok) bad.push(`level ${s.level}: gravity ${s.gravity_ms} (spec ${wantGravity})`);
      console.log(`  level ${String(s.level).padStart(2)}  lines ${String(s.lines).padStart(3)}  gravity ${String(s.gravity_ms).padStart(5)}ms (spec ${String(wantGravity).padStart(4)})  ${ok ? 'ok' : '<-- MISMATCH'}`);
      void wantLock;
    }
    console.log(bad.length ? `  ${bad.length} level(s) off the protocol table` : '  gravity table matches PROTOCOL.md §4 at every level sampled');
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
