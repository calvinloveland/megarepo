/*
 * Debug helper: dump what a bot's brain is choosing, piece by piece.
 *
 *   node scripts/debug-bot.mjs --mode hunter --pieces 20
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TetrisEngine } from '../src/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(ROOT, 'bots', 'src', 'core.js'), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(
  `${core}\nexport { makeBot, rankPlacements, boardFromState, measure, SCORE_CFG, HUNTER_CFG };`,
).toString('base64')}`);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const mode = flag('mode', 'hunter');
const cfg = mode === 'hunter' ? mod.HUNTER_CFG : mod.SCORE_CFG;
const limit = parseInt(flag('pieces', '20'), 10);
const seed = flag('seed', 'arena');

const engine = new TetrisEngine({ seed });
const render = (board) => board.map((row) => row.split('').map((c) => (c === '.' ? '·' : c)).join('')).join('\n');

for (let i = 0; i < limit; i++) {
  const state = engine.toState();
  if (state.game_over) break;
  const board = mod.boardFromState(state);
  const ranked = mod.rankPlacements(cfg, board, state);
  const m = mod.measure(board);
  const chosen = ranked[0];
  console.log(`#${state.piece_count} ${state.piece.type} next=[${state.next.join('')}] hold=${state.hold ?? '-'} heights=[${m.heights.join(',')}] well=${m.wellDepth}`);
  console.log(`  top: ${ranked.slice(0, 3).map((c) => `r${c.rotation}x${c.x}${c.useHold ? '(hold)' : ''}=${Math.round(c.value)}${c.fillsWell ? '*' : ''}${c.cleared ? ` clear${c.cleared}` : ''}`).join('  ')}`);
  if (!chosen) { console.log('  no candidates'); break; }

  // Execute the chosen placement through the protocol surface.
  if (chosen.useHold) engine.applyAction('hold');
  while (engine.piece.rotation !== chosen.rotation) {
    const diff = (chosen.rotation - engine.piece.rotation + 4) % 4;
    if (!engine.applyAction(diff === 3 ? 'rotate_ccw' : 'rotate_cw')) break;
  }
  while (engine.piece.x !== chosen.x) {
    if (!engine.applyAction(engine.piece.x < chosen.x ? 'right' : 'left')) break;
  }
  engine.applyAction('hard_drop');
  if (i < 3) console.log(render(engine.toState().board));
}
console.log(render(engine.toState().board));
console.log(`score ${engine.score} lines ${engine.lines} tetrises ${engine.tetrises} level ${engine.level} over=${engine.gameOver}`);
