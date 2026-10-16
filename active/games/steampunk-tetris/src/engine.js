/*
 * Tetris Protocol v2 engine — pure logic, no DOM.
 *
 * Keeping this DOM-free means the same code runs the live page and the Node
 * test suite, so the rules cannot drift between what we ship and what we test.
 *
 * Timing contract: the host calls `tick(nowMs)` with a monotonic clock
 * (performance.now() in the browser). The engine never reads a clock itself and
 * never counts frames — PROTOCOL.md §4 is explicit that gravity comes from
 * elapsed wall-clock time.
 */

import {
  BOARD_H, BOARD_W, LINE_SCORES, MAX_LOCK_RESETS, PIECE_CELLS, PIECE_TYPES,
  SPAWN_X, SPAWN_Y, SRS_KICKS, gravityForLevel, hashSeed, levelForLines,
  lockDelayForLevel, makeRng, nextBag,
} from './constants.js';

const emptyBoard = () => Array.from({ length: BOARD_H }, () => new Array(BOARD_W).fill('.'));

export class TetrisEngine {
  constructor(opts = {}) {
    this.reset(opts);
  }

  /* ------------------------------------------------------------- lifecycle */

  /** §7 `new`. Both fields are optional; seed defaults to "arena". */
  reset({ seed = 'arena', sequence = null } = {}) {
    this.board = emptyBoard();
    this.seed = typeof seed === 'string' ? seed : 'arena';
    this.rng = makeRng(hashSeed(this.seed));
    this.sequence = typeof sequence === 'string'
      ? sequence.split('').filter((c) => PIECE_TYPES.includes(c))
      : [];

    this.queue = [];
    this.hold = null;
    this.canHold = true;

    this.score = 0;
    this.lines = 0;
    this.level = 1;

    this.elapsedMs = 0;
    this.gravityAcc = 0;
    this.paused = false;
    this.gameOver = false;
    this.lastNow = null;

    this.lockTimerMs = null;
    this.lockResets = 0;
    this.softDropCells = 0;
    this.hardDropRows = 0;
    this.pieceCount = 0;
    this.pieceStats = Object.fromEntries(PIECE_TYPES.map((t) => [t, 0]));
    this.lineClears = { 1: 0, 2: 0, 3: 0, 4: 0 };
    this.tetrises = 0;
    this.perfectClears = 0;
    this.lastClear = { lines: 0, at: 0, perfect: false, spin: null };
    this.events = [];

    this.piece = null;
    this.spawn(null);
    return this;
  }

  setPaused(paused) {
    /* The protocol's clock stops entirely while paused: we stop accumulating
       elapsed time and gravity, and restart the frame delta on unpause. */
    this.paused = !!paused;
    this.lastNow = null;
    this.emit(this.paused ? 'pause' : 'resume');
  }

  /* ----------------------------------------------------------- piece queue */

  ensureQueue(min = 6) {
    while (this.queue.length < min) {
      if (this.sequence.length) {
        this.queue.push(this.sequence.shift());
      } else {
        for (const t of nextBag(this.rng)) this.queue.push(t);
      }
    }
  }

  /** §2 spawn: x=3, y=0, rotation 0. Game over if the spawn overlaps. */
  spawn(type) {
    const t = type || (this.ensureQueue(), this.queue.shift());
    this.ensureQueue();
    this.piece = { type: t, x: SPAWN_X, y: SPAWN_Y, rotation: 0 };
    this.pieceCount += 1;
    this.pieceStats[t] = (this.pieceStats[t] || 0) + 1;
    this.gravityAcc = 0;
    this.lockTimerMs = null;
    this.lockResets = 0;
    this.emit('spawn', t);
    if (!this.isValid(this.piece)) this.endGame();
    return this.piece;
  }

  endGame() {
    this.gameOver = true;
    this.piece = null;
    this.lockTimerMs = null;
    this.emit('gameover');
  }

  /* ------------------------------------------------------------ geometry */

  /** Absolute [col, row] cells of a piece, mirroring `piece.cells` in §7. */
  cellsOf(piece) {
    return PIECE_CELLS[piece.type][piece.rotation].map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
  }

  /** §1 — every cell must be on the board and clear. */
  isValid(piece) {
    const cw = BOARD_W, ch = BOARD_H;
    for (const [dx, dy] of PIECE_CELLS[piece.type][piece.rotation]) {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (x < 0 || x >= cw || y < 0 || y >= ch) return false;
      if (this.board[y][x] !== '.') return false;
    }
    return true;
  }

