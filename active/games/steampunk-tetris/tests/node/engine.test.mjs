/*
 * Engine unit tests — the rules from PROTOCOL.md, checked without a browser.
 *
 * The tables and the seed sequence are transcribed here straight from the spec
 * on purpose: if the engine and this file ever disagree, one of them has drifted
 * and the browser conformance suite will catch it later anyway.
 *
 *   node --test tests/node
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { TetrisEngine } from '../../src/engine.js';
import {
  GRAVITY_MS, LOCK_DELAY_MS, SRS_KICKS, gravityForLevel, lockDelayForLevel, levelForLines,
} from '../../src/constants.js';

const SPEC_GRAVITY = [1000, 770, 593, 457, 352, 271, 208, 160, 124, 95, 73, 56, 43, 33, 26, 20, 15, 12, 9, 7, 5, 4, 3, 2, 2];
const SPEC_LOCK = [500, 410, 336, 276, 226, 185, 152, 125, 102, 84, 69, 56, 46, 38, 31, 25, 21, 17, 14, 12, 9, 8, 6, 5, 5];
const ARENA_SEED = ['T', 'L', 'O', 'J', 'I', 'S', 'Z', 'O', 'S', 'Z', 'L', 'I', 'J', 'T'];

/* PROTOCOL.md §2, transcribed by hand with +y downward. */
const SPEC_KICKS = {
  JLSTZ: {
    '0>1': [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[1, 0], [1, -1], [0, 2], [1, 2]],
  },
  I: {
    '0>1': [[-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[-1, 0], [2, 0], [-1, -2], [2, 1]],
  },
};

const tick = (engine, ms, step = 4) => {
  if (engine.lastNow === null) engine.tick(0);
  let clock = engine.lastNow;
  for (let acc = 0; acc < ms; acc += step) {
    clock += step;
    engine.tick(clock);
  }
  return engine.toState();
};

const drop = (engine, column) => {
  let guard = 0;
  while (guard++ < 12) {
    const cells = engine.cellsOf(engine.piece);
    const left = Math.min(...cells.map((c) => c[0]));
    if (left === column) break;
    if (!engine.applyAction(left > column ? 'left' : 'right')) break;
  }
  return engine.applyAction('hard_drop');
};

/* ------------------------------------------------------------------ tables */

test('gravity table matches PROTOCOL.md §4 exactly', () => {
  assert.deepEqual(GRAVITY_MS, SPEC_GRAVITY);
  SPEC_GRAVITY.forEach((ms, i) => assert.equal(gravityForLevel(i + 1), ms, `level ${i + 1}`));
  assert.equal(gravityForLevel(26), 1);
  assert.equal(gravityForLevel(40), 1);
});

test('lock delay table matches PROTOCOL.md §4 exactly', () => {
  assert.deepEqual(LOCK_DELAY_MS, SPEC_LOCK);
  SPEC_LOCK.forEach((ms, i) => assert.equal(lockDelayForLevel(i + 1), ms, `level ${i + 1}`));
  assert.equal(lockDelayForLevel(26), 5);
});

test('SRS kick tables match PROTOCOL.md §2 exactly', () => {
  assert.deepEqual(SRS_KICKS.JLSTZ, SPEC_KICKS.JLSTZ);
  assert.deepEqual(SRS_KICKS.I, SPEC_KICKS.I);
});

test('level is 1 + floor(lines / 10)', () => {
  assert.equal(levelForLines(0), 1);
  assert.equal(levelForLines(9), 1);
  assert.equal(levelForLines(10), 2);
  assert.equal(levelForLines(23), 3);
});

/* -------------------------------------------------------------- randomness */

test('seed "arena" produces the documented sequence', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const state = engine.toState();
  assert.deepEqual([state.piece.type, ...state.next], ARENA_SEED.slice(0, 6));
});

