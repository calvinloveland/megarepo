import { runBot } from '../tests/node/bot-harness.mjs';
const bot = (await import('../bots/dist/boiler-stoker.js')).default;
const r = await runBot(bot, { seed: 'arena' });
console.log(r.error ? r.error.split('\n').slice(0, 6).join('\n') : `score ${r.score} pieces ${r.pieces}`);