  canMoveDown(piece = this.piece) {
    if (!piece) return false;
    return this.isValid({ ...piece, y: piece.y + 1 });
  }

  isResting(piece = this.piece) {
    return !!piece && !this.canMoveDown(piece);
  }

  /* -------------------------------------------------------------- actions */

  /** §5. Returns true when the action was legal; illegal actions change nothing. */
  applyAction(action) {
    if (this.gameOver || !this.piece) return false;
    switch (action) {
      case 'left': return this.shift(-1);
      case 'right': return this.shift(1);
      case 'rotate_cw': return this.rotate(1);
      case 'rotate_ccw': return this.rotate(3);
      case 'soft_drop': return this.softDrop();
      case 'hard_drop': return this.hardDrop();
      case 'hold': return this.swapHold();
      default: return false;
    }
  }

  shift(dx) {
    const next = { ...this.piece, x: this.piece.x + dx };
    if (!this.isValid(next)) return false;
    this.piece = next;
    this.settle({ resetTimer: true });
    this.emit('move');
    return true;
  }

  /** §2 — in place first, then the tabulated SRS kicks, first legal one wins. */
  rotate(dir) {
    const from = this.piece.rotation;
    const to = (from + dir) % 4;
    const table = this.piece.type === 'O'
      ? []
      : (this.piece.type === 'I' ? SRS_KICKS.I : SRS_KICKS.JLSTZ)[`${from}>${to}`] || [];

    for (const [dx, dy] of [[0, 0], ...table]) {
      const candidate = { ...this.piece, rotation: to, x: this.piece.x + dx, y: this.piece.y + dy };
      if (!this.isValid(candidate)) continue;
      this.piece = candidate;
      this.settle({ resetTimer: true });
      this.emit('rotate', { from, to, kick: [dx, dy] });
      return true;
    }
    return false;
  }

  /** §5 — legal only while the piece can still fall; never locks, never resets lock delay. */
  softDrop() {
    if (!this.canMoveDown()) return false;
    this.piece = { ...this.piece, y: this.piece.y + 1 };
    this.score += 1;
    this.softDropCells += 1;
    this.gravityAcc = 0;
    this.settle({ resetTimer: false });
    this.emit('softdrop');
    return true;
  }

  /** §5 — fall as far as possible, then lock immediately, ignoring lock delay. */
  hardDrop() {
    let rows = 0;
    while (this.canMoveDown()) {
      this.piece = { ...this.piece, y: this.piece.y + 1 };
      rows += 1;
    }
    this.score += 2 * rows;
    this.hardDropRows += rows;
    this.emit('harddrop', rows);
    this.lock(true);
    return true;
  }

  /** §5 — once per piece, until the next piece locks. */
  swapHold() {
    if (!this.canHold) return false;
    const current = this.piece.type;
    const incoming = this.hold;
    this.hold = current;
    this.spawn(incoming || null);
    this.canHold = false;
    this.emit('hold');
    return true;
  }

  /**
   * §4 lock delay. While the piece rests, a successful move/rotate restarts the
   * timer, up to 15 times per piece; past the cap the timer runs to expiry.
   * A soft drop may start the timer (the piece just came to rest) but never
   * resets it.
   */
  settle({ resetTimer }) {
    if (!this.isResting()) {
      this.lockTimerMs = null;
      return;
    }
    if (this.lockTimerMs === null) {
      this.lockTimerMs = lockDelayForLevel(this.level);
      return;
    }
    if (resetTimer && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimerMs = lockDelayForLevel(this.level);
      this.lockResets += 1;
    }
  }

  /* ------------------------------------------------- locking and clearing */

  lock(hard = false) {
    if (!this.piece) return;
    const type = this.piece.type;
    const spin = this.detectTSpin(this.piece);
    for (const [x, y] of this.cellsOf(this.piece)) this.board[y][x] = type;

    const rows = [];
    for (let y = 0; y < BOARD_H; y++) {
      if (this.board[y].every((c) => c !== '.')) rows.push(y);
    }
    const cleared = this.clearLines();
    if (cleared > 0) {
      this.score += LINE_SCORES[cleared] * this.level; // level BEFORE the clear (§6)
      this.lines += cleared;
      this.level = levelForLines(this.lines);
      this.lineClears[cleared] += 1;
      if (cleared === 4) this.tetrises += 1;
      const perfect = this.board.every((row) => row.every((c) => c === '.'));
      if (perfect) this.perfectClears += 1;
      this.lastClear = { lines: cleared, at: this.elapsedMs, perfect, spin };
      this.emit('clear', { lines: cleared, perfect, rows, spin });
    }

    this.piece = null;
    this.lockTimerMs = null;
    this.canHold = true;
    if (!hard) this.emit('lock', type);
    this.spawn(null);
  }

