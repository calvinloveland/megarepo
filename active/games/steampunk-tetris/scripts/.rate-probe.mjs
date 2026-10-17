import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const seeds = ['arena', 'tetris', 'stack', 'downstack', 'friday', 'hackathon'];
console.log('rate   mean score   lines  level  pieces  act/pc');
for (const rate of [30, 45, 60, 100, 1000]) {
  const rows = [];
  for (const seed of seeds) rows.push(await runBot(bot, { seed, actionIntervalMs: 1000 / rate }));
  const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`${String(rate).padStart(4)}  ${mean((r) => r.score).toFixed(0).padStart(10)}  ${mean((r) => r.lines).toFixed(1).padStart(6)}  ${mean((r) => r.level).toFixed(1).padStart(5)}  ${mean((r) => r.pieces).toFixed(0).padStart(6)}  ${mean((r) => r.meanActionsPerPiece).toFixed(2).padStart(6)}`);
}