test('the second bag follows the first', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const seen = [];
  for (let i = 0; i < 8; i++) {
    engine.applyAction('hard_drop');
    if (engine.gameOver) break;
    seen.push(engine.piece.type);
  }
  assert.deepEqual(seen, ARENA_SEED.slice(1, 9));
});

test('a different seed produces a different order', () => {
  const engine = new TetrisEngine({ seed: 'not-arena' });
  const state = engine.toState();
  assert.notDeepEqual([state.piece.type, ...state.next], ARENA_SEED.slice(0, 6));
});

test('an explicit sequence is consumed before the bags', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'OOOOOIT' });
  const seen = [];
  for (let i = 0; i < 7; i++) {
    seen.push(engine.piece.type);
    engine.applyAction('hard_drop');
  }
  assert.equal(seen.join(''), 'OOOOOIT');
});

/* --------------------------------------------------------------- geometry */

test('pieces spawn at x=3, y=0, rotation 0', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  assert.equal(engine.piece.x, 3);
  assert.equal(engine.piece.y, 0);
  assert.equal(engine.piece.rotation, 0);
  assert.equal(engine.pieceCount, 1);
});

test('the board is 20 rows of 10 characters and never contains the live piece', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const state = engine.toState();
  assert.equal(state.board.length, 20);
  for (const row of state.board) {
    assert.equal(row.length, 10);
    assert.match(row, /^[.IOTSZJL]+$/);
  }
  for (const [x, y] of state.piece.cells) assert.equal(state.board[y][x], '.');
});

test('rotation picks the first legal candidate in tabulated order', () => {
  const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  let checked = 0;
  let kicked = 0;
  for (let attempt = 0; attempt < 400; attempt++) {
    const engine = new TetrisEngine({ seed: `fuzz-${attempt}` });
    engine.board = engine.board.map((row) => row.map(() => (Math.random() < 0.22 ? 'X' : '.')));
    const type = types[attempt % types.length];
    const piece = {
      type,
      x: Math.floor(Math.random() * 8) - 2,
      y: Math.floor(Math.random() * 17),
      rotation: Math.floor(Math.random() * 4),
    };
    if (!engine.isValid(piece)) continue;
    engine.piece = { ...piece };
    const from = piece.rotation;
    const to = (from + 1) % 4;
    const table = type === 'O' ? [] : (type === 'I' ? SPEC_KICKS.I : SPEC_KICKS.JLSTZ)[`${from}>${to}`];
    const expected = [[0, 0], ...table].find(([dx, dy]) => engine.isValid({ ...piece, rotation: to, x: piece.x + dx, y: piece.y + dy }));
    const legal = engine.applyAction('rotate_cw');
    checked += 1;
    assert.equal(legal, !!expected, `rotation legality mismatch for ${type} ${from}>${to}`);
    if (legal) {
      assert.equal(engine.piece.rotation, to);
      assert.equal(engine.piece.x, piece.x + expected[0]);
      assert.equal(engine.piece.y, piece.y + expected[1]);
      if (expected[0] !== 0 || expected[1] !== 0) kicked += 1;
    }
  }
  assert.ok(checked > 100, `only ${checked} rotations were exercised`);
  assert.ok(kicked > 5, `kick paths were barely exercised (${kicked})`);
});

test('illegal moves leave the state unchanged', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  for (let i = 0; i < 12; i++) engine.applyAction('left');
  const before = JSON.stringify(engine.toState());
  assert.equal(engine.applyAction('left'), false);
  assert.equal(JSON.stringify(engine.toState()), before);
});

/* ------------------------------------------------------------------- time */

test('gravity is driven by elapsed time, not frames', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  tick(engine, 3000, 7); // deliberately not a multiple of 16.6ms
  assert.equal(engine.piece.y, 3, 'one row per 1000ms at level 1');
  assert.ok(engine.elapsedMs >= 2950 && engine.elapsedMs <= 3100, `elapsed ${engine.elapsedMs}`);
});

