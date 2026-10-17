/*
 * Weight tuner.
 *
 *   node scripts/tune.mjs --mode hunter --runs 6
 *   node scripts/tune.mjs --mode hunter --set '{"bumpiness":9,"holes":3000}'
 *
 * Overrides are merged over the built-in config so a weight change can be
 * measured over several seeds before it is written back into bots/src/core.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBot } from '../tests/node/bot-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(ROOT, 'bots', 'src', 'core.js'), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(
  `${core}\nexport { makeBot, SCORE_CFG, HUNTER_CFG };`,
).toString('base64')}`);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const mode = flag('mode', 'hunter');
const runs = parseInt(flag('runs', '6'), 10);
const seeds = flag('seeds', [
  'arena', 'deepseek', 'calvin', 'brass', 'boiler', 'fanatic', 'stoker', 'gauge',
  'valve', 'piston', 'cog', 'rivet', 'flywheel', 'condenser', 'governor', 'lantern',
  'aether', 'boilerplate', 'pressure', 'steam',
].join(',')).split(',');
const overrides = JSON.parse(flag('set', '{}'));
const cfg = { ...(mode === 'hunter' ? mod.HUNTER_CFG : mod.SCORE_CFG), ...overrides };
const botFn = mod.makeBot(cfg);

console.log(`${mode} cfg: ${JSON.stringify(overrides)}`);
console.log(`  ${'seed'.padEnd(10)}${'score'.padStart(9)}${'lines'.padStart(7)}${'lvl'.padStart(5)}${'tet'.padStart(5)}${'pc'.padStart(6)}${'clears'.padStart(12)}`);
const rows = [];
for (let i = 0; i < runs; i++) {
  const r = await runBot(botFn, { seed: seeds[i % seeds.length] });
  rows.push(r);
  console.log(`  ${r.seed.padEnd(10)}${String(r.score).padStart(9)}${String(r.lines).padStart(7)}${String(r.level).padStart(5)}${String(r.tetrises).padStart(5)}${String(r.pieces).padStart(6)}${`${r.clears[1]}/${r.clears[2]}/${r.clears[3]}/${r.clears[4]}`.padStart(12)}`);
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
console.log(`  MEAN score ${mean((r) => r.score).toFixed(0)} lines ${mean((r) => r.lines).toFixed(1)} level ${mean((r) => r.level).toFixed(1)} tetrises ${mean((r) => r.tetrises).toFixed(1)} pieces ${mean((r) => r.pieces).toFixed(0)}`);
const survived = rows.filter((r) => r.gameOver && !r.error).length;
console.log(`  ${survived}/${rows.length} runs ended in a real topout, ${rows.filter((r) => r.error).length} errors`);
