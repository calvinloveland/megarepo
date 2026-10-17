import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const seeds = ['arena', 'tetris', 'stack', 'downstack', 'friday', 'hackathon', 'calvin', 'brass'];
console.log('thinking cost   mean score   lines  level  pieces');
for (const cost of [0, 10, 30, 60, 120]) {
  const rows = [];
  for (const seed of seeds) rows.push(await runBot(bot, { seed, searchCostMs: cost }));
  const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`${String(cost).padStart(9)}ms  ${mean((r) => r.score).toFixed(0).padStart(11)}  ${mean((r) => r.lines).toFixed(1).padStart(6)}  ${mean((r) => r.level).toFixed(1).padStart(5)}  ${mean((r) => r.pieces).toFixed(0).padStart(6)}`);
}
