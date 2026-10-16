/*
 * Run both bots over a set of seeds and print the scoreboard.
 *
 *   node scripts/run-bot.mjs                      # 3 seeds, both bots
 *   node scripts/run-bot.mjs --seed arena         # one seed
 *   node scripts/run-bot.mjs --only hunter        # one bot
 *   node scripts/run-bot.mjs --verbose            # per-piece action stats
 */

import { runBot } from '../tests/node/bot-harness.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const seeds = flag('seed', 'arena,deepseek,calvin,brass-boiler').split(',');
const only = flag('only', 'both');
const verbose = args.includes('--verbose');

const BOTS = {
  'boiler-stoker': {
    title: 'Boiler Stoker (score maximiser)',
    file: '../bots/dist/boiler-stoker.js',
  },
  'four-line-fanatic': {
    title: 'Four-Line Fanatic (Tetris hunter)',
    file: '../bots/dist/four-line-fanatic.js',
  },
};

const pad = (v, n) => String(v).padEnd(n);
const num = (v, n) => String(v).padStart(n);
let failures = 0;

for (const [key, bot] of Object.entries(BOTS)) {
  if (only !== 'both' && only !== key) continue;
  const { default: botFn } = await import(bot.file);
  console.log(`\n${bot.title}`);
  console.log(`  ${pad('seed', 14)}${num('score', 9)}${num('lines', 7)}${num('lvl', 5)}${num('tetris', 7)}${num('pieces', 8)}${num('act/pc', 8)}${num('max', 5)}${num('virt s', 8)}`);
  for (const seed of seeds) {
    const r = await runBot(botFn, { seed });
    if (r.error) {
      failures += 1;
      console.log(`  ${pad(seed, 14)} ERROR ${r.error}`);
      continue;
    }
    if (!r.gameOver) failures += 1;
    const clears = `${r.clears[1]}/${r.clears[2]}/${r.clears[3]}/${r.clears[4]}`;
    console.log(
      `  ${pad(seed, 14)}${num(r.score, 9)}${num(r.lines, 7)}${num(r.level, 5)}${num(r.tetrises, 7)}`
      + `${num(r.pieces, 8)}${num(r.meanActionsPerPiece.toFixed(1), 8)}${num(r.maxActionsPerPiece, 5)}`
      + `${num((r.virtualMs / 1000).toFixed(1), 8)}   clears ${clears}`,
    );
    if (verbose) {
      console.log(`      wall ${r.wallMs}ms, actions ${r.actions}, illegal ${r.illegal}, sleeps ${r.sleeps}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} run(s) did not end in a game over or errored`);
  process.exit(1);
}
