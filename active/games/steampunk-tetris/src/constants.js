/*
 * Constants from Tetris Protocol v2 (PROTOCOL.md).
 *
 * Every number and every cell offset in this file is copied from the spec.
 * Nothing here may be tuned: the protocol calls these "mechanics", and they are
 * the only reason a bot can play any submitted game. Cosmetics live elsewhere.
 *
 * Spec references: §1 board, §2 pieces + SRS kicks, §3 randomizer, §4 clock,
 * §6 scoring.
 */

export const PROTO = 'tetris/2';
export const BOARD_W = 10;
export const BOARD_H = 20;
export const SPAWN_X = 3;
export const SPAWN_Y = 0;
export const MAX_LOCK_RESETS = 15;

export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/* §2 — cells as (col, row) offsets inside the piece box, per rotation (0-3). */
export const PIECE_CELLS = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

/* §2 — wall kicks, (dx, dy) with +y DOWN, tried in order after the in-place try. */
export const SRS_KICKS = {
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

/* §4 — fixed table, not a formula. Levels 1..25; 26+ repeats the floor. */
export const GRAVITY_MS = [
  1000, 770, 593, 457, 352, 271, 208, 160, 124, 95,
  73, 56, 43, 33, 26, 20, 15, 12, 9, 7,
  5, 4, 3, 2, 2,
];
export const LOCK_DELAY_MS = [
  500, 410, 336, 276, 226, 185, 152, 125, 102, 84,
  69, 56, 46, 38, 31, 25, 21, 17, 14, 12,
  9, 8, 6, 5, 5,
];

/* §6 — points per simultaneous line clear, multiplied by the level before the clear. */
export const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };

export function levelForLines(lines) {
  return 1 + Math.floor(lines / 10);
}

export function gravityForLevel(level) {
  return level >= 26 ? 1 : GRAVITY_MS[level - 1];
}

export function lockDelayForLevel(level) {
  return level >= 26 ? 5 : LOCK_DELAY_MS[level - 1];
}

/* §3 — FNV-1a 32-bit hash of the seed string. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* §3 — mulberry32 PRNG, returning a float in [0, 1). */
export function makeRng(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* §3 — one bag: Fisher-Yates, descending, on this exact starting order. */
export function nextBag(rng) {
  const bag = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
