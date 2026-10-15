/*
 * Reversi (Othello) — Gamebase
 *
 * Standard 8x8 rules: the four center discs start the board, black moves
 * first, and a move is legal only when it flips at least one opposing disc
 * along a line. If the side to move has no legal move it passes; the game
 * ends when neither side can move (or the board is full). The AI is a depth-4
 * alpha-beta negamax with a positional-weight + mobility evaluation.
 *
 * The pure engine is exposed as the global `ReversiEngine` for headless
 * testing with `node`.
 */
(function (root) {
  "use strict";

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const other = (p) => (p === BLACK ? WHITE : BLACK);
  const idx = (r, c) => r * 8 + c;
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  function createBoard() {
    const board = new Array(64).fill(EMPTY);
    board[idx(3, 3)] = WHITE;
    board[idx(3, 4)] = BLACK;
    board[idx(4, 3)] = BLACK;
    board[idx(4, 4)] = WHITE;
    return board;
  }

  // Indices flipped if `player` plays at `i` (empty). Empty when illegal.
  function flipsFor(board, i, player) {
    if (board[i] !== EMPTY) return [];
    const r0 = Math.floor(i / 8), c0 = i % 8;
    const opp = other(player);
    const flips = [];
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr, c = c0 + dc;
      const line = [];
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[idx(r, c)] === opp) {
        line.push(idx(r, c));
        r += dr;
        c += dc;
      }
      if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[idx(r, c)] === player) {
        for (const f of line) flips.push(f);
      }
    }
    return flips;
  }

  function legalMoves(board, player) {
    const out = [];
    for (let i = 0; i < 64; i++) if (flipsFor(board, i, player).length) out.push(i);
    return out;
  }

  function applyMove(board, i, player) {
    const next = board.slice();
    next[i] = player;
    for (const f of flipsFor(board, i, player)) next[f] = player;
    return next;
  }

  function countDiscs(board) {
    let black = 0, white = 0;
    for (const v of board) {
      if (v === BLACK) black++;
      else if (v === WHITE) white++;
    }
    return { black, white };
  }

  const isOver = (board) =>
    legalMoves(board, BLACK).length === 0 && legalMoves(board, WHITE).length === 0;

  const isCorner = (i) => i === 0 || i === 7 || i === 56 || i === 63;

  // Positional weights: corners are gold, squares next to them are traps.
  const WEIGHTS = [
    100, -20, 10, 5, 5, 10, -20, 100,
    -20, -50, -2, -2, -2, -2, -50, -20,
    10, -2, -1, -1, -1, -1, -2, 10,
    5, -2, -1, -1, -1, -1, -2, 5,
    5, -2, -1, -1, -1, -1, -2, 5,
    10, -2, -1, -1, -1, -1, -2, 10,
    -20, -50, -2, -2, -2, -2, -50, -20,
    100, -20, 10, 5, 5, 10, -20, 100,
  ];

  function evaluate(board, player) {
    const opp = other(player);
    let score = 0;
    for (let i = 0; i < 64; i++) {
      if (board[i] === player) score += WEIGHTS[i];
      else if (board[i] === opp) score -= WEIGHTS[i];
    }
    score += (legalMoves(board, player).length - legalMoves(board, opp).length) * 8;
    return score;
  }

  function finalScore(board, player) {
    let diff = 0;
    for (const v of board) {
      if (v === player) diff++;
      else if (v !== EMPTY) diff--;
    }
    if (diff > 0) return 100000 + diff;
    if (diff < 0) return -100000 + diff;
    return 0;
  }

  function negamax(board, player, depth, alpha, beta) {
    const moves = legalMoves(board, player);
    if (moves.length === 0) {
      if (legalMoves(board, other(player)).length === 0) return finalScore(board, player);
      // Pass without spending depth; the opponent's branch will reduce it.
      return -negamax(board, other(player), depth, -beta, -alpha);
    }
    if (depth === 0) return evaluate(board, player);

    moves.sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
    let best = -Infinity;
    for (const move of moves) {
      const next = applyMove(board, move, player);
      const val = -negamax(next, other(player), depth - 1, -beta, -alpha);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(board, player, depth) {
    const moves = legalMoves(board, player);
    if (moves.length === 0) return -1;
    const searchDepth = depth || 4;
    moves.sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
    let bestScore = -Infinity;
    let choice = moves[0];
    for (const move of moves) {
      const next = applyMove(board, move, player);
      const val = -negamax(next, other(player), searchDepth - 1, -Infinity, -bestScore);
      if (val > bestScore) {
        bestScore = val;
        choice = move;
      }
    }
    return choice;
  }

  root.ReversiEngine = {
    EMPTY, BLACK, WHITE, createBoard, flipsFor, legalMoves, applyMove,
    countDiscs, isOver, isCorner, evaluate, bestMove,
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    counts: document.getElementById("counts"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    undoBtn: document.getElementById("undo"),
  };

  const ui = {
    board: createBoard(),
    turn: BLACK,
    human: BLACK,
    ai: WHITE,
    mode: "ai",
    busy: false,
    finished: false,
    history: [],
    lastMove: -1,
    moveCount: 0,
  };

  const manualUnlocks = new Set();
  let squareEls = [];

  function buildBoard() {
    els.board.innerHTML = "";
    squareEls = [];
    for (let i = 0; i < 64; i++) {
      const div = document.createElement("div");
      div.className = "sq";
      div.dataset.sq = String(i);
      div.setAttribute("role", "gridcell");
      div.setAttribute("aria-label", `row ${Math.floor(i / 8) + 1}, column ${(i % 8) + 1}`);
      div.addEventListener("click", () => onSquare(i));
      els.board.appendChild(div);
      squareEls.push(div);
    }
  }

  const sideName = (p) => (p === BLACK ? "Black" : "White");

  function render() {
    const moves = ui.finished ? [] : legalMoves(ui.board, ui.turn);
    const humanTurn = ui.mode === "human" || ui.turn === ui.human;
    for (let i = 0; i < 64; i++) {
      const el = squareEls[i];
      el.className = "sq" + (moves.includes(i) && humanTurn ? " play" : "") +
        (i === ui.lastMove ? " last" : "");
      el.innerHTML = "";
      const v = ui.board[i];
      if (v !== EMPTY) {
        const disc = document.createElement("span");
        disc.className = "disc " + (v === BLACK ? "black" : "white");
        el.appendChild(disc);
      } else if (moves.includes(i) && humanTurn) {
        const dot = document.createElement("span");
        dot.className = "dot";
        el.appendChild(dot);
      }
    }
    const counts = countDiscs(ui.board);
    els.counts.textContent = `⚫ ${counts.black} · ⚪ ${counts.white}`;
    renderStatus();
  }

  function renderStatus() {
    if (ui.finished) return;
    if (ui.mode === "ai") {
      els.status.textContent = ui.turn === ui.human ? "Your move (black)" : "AI thinking…";
    } else {
      els.status.textContent = `${sideName(ui.turn)} to move`;
    }
  }

  function onSquare(i) {
    if (ui.busy || ui.finished) return;
    if (ui.mode === "ai" && ui.turn !== ui.human) return;
    if (!flipsFor(ui.board, i, ui.turn).length) return;
    place(i);
  }

  function place(i) {
    ui.history.push({ board: ui.board.slice(), turn: ui.turn, lastMove: ui.lastMove, moveCount: ui.moveCount });
    const player = ui.turn;
    ui.board = applyMove(ui.board, i, player);
    ui.lastMove = i;
    ui.moveCount += 1;
    if (player === ui.human && isCorner(i)) manualUnlocks.add("corner-grab");
    ui.turn = other(player);
    render();
    afterMove();
  }

  function afterMove() {
    if (ui.finished) return;
    if (isOver(ui.board)) {
      finishGame();
      return;
    }
    if (legalMoves(ui.board, ui.turn).length === 0) {
      const passer = ui.turn;
      ui.turn = other(passer);
      ui.history.push({ board: ui.board.slice(), turn: passer, lastMove: ui.lastMove, moveCount: ui.moveCount });
      render();
      els.status.textContent = `${sideName(passer)} has no move — passing`;
      ui.busy = true;
      setTimeout(() => {
        ui.busy = false;
        if (ui.finished) return;
        render();
        if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
      }, 650);
      return;
    }
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
  }

  function scheduleAI() {
    ui.busy = true;
    renderStatus();
    setTimeout(() => {
      ui.busy = false;
      if (ui.finished || ui.turn !== ui.ai) return;
      const move = bestMove(ui.board, ui.ai, 4);
      if (move < 0) {
        afterMove();
        return;
      }
      place(move);
    }, 90);
  }

  function finishGame() {
    ui.finished = true;
    const { black, white } = countDiscs(ui.board);
    const margin = Math.abs(black - white);
    let result, title, body;
    if (black === white) {
      result = "draw";
      title = "Draw";
      body = `Both sides finish on ${black} discs.`;
    } else {
      const humanWon = black > white; // human is always black
      result = humanWon ? "win" : "loss";
      if (ui.mode === "ai") title = humanWon ? "You win!" : "AI wins";
      else title = `${sideName(black > white ? BLACK : WHITE)} wins`;
      body = `Black ${black} · White ${white}.`;
    }

    manualUnlocks.add("first-game");
    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();

    Gamebase.endRun({
      score,
      meta: { result, mode: ui.mode, moves: ui.moveCount, margin },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[reversi] endRun failed", err));
  }

  function newGame() {
    ui.board = createBoard();
    ui.turn = BLACK;
    ui.busy = false;
    ui.finished = false;
    ui.history = [];
    ui.lastMove = -1;
    ui.moveCount = 0;
    manualUnlocks.clear();
    els.overlay.hidden = true;
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
  }

  function undo() {
    if (ui.busy || ui.history.length === 0) return;
    popSnapshot();
    if (ui.mode === "ai") {
      while (ui.history.length && ui.turn !== ui.human) popSnapshot();
    }
    ui.finished = false;
    els.overlay.hidden = true;
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
  }

  function popSnapshot() {
    const snap = ui.history.pop();
    if (!snap) return;
    ui.board = snap.board;
    ui.turn = snap.turn;
    ui.lastMove = snap.lastMove;
    ui.moveCount = snap.moveCount;
  }

  function setMode(next) {
    ui.mode = next;
    els.modeBtn.textContent = next === "ai" ? "Mode: vs AI" : "Mode: 2-player";
    newGame();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.modeBtn.addEventListener("click", () => setMode(ui.mode === "ai" ? "human" : "ai"));
  els.undoBtn.addEventListener("click", undo);

  let focusSq = 27;
  document.addEventListener("keydown", (e) => {
    const map = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (map[e.key] !== undefined) {
      const target = focusSq + map[e.key];
      if (target >= 0 && target < 64 && Math.abs((target % 8) - (focusSq % 8)) <= 1) {
        squareEls[focusSq].classList.remove("focus");
        focusSq = target;
        squareEls[focusSq].classList.add("focus");
        e.preventDefault();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      onSquare(focusSq);
      e.preventDefault();
    }
  });

  buildBoard();
  render();

  Gamebase.ready()
    .then((player) => {
      els.tag.textContent = player.handle;
      return Gamebase.myBest();
    })
    .then((best) => {
      if (best && Gamebase.player) els.tag.textContent = Gamebase.player.handle + " · best " + best.best;
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[reversi] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
