import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const seeds = ['arena', 'tetris', 'stack', 'downstack', 'friday', 'hackathon'];
const totals = { rotate: 0, move: 0, drop: 0, hold: 0 };
let pieces = 0;
let score = 0;
for (const seed of seeds) {
  const r = await runBot(bot, { seed });
  pieces += r.pieces; score += r.score;
  for (const k of Object.keys(totals)) totals[k] += r.actionMix[k];
}
const per = (n) => (n / pieces).toFixed(2);
console.log(`per piece: rotate ${per(totals.rotate)}  move ${per(totals.move)}  drop ${per(totals.drop)}  hold ${per(totals.hold)}  total ${per(totals.rotate + totals.move + totals.drop + totals.hold)}`);
console.log(`mean score ${(score / seeds.length).toFixed(0)} over ${seeds.length} seeds, ${(pieces / seeds.length).toFixed(0)} pieces per game`);
