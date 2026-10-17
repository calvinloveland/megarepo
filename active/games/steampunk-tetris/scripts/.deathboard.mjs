import { runBot } from '../tests/node/bot-harness.mjs';
const name = process.argv[2] || 'boiler-stoker';
const seed = process.argv[3] || 'arena';
const bot = (await import(`../bots/dist/${name}.js`)).default;
const r = await runBot(bot, { seed });
console.log(`${name} on ${seed}: score ${r.score} lines ${r.lines} level ${r.level} pieces ${r.pieces} tetrises ${r.tetrises} actions/piece ${r.meanActionsPerPiece.toFixed(2)} tail ${r.tailMeanActions.toFixed(2)}`);
console.log(`tail actions: ${r.tailActionsPerPiece.join(',')}`);
console.log(r.board.map((row) => row.replaceAll('.', '·')).join('\n'));
