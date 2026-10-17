/*
 * Shared bot brain for Brass & Boiler's two entrants.
 *
 * A bot is submitted as ONE ES module, so this file is not imported at runtime:
 * scripts/build-bots.mjs concatenates it into each strategy file and writes the
 * single-file bundles in bots/dist/. Edit here, run `npm run bots:build`.
 *
 * Everything a bot is allowed to know comes from PROTOCOL.md: the board is
 * 10x20, the piece shapes and the gravity/lock tables are fixed by the spec, and
 * every game reports them in the state object. No game internals are touched.
 *
 * By Calvin Loveland, with the deepseek agent.
 */

const BW = 10;
const BH = 20;

/* PROTOCOL.md §2 — box offsets, [col, row], per rotation. */
const SHAPES = {
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

/* PROTOCOL.md §4 / §6 — fixed by the spec, so hard-coding them is safe. */
const GRAVITY_MS = [1000, 770, 593, 457, 352, 271, 208, 160, 124, 95, 73, 56, 43, 33, 26, 20, 15, 12, 9, 7, 5, 4, 3, 2, 2];
const LOCK_DELAY_MS = [500, 410, 336, 276, 226, 185, 152, 125, 102, 84, 69, 56, 46, 38, 31, 25, 21, 17, 14, 12, 9, 8, 6, 5, 5];
const LINE_SCORE = [0, 100, 300, 500, 800];

/** The Arena rate-limits to 30 actions/second (§8) — budget against that. */
const ACTION_MS = 1000 / 30;
/**
 * Multiplier on the estimated time a piece has left. The estimate itself is
 * already pessimistic (it measures to the floor, not to the stack), and
 * measured survival bottoms out around 1.5: below that the bot abandons
 * placements it could comfortably have made, above it nothing changes.
 */
const SAFETY = 1.5;
const LOOKAHEAD_CANDIDATES = 6;
const LOOKAHEAD_WEIGHT = 0.55;

const gravityMs = (level) => (level >= 26 ? 1 : GRAVITY_MS[level - 1]);
const lockDelayMs = (level) => (level >= 26 ? 5 : LOCK_DELAY_MS[level - 1]);

/* --------------------------------------------------------------- board ops */

function boardFromState(state) {
  const b = new Uint8Array(BW * BH);
  for (let y = 0; y < BH; y++) {
    const row = state.board[y];
    for (let x = 0; x < BW; x++) if (row.charCodeAt(x) !== 46) b[y * BW + x] = 1;
  }
  return b;
}

/** Row of the first filled cell in a column, or BH when the column is empty. */
function topRow(board, x) {
  for (let y = 0; y < BH; y++) if (board[y * BW + x]) return y;
  return BH;
}

/**
 * Where a piece at this rotation lands when dropped in this column.
 * Uses each column's first filled row, which is exactly where a gravity drop
 * stops: nothing can pass through a filled cell.
 */
function dropRow(board, cells, x) {
  let y = BH;
  for (let i = 0; i < 4; i++) {
    const cx = x + cells[i][0];
    if (cx < 0 || cx >= BW) return -1;
    const limit = topRow(board, cx) - cells[i][1] - 1;
    if (limit < y) y = limit;
  }
  return y;
}

/** Place, then clear full rows. Returns the new board plus what happened. */
function applyPlacement(board, cells, x, y) {
  const nb = new Uint8Array(BW * BH);
  nb.set(board);
  let fillsWell = false;
  for (let i = 0; i < 4; i++) {
    const cx = x + cells[i][0];
    const cy = y + cells[i][1];
    nb[cy * BW + cx] = 1;
    if (cx === 9) fillsWell = true;
  }

  const full = [];
  for (let r = 0; r < BH; r++) {
    let complete = true;
    for (let c = 0; c < BW; c++) {
      if (!nb[r * BW + c]) { complete = false; break; }
    }
    if (complete) full.push(r);
  }

  let eroded = 0;
  if (full.length) {
    for (let i = 0; i < 4; i++) {
      if (full.indexOf(y + cells[i][1]) !== -1) eroded++;
    }
    let write = BH - 1;
    for (let r = BH - 1; r >= 0; r--) {
      if (full.indexOf(r) !== -1) continue;
      if (write !== r) nb.copyWithin(write * BW, r * BW, r * BW + BW);
      write--;
    }
    for (let r = write; r >= 0; r--) nb.fill(0, r * BW, r * BW + BW);
  }

  return { board: nb, cleared: full.length, fillsWell, eroded };
}

/** Everything the heuristics want to know about a stack, in one pass. */
function measure(board) {
  const heights = new Array(BW).fill(0);
  let holes = 0;
  for (let x = 0; x < BW; x++) {
    const top = topRow(board, x);
    if (top >= BH) continue;
    heights[x] = BH - top;
    for (let y = top + 1; y < BH; y++) if (!board[y * BW + x]) holes++;
  }

  let rowTransitions = 0;
  for (let y = 0; y < BH; y++) {
    let prev = 1; // walls count as filled
    for (let x = 0; x < BW; x++) {
      const cur = board[y * BW + x] ? 1 : 0;
      if (cur !== prev) rowTransitions++;
      prev = cur;
    }
    if (prev === 0) rowTransitions++;
  }

  let colTransitions = 0;
  for (let x = 0; x < BW; x++) {
    let prev = 0; // sky counts as empty
    for (let y = 0; y < BH; y++) {
      const cur = board[y * BW + x] ? 1 : 0;
      if (cur !== prev) colTransitions++;
      prev = cur;
    }
    if (prev === 0) colTransitions++; // floor counts as filled
  }

  let bumpiness = 0;
  let bumpLeft = 0;
  for (let x = 0; x < BW - 1; x++) {
    bumpiness += Math.abs(heights[x] - heights[x + 1]);
    if (x < BW - 2) bumpLeft += Math.abs(heights[x] - heights[x + 1]);
  }

  let wellSums = 0;
  for (let x = 0; x < BW; x++) {
    let depth = 0;
    for (let y = 0; y < BH; y++) {
      const left = x === 0 ? 1 : (board[y * BW + x - 1] ? 1 : 0);
      const right = x === BW - 1 ? 1 : (board[y * BW + x + 1] ? 1 : 0);
      if (!board[y * BW + x] && left && right) { depth++; wellSums += depth; } else depth = 0;
    }
  }

  let aggregate = 0;
  let maxHeight = 0;
  let aggregateNoWell = 0;
  for (let x = 0; x < BW; x++) {
    aggregate += heights[x];
    if (heights[x] > maxHeight) maxHeight = heights[x];
    if (x !== BW - 1) aggregateNoWell += heights[x];
  }

  /* Deepest well anywhere on the board: a column whose neighbours are both
     taller. Walls count as infinitely tall, so an edge well is measured against
     the single column beside it. */
  let wellDepth = 0;
  for (let x = 0; x < BW; x++) {
    const left = x === 0 ? 99 : heights[x - 1];
    const right = x === BW - 1 ? 99 : heights[x + 1];
    const d = Math.min(left, right) - heights[x];
    if (d > wellDepth) wellDepth = d;
  }

  /* The hunter's well is the rightmost column specifically: it is deep enough
     for a Tetris only when every other column has four more rows than it. */
  let well9 = 99;
  for (let x = 0; x < BW - 1; x++) if (heights[x] < well9) well9 = heights[x];
  well9 -= heights[BW - 1];

  /* The four rows a vertical I would clear, and how many cells are missing
     from them outside the well. A gap in these rows is the one thing that can
     veto a Tetris, however flat the stack looks from the column heights. */
  const wellTop = BH - 4 - heights[BW - 1];
  let wellZoneHoles = 0;
  for (let y = Math.max(0, wellTop); y < Math.min(BH - heights[BW - 1], BH); y++) {
    for (let x = 0; x < BW - 1; x++) if (!board[y * BW + x]) wellZoneHoles++;
  }

  return {
    heights, holes, rowTransitions, colTransitions, bumpiness, bumpLeft,
    wellSums, aggregate, aggregateNoWell, maxHeight, wellDepth, well9, wellZoneHoles,
  };
}

/**
 * Dellacherie's shape evaluation, weights as published by Fahey's survey of
 * Tetris heuristics. `w` overrides any term so the set can be swept against the
 * seed list in scripts/tune.mjs.
 */
const DELLACHERIE = {
  landing: -4.500158825082766,
  eroded: 3.4181268101392694,
  rowTransitions: -3.2178882868487753,
  colTransitions: -9.348695305445199,
  holes: -7.899265427351652,
  wellSums: -3.3855972247263626,
};

const dellacherie = (m, landing, eroded, w = DELLACHERIE) => {
  const weight = (key) => (w[key] === undefined ? DELLACHERIE[key] : w[key]);
  return weight('landing') * landing
    + weight('eroded') * eroded
    + weight('rowTransitions') * m.rowTransitions
    + weight('colTransitions') * m.colTransitions
    + weight('holes') * m.holes
    + weight('wellSums') * m.wellSums;
};

/* -------------------------------------------------------------- heuristics */

/**
 * "Best score" judgement: real protocol points first, Dellacherie's shape terms
 * (the weights from Fahey's survey of strong Tetris heuristics) to stay alive,
 * plus the §6 drop points that are easy to forget the bot is also earning.
 */
function evalScore(cfg, board, info) {
  const m = measure(board);
  const landing = BH - (info.y + (info.minDy + info.maxDy + 1) / 2);
  let value = dellacherie(m, landing, info.eroded * info.cleared, cfg.dellacherie);
  /* Danger: how close the stack is to the ceiling. While there is headroom the
     bot plays for points (keep a well, take the 800-point Tetris). Once the stack
     gets tall that stops paying: surviving is what keeps the level multiplier
     alive, so the well reward and the Tetris preference fade out and plain, flat,
     low-risk play takes over. */
  const danger = cfg.dangerFrom === undefined
    ? 0
    : Math.min(1, Math.max(0, (m.maxHeight - cfg.dangerFrom) / Math.max(1, 19 - cfg.dangerFrom)));

  value += cfg.clearWeight * LINE_SCORE[info.cleared];
  value += cfg.dropWeight * (2 * info.dropRows);
  // "Keep the stack low" as an explicit term: it is what survival-first play
  // trades against clearing aggressively. Off by default; swept by tune.mjs.
  value -= (cfg.aggregate || 0) * m.aggregate;
  value += cfg.wellBuild * Math.min(4, m.wellDepth) * (1 - danger * (cfg.dangerWell ?? 1));
  value -= cfg.overDeep * Math.max(0, m.wellDepth - 6);
  if (m.maxHeight >= 16) value -= cfg.danger * (m.maxHeight - 15) ** 2;
  if (info.cleared === 4) value += cfg.tetrisBonus * (1 - danger * (cfg.dangerTetris ?? 1));
  if (m.holes > 0 && info.cleared > 0) value -= cfg.holeClearPenalty * m.holes;
  return value;
}

/**
 * "Tetris only" judgement: the rightmost column is a well and nothing may ever
 * be placed in it, except a vertical I that completes four rows at once. Every
 * other placement is judged on how flat it keeps the other nine columns and how
 * deep the well stays. Non-tetris clears are treated as sabotage, because the
 * only way to clear fewer than four rows is to have filled the well.
 */
function evalHunter(cfg, board, info, state) {
  if (info.cleared === 4) return cfg.tetrisReward - info.dropRows;
  if (info.fillsWell) return -1e6 - info.cleared * 1e4;

  const m = measure(board);
  const depth = m.well9;
  const landing = BH - (info.y + (info.minDy + info.maxDy + 1) / 2);
  let value = 0;
  value -= cfg.aggregate * m.aggregateNoWell;
  value -= cfg.landing * landing;
  value -= cfg.holes * m.holes;
  value -= cfg.bumpiness * m.bumpLeft;
  value += cfg.wellDepth * Math.min(depth, 4);
  // Digging past four rows wastes stack that a Tetris cannot claim back.
  value -= cfg.overDeep * Math.max(0, depth - 4);
  value -= cfg.maxHeight * Math.max(0, m.maxHeight - cfg.maxHeightCap) ** 2;
  // A ready well with an I on the way is worth protecting.
  const iSoon = state.next[0] === 'I' || state.hold === 'I';
  if (iSoon && depth >= 4) value += cfg.iReadyBonus;
  // One row from a Tetris with the I already in hand is the moment to finish it.
  if (iSoon && depth === 3) value += cfg.iReadyBonus * 0.5;
  if (info.cleared > 0) value -= cfg.strayClear * info.cleared * 1000;
  return value;
}

/* --------------------------------------------------------------- planning */

/** Every (rotation, column) a piece can legally be dropped into. */
function candidatesFor(board, type) {
  const list = [];
  for (let rotation = 0; rotation < 4; rotation++) {
    const cells = SHAPES[type][rotation];
    for (let x = -3; x < BW; x++) {
      const y = dropRow(board, cells, x);
      if (y < 0) continue;
      let minDy = 9;
      let maxDy = -9;
      for (let i = 0; i < 4; i++) {
        if (cells[i][1] < minDy) minDy = cells[i][1];
        if (cells[i][1] > maxDy) maxDy = cells[i][1];
      }
      list.push({ rotation, x, y, cells, minDy, maxDy, cost: 0 });
    }
  }
  return list;
}

const rotateCost = (from, to) => {
  const diff = (to - from + 4) % 4;
  return Math.min(diff, 4 - diff);
};

function placementInfo(cand, placed) {
  return {
    y: cand.y, cleared: placed.cleared, fillsWell: placed.fillsWell, eroded: placed.eroded,
    dropRows: cand.y, minDy: cand.minDy, maxDy: cand.maxDy,
  };
}

function scorePlacement(cfg, board, type, cand, state) {
  const placed = applyPlacement(board, cand.cells, cand.x, cand.y);
  const info = placementInfo(cand, placed);
  const value = cfg.mode === 'hunter'
    ? evalHunter(cfg, placed.board, info, state)
    : evalScore(cfg, placed.board, info);
  return { value, board: placed.board, cleared: placed.cleared, placed };
}

/**
 * Best total value of playing out `queue` from `board`, searching `plies` deep.
 * Each ply's worth decays by the lookahead weight so the placement in hand stays
 * dominant, and every level is pruned to its `beam` best placements — the tree
 * is wide (four rotations x ten columns) and only the top of it matters.
 */
function lookaheadBest(cfg, board, queue, state, plies, beam) {
  if (plies < 1 || !queue.length) return 0;
  const weight = cfg.lookaheadWeight ?? LOOKAHEAD_WEIGHT;
  const type = queue[0];
  const scored = [];
  for (const cand of candidatesFor(board, type)) {
    const placed = applyPlacement(board, cand.cells, cand.x, cand.y);
    scored.push({
      value: cfg.mode === 'hunter'
        ? evalHunter(cfg, placed.board, placementInfo(cand, placed), state)
        : evalScore(cfg, placed.board, placementInfo(cand, placed)),
      board: placed.board,
    });
  }
  if (!scored.length) return -Infinity;
  if (plies === 1 || queue.length === 1) {
    let best = -Infinity;
    for (const s of scored) if (s.value > best) best = s.value;
    return best;
  }
  scored.sort((a, b) => b.value - a.value);
  let best = -Infinity;
  for (const s of scored.slice(0, beam)) {
    const total = s.value + weight * lookaheadBest(cfg, s.board, queue.slice(1), state, plies - 1, beam);
    if (total > best) best = total;
  }
  return best;
}

/**
 * Rank placements for the current piece. In `score` mode the top few are then
 * re-scored with the next piece played on top, which is what stops a good bot
 * from burying the piece it is about to receive.
 */
/** Re-score an existing candidate list with a different heuristic. */
function revalue(list, cfg, board, state) {
  const piece = state.piece;
  return list.map((c) => {
    const type = c.useHold ? (state.hold || (state.next && state.next[0])) : piece.type;
    const placed = applyPlacement(board, SHAPES[type][c.rotation], c.x, c.y);
    const info = {
      y: c.y, cleared: placed.cleared, fillsWell: placed.fillsWell, eroded: placed.eroded,
      dropRows: c.y, minDy: c.minDy ?? 0, maxDy: c.maxDy ?? 0,
    };
    return { ...c, value: evalScore(cfg, placed.board, info) };
  });
}

function rankPlacements(cfg, board, state) {
  const piece = state.piece;
  if (!piece) return [];

  /* Many candidates produce the *same* board — an O piece has four identical
     rotations, an I's horizontal rotations land in the same cells, S/Z/T/J/L
     often coincide on a flat surface. Keeping only the cheapest route to each
     distinct board costs nothing in quality and saves real actions, which is the
     scarcest resource in the endgame (the Arena allows 30 actions/second). */
  let scored = [];
  const signatures = new Map();
  const boardKey = (board) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < board.length; i += 1) {
      h ^= board[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const sameBoard = (a, b) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };
  const push = (cand, useHold, value, placed, cost) => {
    const key = boardKey(placed.board);
    const bucket = signatures.get(key);
    if (bucket) {
      for (const index of bucket) {
        const existing = scored[index];
        if (!sameBoard(existing.board, placed.board)) continue;
        if (cost < existing.cost) {
          existing.rotation = cand.rotation;
          existing.x = cand.x;
          existing.useHold = useHold;
          existing.cost = cost;
        }
        return;
      }
      bucket.push(scored.length);
    } else {
      signatures.set(key, [scored.length]);
    }
    scored.push({
      rotation: cand.rotation,
      x: cand.x,
      y: cand.y,
      useHold,
      value,
      cost,
      board: placed.board,
      cleared: placed.cleared,
      fillsWell: placed.fillsWell,
    });
  };

  for (const cand of candidatesFor(board, piece.type)) {
    cand.cost = rotateCost(piece.rotation, cand.rotation) + Math.abs(cand.x - piece.x) + 1;
    const res = scorePlacement(cfg, board, piece.type, cand, state);
    push(cand, false, res.value, res.placed);
  }

  /* The hold slot is a second free option on every piece, so it is ranked in
     the same list: swap in the stashed piece (or the next one) and play that. */
  if (state.can_hold) {
    const incoming = state.hold || (state.next && state.next[0]);
    if (incoming && SHAPES[incoming]) {
      for (const cand of candidatesFor(board, incoming)) {
        cand.cost = 1 + rotateCost(0, cand.rotation) + Math.abs(cand.x - 3) + 1;
        const res = scorePlacement(cfg, board, incoming, cand, state);
        push(cand, true, res.value, res.placed);
      }
    }
  }

  /* Hunter rule, applied to the simulated results.
     1. A four-row clear outranks everything: take it.
     2. On a clean board nothing may touch the well at all.
     3. With holes in the stack the well rule is already broken and clearing rows
        is the only way to dig out, so degrade to score play until it is clean. */
  if (cfg.mode === 'hunter') {
    const tetris = scored.filter((c) => c.cleared === 4);
    const clean = scored.filter((c) => !c.fillsWell);
    const base = measure(board);
    if (tetris.length) {
      scored = [...tetris, ...clean.filter((c) => c.cleared !== 4)];
    } else if (base.well9 >= 4 && base.wellZoneHoles > 0) {
      // Something is missing from the four rows the Tetris needs, so no Tetris
      // can happen until those rows clear. Clearing rows means playing the well:
      // dig out with score play, then go straight back to hunting.
      const diggers = scored.filter((c) => c.cleared > 0);
      scored = revalue(diggers.length ? diggers : scored, SCORE_CFG, board, state);
    } else if (clean.length) {
      scored = clean;
    } else {
      scored = revalue(scored, SCORE_CFG, board, state);
    }
  }

  scored.sort((a, b) => b.value - a.value);

  if (cfg.mode === 'score' && cfg.lookahead && state.next && state.next[0]) {
    const width = cfg.lookaheadCandidates ?? LOOKAHEAD_CANDIDATES;
    const plies = cfg.lookaheadPlies ?? 2;
    const beam = cfg.lookaheadBeam ?? 5;
    const weight = cfg.lookaheadWeight ?? LOOKAHEAD_WEIGHT;
    const head = scored.slice(0, width);
    for (const cand of head) {
      const reply = lookaheadBest(cfg, cand.board, state.next.slice(), state, plies - 1, beam);
      if (reply > -Infinity) cand.value += weight * reply;
    }
    head.sort((a, b) => b.value - a.value);
    return [...head, ...scored.slice(width)];
  }

  return scored;
}

/* -------------------------------------------------------------- the driver */

/**
 * Time, in ms, before the current piece locks if nothing more is done.
 *
 * While a piece is still falling a game reports `lock_timer_ms: null`, so the
 * protocol table is the only estimate available. `assumedLockMs` raises that
 * estimate for games that do not follow the table (see the note in HUNTER_CFG /
 * SCORE_CFG) — it never lowers it, so conformant games are unaffected.
 */
function budgetMs(state, cfg) {
  const cells = state.piece.cells;
  let lowest = 0;
  for (const [, y] of cells) if (y > lowest) lowest = y;
  const rows = BH - 1 - lowest;
  const spec = Math.max(lockDelayMs(state.level), cfg && cfg.assumedLockMs ? cfg.assumedLockMs : 0);
  const lock = state.lock_timer_ms === null ? spec : state.lock_timer_ms;
  return rows * (state.gravity_ms || gravityMs(state.level)) + lock;
}

function makeBot(cfg) {
  /* `info` carries { seed, gameName, deadlineMs }; the bot budgets from the
     live state instead, which is the only thing that is true mid-match. */
  return async function bot(game) {
    let pieceId = -1;
    let ranked = [];
    let actionsThisPiece = 0;
    let idleWaits = 0;
    /* The most recent state we are confident in. Hosts differ in how fresh
       `game.state()` is — the Arena re-pushes its last received update every
       60ms, which can land *after* the reply to an action and roll the bot back
       to what the board looked like before it. The reply to an action is always
       for that action, so it wins. */
    let known = null;

    while (!game.done) {
      const reported = game.state();
      if (reported) {
        /* Accept a state only when it is genuinely newer: a later piece, a later
           clock, or — when the counters tie — one that knows about a piece while
           what we hold says there is none. A host that re-pushes old states must
           never be able to mask the piece we are playing. */
        const newer = !known
          || reported.piece_count > known.piece_count
          || reported.elapsed_ms > known.elapsed_ms
          || (reported.piece_count === known.piece_count && reported.piece && !known.piece && !reported.game_over);
        if (newer) known = reported;
      }
      const state = known;
      if (!state) { await game.sleep(10); continue; }
      if (state.game_over) break;
      if (!state.piece) {
        /* A game may blank `piece` while it animates a clear, and a host that
           re-pushes an old state can hold it blank for a while. Never give up
           on the match because of that: quitting early is scored as finishing,
           which is how a bot can end a match at level 8 with the board half
           empty. Wait for a piece, or for the host to end the match. */
        if (++idleWaits > 5000) break; // ~45s of nothing at all: give up
        await game.sleep(8);
        continue;
      }
      idleWaits = 0;

      if (state.piece_count !== pieceId) {
        pieceId = state.piece_count;
        actionsThisPiece = 0;
        ranked = rankPlacements(cfg, boardFromState(state), state);
      }

      // How many more actions fit before this piece locks?
      const slack = Math.floor((budgetMs(state, cfg) * (cfg.safety ?? SAFETY)) / ACTION_MS) - actionsThisPiece;

      let choice = null;
      for (const cand of ranked) {
        if (cand.useHold && !state.can_hold) continue;
        const cost = rotateCost(state.piece.rotation, cand.rotation)
          + Math.abs(cand.x - state.piece.x)
          + 1
          + (cand.useHold ? 1 : 0);
        if (cost <= slack) { choice = cand; break; }
      }

      // Nothing fits any more: commit where the piece is and take the points.
      if (!choice) {
        await game.input('hard_drop');
        actionsThisPiece++;
        continue;
      }
      let action;
      if (choice.useHold && state.can_hold) {
        action = 'hold';
      } else {
        const diff = (choice.rotation - state.piece.rotation + 4) % 4;
        if (diff === 1 || diff === 2) action = 'rotate_cw';
        else if (diff === 3) action = 'rotate_ccw';
        else if (state.piece.x < choice.x) action = 'right';
        else if (state.piece.x > choice.x) action = 'left';
        else action = 'hard_drop';
      }

      const before = state.piece_count;
      const res = await game.input(action);
      actionsThisPiece++;
      // The reply to *this* action is authoritative for it.
      if (res && res.state && (!known || res.state.piece_count >= known.piece_count)) known = res.state;
      if (res && res.legal === false && action !== 'hard_drop' && !choice.useHold) {
        // Blocked: the board disagrees with the simulation, so think again.
        const now = (res && res.state) || game.state();
        if (now.piece_count === before) ranked = rankPlacements(cfg, boardFromState(now), now);
      }
    }
  };
}

/* Weight sets. Tuned by running tests/bot.spec.cjs over a fixed seed set. */
const SCORE_CFG = {
  mode: 'score',
  lookahead: true,
  lookaheadPlies: 4,
  lookaheadCandidates: 8,
  lookaheadBeam: 3,
  lookaheadWeight: 0.85,
  danger: 12,
  tetrisBonus: 120,
  holeClearPenalty: 6,
  wellBuild: 40,
  overDeep: 8,
  clearWeight: 1.0,
  dropWeight: 1.0,
  // While a piece is falling a game reports lock_timer_ms: null, so the budget
  // estimate falls back on the protocol's table. Games that do not follow the
  // table can hand out far more lock delay than that — one accepted game gives
  // ~220ms at level 17 where the spec says 21ms — and assuming the tiny value
  // makes the bot abandon placements it could comfortably make. This is only a
  // pre-landing estimate: once a piece rests the game reports the real timer and
  // that wins. Measured on the Arena corpus: 205k -> 1.36M on that one game,
  // and no change (232,045 vs 231,607 mean) on protocol-conformant seeds.
  assumedLockMs: 500,
  // Column transitions matter more than Dellacherie's original ratio once the
  // bot is also being paid for line clears: -16 measured best over the seed set
  // (scripts/tune.mjs), ahead of the published -9.35.
  dellacherie: { colTransitions: -16 },
};

const HUNTER_CFG = {
  mode: 'hunter',
  lookahead: false,
  tetrisReward: 1e6,
  aggregate: 0,
  landing: 0,
  holes: 4000,
  bumpiness: 8,
  wellDepth: 52,
  overDeep: 10,
  maxHeight: 120,
  maxHeightCap: 12,
  iReadyBonus: 80,
  strayClear: 1,
};

