import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const r1 = await runBot(bot, { seed: 'arena' });
const r2 = await runBot(bot, { seed: 'arena', actionIntervalMs: 5 });
for (const r of [r1, r2]) {
  const filled = r.board.join('').split('').filter((c) => c !== '.').length;
  const locks = r.pieces - 1 - r.holds;
  console.log(`locks ${locks} holds ${r.holds} placed ${locks * 4} cleared ${r.lines * 10} board ${filled} residual ${locks * 4 - r.lines * 10 - filled}`);
}