test('a single huge tick applies every due gravity step', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  engine.tick(1000);
  engine.tick(5000);
  assert.equal(engine.piece.y, 4);
});

test('pause stops the clock and the piece', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  tick(engine, 500);
  engine.setPaused(true);
  const before = engine.toState();
  tick(engine, 2000);
  assert.equal(engine.piece.y, before.piece.y);
  assert.equal(engine.toState().elapsed_ms, before.elapsed_ms);
  engine.setPaused(false);
  tick(engine, 1000);
  assert.ok(engine.elapsedMs > before.elapsed_ms);
});

test('a resting piece reports a lock timer and locks by itself', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const first = engine.pieceCount;
  for (let i = 0; i < 25; i++) if (!engine.applyAction('soft_drop')) break;
  assert.equal(engine.pieceCount, first, 'soft drop must not lock the piece');
  assert.equal(typeof engine.lockTimerMs, 'number');
  tick(engine, 900);
  assert.equal(engine.pieceCount, first + 1);
});

test('lock delay resets are capped at 15', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const first = engine.pieceCount;
  for (let i = 0; i < 25; i++) if (!engine.applyAction('soft_drop')) break;
  for (let i = 0; i < 24; i++) {
    engine.applyAction(i % 2 ? 'left' : 'right');
    tick(engine, 40);
  }
  assert.equal(engine.lockResets, 15, 'exactly 15 resets may be spent');
  tick(engine, 700);
  assert.ok(engine.pieceCount > first, 'the piece must lock even while being nudged');
});

test('moving off a ledge cancels the lock timer', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'O' });
  engine.board[19][4] = 'X'; // a one-cell ledge under the O's left column
  for (let i = 0; i < 25; i++) if (!engine.applyAction('soft_drop')) break;
  assert.equal(typeof engine.lockTimerMs, 'number', 'the O rests on the ledge');
  while (engine.applyAction('left')); // slide clear of the ledge
  assert.equal(engine.lockTimerMs, null, 'unsupported pieces have no lock timer');
});

/* ---------------------------------------------------------------- actions */

test('soft drop scores 1 per row, hard drop scores 2 per row', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  engine.applyAction('soft_drop');
  assert.equal(engine.score, 1);
  const lowest = Math.max(...engine.cellsOf(engine.piece).map((c) => c[1]));
  engine.applyAction('hard_drop');
  assert.equal(engine.hardDropRows, 19 - lowest);
  assert.equal(engine.score, 1 + 2 * (19 - lowest));
});

test('hold swaps once per piece and re-spawns from the top', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const state = engine.toState();
  assert.equal(state.can_hold, true);
  assert.equal(engine.applyAction('hold'), true);
  assert.equal(engine.hold, state.piece.type);
  assert.equal(engine.piece.type, state.next[0]);
  assert.equal(engine.piece.y, 0);
  assert.equal(engine.piece.rotation, 0);
  assert.equal(engine.canHold, false);
  assert.equal(engine.applyAction('hold'), false);
  engine.applyAction('hard_drop');
  assert.equal(engine.canHold, true);
});

test('every action is illegal once the game is over', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'O'.repeat(40) });
  while (!engine.gameOver && engine.pieceCount < 60) drop(engine, 0);
  assert.equal(engine.gameOver, true);
  assert.equal(engine.piece, null);
  assert.equal(engine.toState().piece, null);
  for (const action of ['left', 'right', 'rotate_cw', 'rotate_ccw', 'soft_drop', 'hard_drop', 'hold']) {
    assert.equal(engine.applyAction(action), false, `${action} must be illegal`);
  }
});

/* ---------------------------------------------------------------- scoring */

