import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const seeds = ['arena', 'deepseek', 'calvin', 'brass'];
for (const rate of [30, 60, 200]) {
  const rows = [];
  for (const seed of seeds) rows.push(await runBot(bot, { seed, actionIntervalMs: 1000 / rate }));
  const mean = (f) => (rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(0);
  console.log(`rate ${String(rate).padStart(3)}/s  mean score ${String(mean((r) => r.score)).padStart(8)}  lines ${mean((r) => r.lines)}  level ${mean((r) => r.level)}  pieces ${mean((r) => r.pieces)}  actions/pc ${(rows.reduce((a, r) => a + r.meanActionsPerPiece, 0) / rows.length).toFixed(2)}`);
}
