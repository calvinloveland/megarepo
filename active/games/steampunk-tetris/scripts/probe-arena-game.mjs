/*
 * Play a remote Arena game with one of our bots.
 *
 * The Arena ranks bots by mean score across every accepted game, so the bot's
 * real target is the whole corpus, not our own page. This drives a bot against
 * any game URL through the same postMessage protocol and the same 30
 * actions/second limit the Arena applies, and prints the result — which is how
 * you find out whether a leaderboard number came from the bot or from the game.
 *
 *   node scripts/probe-arena-game.mjs --game <url> [--seed arena] [--limit 180]
 *   node scripts/probe-arena-game.mjs --all      # every game on the board
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARENA = process.env.TETRIS_ARENA || 'https://tetris-arena.ian-m-karlinsey.workers.dev';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();

async function gamesFromBoard() {
  const board = await (await fetch(`${ARENA}/api/leaderboard`)).json();
  return (board.games || []).map((g) => ({
    name: g.name,
    author: g.author,
    url: `${ARENA}/g/${g.id}/index.html`,
    best: g.best_score,
    bestBot: g.best_bot,
  }));
}

const botFile = flag('bot', 'boiler-stoker');
const seed = flag('seed', 'arena');
const limitMs = parseInt(flag('limit', '180000'), 10);
const only = flag('game', null);

let games;
if (only) {
  games = [{ name: path.basename(path.dirname(only)), author: '', url: only, best: null, bestBot: null }];
} else {
  games = await gamesFromBoard();
}

const server = spawn('node', [path.join(ROOT, 'server.mjs'), '--port', '8146'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

const rows = [];
try {
  for (const game of games) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.goto('http://127.0.0.1:8146/tests/harness/bot-runner.html');
    const result = await page.evaluate(
      ([url, bot, s, cap]) => window.botRunner.run({ botUrl: `/bots/dist/${bot}.js`, gameUrl: url, seed: s, timeLimitMs: cap }),
      [game.url, botFile, seed, limitMs],
    );
    rows.push({ ...game, ...result });
    const line = `${String(game.name).slice(0, 30).padEnd(32)}${String(result.maxScore).padStart(9)}  lvl ${String(result.maxLevel).padStart(2)}  lines ${String(result.maxLines).padStart(3)}  pieces ${String(result.maxPiece).padStart(4)}  ${result.error ? 'ERROR ' + result.error : ''}`;
    console.log(line + (game.best ? `   (board best ${game.best} by ${game.bestBot})` : ''));
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

const scored = rows.filter((r) => !r.error);
if (scored.length > 1) {
  const mean = scored.reduce((a, r) => a + r.maxScore, 0) / scored.length;
  console.log(`\n${botFile} on ${scored.length} games: mean ${mean.toFixed(0)}  best ${Math.max(...scored.map((r) => r.maxScore))}`);
}
fs.writeFileSync(path.join(ROOT, 'dist-zip', 'arena-probe.json'), JSON.stringify(rows, null, 2));