test('five O pieces clear two rows and score 300 plus drop points', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'OOOOO' });
  let dropPoints = 0;
  for (const target of [0, 2, 4, 6, 8]) {
    const before = engine.score;
    drop(engine, target);
    dropPoints += engine.score - before;
  }
  assert.equal(engine.lines, 2);
  assert.equal(engine.level, 1);
  assert.equal(engine.board.every((row) => row.every((c) => c === '.')), true);
  assert.equal(engine.score, dropPoints, 'the double is already inside the delta');
  assert.ok(engine.score >= 300, `expected at least the 300 point double, got ${engine.score}`);
});

test('a Tetris pays 800 x level using the level before the clear', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'I'.repeat(8) });
  for (let y = 16; y <= 19; y++) {
    for (let x = 1; x < 10; x++) engine.board[y][x] = 'J'; // 4-deep well in column 0
  }
  engine.applyAction('rotate_cw'); // vertical I occupies box column 2
  for (let i = 0; i < 5; i++) engine.applyAction('left'); // box x = -2 -> column 0
  const before = engine.score;
  const lowest = Math.max(...engine.cellsOf(engine.piece).map((c) => c[1]));
  engine.applyAction('hard_drop');
  assert.equal(engine.lines, 4);
  assert.equal(engine.tetrises, 1);
  assert.equal(engine.score - before, 800 + 2 * (19 - lowest));
  assert.equal(engine.level, 1);
});

test('line clear scoring uses the level before the clear, then re-levels', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'I'.repeat(8) });
  for (let y = 18; y <= 19; y++) {
    for (let x = 1; x < 10; x++) engine.board[y][x] = 'J';
  }
  engine.lines = 9;
  engine.level = 1;
  engine.applyAction('rotate_cw');
  for (let i = 0; i < 5; i++) engine.applyAction('left');
  const before = engine.score;
  engine.applyAction('hard_drop');
  const rows = engine.hardDropRows;
  assert.equal(engine.lines, 11);
  assert.equal(engine.score - before, 300 + 2 * rows, 'a double at level 1 is 300');
  assert.equal(engine.level, 2, 'level = 1 + floor(11/10)');
});

test('T-spin detection is display-only and never pays out', () => {
  const engine = new TetrisEngine({ seed: 'arena', sequence: 'T' });
  // Three corners filled: a T slot above the floor with both sides walled off.
  engine.board[19][4] = 'X';
  engine.board[19][5] = 'X';
  engine.board[19][6] = 'X';
  engine.board[18][4] = 'X';
  engine.board[18][6] = 'X';
  const before = engine.score;
  engine.applyAction('soft_drop');
  engine.applyAction('soft_drop');
  engine.applyAction('hard_drop');
  const rows = engine.hardDropRows;
  assert.equal(engine.score - before, 2 + 2 * rows, 'only §6 payouts are allowed');
  assert.equal(engine.lastClear.lines, 0);
});

/* ---------------------------------------------------------------- protocol */

test('toState reports every field the protocol requires', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  const s = engine.toState();
  assert.deepEqual(Object.keys(s).sort(), [
    'board', 'can_hold', 'elapsed_ms', 'game_over', 'gravity_ms', 'hold', 'level',
    'lines', 'lock_timer_ms', 'next', 'piece', 'piece_count', 'score',
  ].sort());
  assert.equal(s.next.length, 5);
  assert.equal(s.piece.cells.length, 4);
  assert.equal(s.lock_timer_ms, null);
});

test('reset clears score, lines, board and stats', () => {
  const engine = new TetrisEngine({ seed: 'arena' });
  engine.applyAction('hard_drop');
  engine.applyAction('hard_drop');
  engine.reset({ seed: 'arena' });
  const s = engine.toState();
  assert.equal(s.score, 0);
  assert.equal(s.lines, 0);
  assert.equal(s.level, 1);
  assert.equal(s.piece_count, 1);
  assert.equal(s.hold, null);
  assert.equal(s.can_hold, true);
  assert.equal(s.board.every((row) => row === '..........'), true);
  assert.equal(s.piece.type, 'T');
});
