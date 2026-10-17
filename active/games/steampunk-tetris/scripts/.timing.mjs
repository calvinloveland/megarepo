import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
for (const seed of ['arena', 'calvin']) {
  const r = await runBot(bot, { seed });
  console.log(`${seed}: ${(r.wallMs / 1000).toFixed(2)}s wall for ${r.pieces} pieces = ${(r.wallMs / r.pieces).toFixed(2)} ms/piece`);
}