  clearLines() {
    const kept = [];
    let cleared = 0;
    for (let y = 0; y < BOARD_H; y++) {
      if (this.board[y].every((c) => c !== '.')) cleared += 1;
      else kept.push(this.board[y]);
    }
    while (kept.length < BOARD_H) kept.unshift(new Array(BOARD_W).fill('.'));
    this.board = kept;
    return cleared;
  }

  /**
   * Display-only T-spin detection (the 3-corner rule) and perfect-clear flagging.
   * FEATURES.md allows both *provided they never touch `score`* — they are HUD
   * decoration, and the score table in §6 is the only thing that pays out.
   */
  detectTSpin(piece) {
    if (!piece || piece.type !== 'T') return null;
    const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
    let filled = 0;
    for (const [cx, cy] of corners) {
      const x = piece.x + cx;
      const y = piece.y + cy;
      if (x < 0 || x >= BOARD_W || y >= BOARD_H) { filled += 1; continue; }
      if (y >= 0 && this.board[y][x] !== '.') filled += 1;
    }
    if (filled < 3) return null;
    const contested = [[piece.x - 1, piece.y + 1], [piece.x + 3, piece.y + 1]];
    const wall = contested.filter(([x, y]) => x < 0 || x >= BOARD_W || y >= BOARD_H || this.board[y]?.[x] !== '.').length;
    return wall === 2 ? 't-spin' : 't-spin-mini';
  }

  /* ------------------------------------------------------------------ time */

  /**
   * §4. Apply every gravity step that is now due, then run the lock delay.
   * A single call can advance several rows (a slow frame, or a throttled tab).
   */
  tick(now) {
    if (this.lastNow === null) {
      this.lastNow = now;
      return;
    }
    let dt = now - this.lastNow;
    this.lastNow = now;
    if (!(dt > 0)) return;
    if (dt > 5000) dt = 5000; // a stalled tab must not fast-forward the stack
    if (this.paused || this.gameOver || !this.piece) return;

    this.elapsedMs += dt;

    const gravity = gravityForLevel(this.level);
    this.gravityAcc += dt;
    let steps = 0;
    while (this.gravityAcc >= gravity && this.piece && !this.gameOver && steps < 64) {
      if (!this.canMoveDown()) {
        this.gravityAcc = 0;
        break;
      }
      this.piece = { ...this.piece, y: this.piece.y + 1 };
      this.gravityAcc -= gravity;
      steps += 1;
      this.settle({ resetTimer: false });
    }
    if (this.gravityAcc > gravity * 64) this.gravityAcc = 0;

    if (this.piece && this.isResting()) {
      if (this.lockTimerMs === null) this.lockTimerMs = lockDelayForLevel(this.level);
      this.lockTimerMs -= dt;
      if (this.lockTimerMs <= 0) {
        this.lockTimerMs = 0;
        this.lock();
      }
    }
  }

  /* ------------------------------------------------------------ protocol */

  /** §7 state object. */
  toState() {
    const piece = this.piece;
    return {
      board: this.board.map((row) => row.join('')),
      piece: piece
        ? {
          type: piece.type,
          x: piece.x,
          y: piece.y,
          rotation: piece.rotation,
          cells: this.cellsOf(piece),
        }
        : null,
      next: this.queue.slice(0, 5),
      hold: this.hold,
      can_hold: this.canHold,
      score: this.score,
      lines: this.lines,
      level: this.level,
      game_over: this.gameOver,
      elapsed_ms: Math.floor(this.elapsedMs),
      gravity_ms: gravityForLevel(this.level),
      lock_timer_ms: this.lockTimerMs === null ? null : Math.max(0, Math.round(this.lockTimerMs)),
      piece_count: this.pieceCount,
    };
  }

  /** Where the current piece would land — used by the ghost piece. */
  ghostY() {
    if (!this.piece) return null;
    let y = this.piece.y;
    while (this.isValid({ ...this.piece, y: y + 1 })) y += 1;
    return y;
  }

  /* Debug/diagnostics channel for the renderer; not part of the protocol. */
  emit(type, detail) {
    this.events.push({ type, detail, at: this.elapsedMs });
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
