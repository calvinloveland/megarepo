/*
 * Connect Four — Gamebase
 *
 * Standard 7x6 rules: gravity drops, four-in-a-row (horizontal, vertical, or
 * either diagonal) wins, full board draws. The AI is a depth-5 alpha-beta
 * minimax with a window-counting heuristic and center-first move ordering.
 *
 * The pure engine is exposed as the global `ConnectFourEngine` for headless
 * testing with `node`.
 */
(function (root) {
  "use strict";

  const ROWS = 6, COLS = 7;
  const EMPTY = 0, P1 = 1, P2 = 2;
  const idx = (r, c) => r * COLS + c;
  const other = (p) => (p === P1 ? P2 : P1);

  const createBoard = () => new Array(ROWS * COLS).fill(EMPTY);

  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[idx(r, col)] === EMPTY) return r;
    return -1;
  }

  function applyDrop(board, col, player) {
    const r = dropRow(board, col);
    if (r < 0) return null;
    const next = board.slice();
    next[idx(r, col)] = player;
    return { board: next, row: r, index: idx(r, col) };
  }

  function validCols(board) {
    const out = [];
    for (let c = 0; c < COLS; c++) if (board[idx(0, c)] === EMPTY) out.push(c);
    return out;
  }

  const isFull = (board) => board.every((v) => v !== EMPTY);

  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function findWin(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const player = board[idx(r, c)];
        if (player === EMPTY) continue;
        for (const [dr, dc] of DIRS) {
          const cells = [idx(r, c)];
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[idx(rr, cc)] === player) {
            cells.push(idx(rr, cc));
            rr += dr;
            cc += dc;
          }
          if (cells.length >= 4) return { player, cells };
        }
      }
    }
    return null;
  }

  function lineIsDiagonal(cells) {
    if (cells.length < 2) return false;
    const r0 = Math.floor(cells[0] / COLS), c0 = cells[0] % COLS;
    const r1 = Math.floor(cells[1] / COLS), c1 = cells[1] % COLS;
    return Math.abs(r1 - r0) === 1 && Math.abs(c1 - c0) === 1;
  }

  function scoreWindow(board, cells, ai, opp) {
    let a = 0, o = 0;
    for (const i of cells) {
      const v = board[i];
      if (v === ai) a++;
      else if (v === opp) o++;
    }
    if (a && o) return 0;
    if (a === 4) return 10000;
    if (o === 4) return -10000;
    if (a === 3) return 60;
    if (o === 3) return -80;
    if (a === 2) return 8;
    if (o === 2) return -10;
    return 0;
  }

  function evaluate(board, ai) {
    const opp = other(ai);
    let score = 0;
    for (let r = 0; r < ROWS; r++) {
      const v = board[idx(r, 3)];
      if (v === ai) score += 3;
      else if (v === opp) score -= 3;
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 3 < COLS) score += scoreWindow(board, [idx(r, c), idx(r, c + 1), idx(r, c + 2), idx(r, c + 3)], ai, opp);
        if (r + 3 < ROWS) score += scoreWindow(board, [idx(r, c), idx(r + 1, c), idx(r + 2, c), idx(r + 3, c)], ai, opp);
        if (r + 3 < ROWS && c + 3 < COLS) score += scoreWindow(board, [idx(r, c), idx(r + 1, c + 1), idx(r + 2, c + 2), idx(r + 3, c + 3)], ai, opp);
        if (r + 3 < ROWS && c - 3 >= 0) score += scoreWindow(board, [idx(r, c), idx(r + 1, c - 1), idx(r + 2, c - 2), idx(r + 3, c - 3)], ai, opp);
      }
    }
    return score;
  }

  function orderedCols(board) {
    const order = [3, 2, 4, 1, 5, 0, 6];
    return order.filter((c) => board[idx(0, c)] === EMPTY);
  }

  const WIN_SCORE = 1000000;

  function minimax(board, depth, alpha, beta, maximizing, ai) {
    const win = findWin(board);
    if (win) return win.player === ai ? WIN_SCORE + depth : -WIN_SCORE - depth;
    if (isFull(board)) return 0;
    if (depth === 0) return evaluate(board, ai);

    const opp = other(ai);
    const cols = orderedCols(board);
    if (maximizing) {
      let best = -Infinity;
      for (const c of cols) {
        const res = applyDrop(board, c, ai);
        const val = minimax(res.board, depth - 1, alpha, beta, false, ai);
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const c of cols) {
      const res = applyDrop(board, c, opp);
      const val = minimax(res.board, depth - 1, alpha, beta, true, ai);
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(board, ai, depth) {
    const cols = orderedCols(board);
    if (cols.length === 0) return -1;
    const searchDepth = depth || 5;
    let bestScore = -Infinity;
    let choice = cols[0];
    for (const c of cols) {
      const res = applyDrop(board, c, ai);
      const val = minimax(res.board, searchDepth - 1, -Infinity, Infinity, false, ai);
      if (val > bestScore) {
        bestScore = val;
        choice = c;
      }
    }
    return choice;
  }

  root.ConnectFourEngine = {
    ROWS, COLS, EMPTY, P1, P2, createBoard, dropRow, applyDrop, validCols,
    isFull, findWin, lineIsDiagonal, evaluate, bestMove,
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
    turn: P1,
    human: P1,
    ai: P2,
    mode: "ai",
    busy: false,
    finished: false,
    winCells: [],
    lastIndex: -1,
    moveCount: 0,
    history: [],
  };

  const manualUnlocks = new Set();
  let cellEls = [];

  function buildBoard() {
    els.board.innerHTML = "";
    cellEls = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.dataset.col = String(c);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `column ${c + 1}, row ${r + 1}`);
        cell.addEventListener("click", () => onColumn(c));
        els.board.appendChild(cell);
        cellEls.push(cell);
      }
    }
  }

  function render() {
    for (let i = 0; i < ROWS * COLS; i++) {
      const el = cellEls[i];
      const v = ui.board[i];
      el.className = "cell" + (v === P1 ? " p1" : v === P2 ? " p2" : "") +
        (ui.winCells.includes(i) ? " win" : "") + (i === ui.lastIndex ? " last" : "");
      el.innerHTML = v ? '<span class="disc"></span>' : "";
      const colFull = ui.board[idx(0, i % COLS)] !== EMPTY;
      el.disabled = ui.finished || colFull || (ui.mode === "ai" && ui.turn !== ui.human);
    }
    const c1 = ui.board.filter((v) => v === P1).length;
    const c2 = ui.board.filter((v) => v === P2).length;
    els.counts.textContent = `🔴 ${c1} · 🟡 ${c2}`;
    renderStatus();
  }

  function renderStatus() {
    if (ui.finished) return;
    if (ui.mode === "ai") {
      els.status.textContent = ui.turn === ui.human ? "Your move (red)" : "AI thinking…";
    } else {
      els.status.textContent = `${ui.turn === P1 ? "Red" : "Yellow"} to move`;
    }
  }

  function onColumn(col) {
    if (ui.finished || ui.busy) return;
    if (ui.mode === "ai" && ui.turn !== ui.human) return;
    if (dropRow(ui.board, col) < 0) return;
    drop(col, ui.turn);
  }

  function drop(col, player) {
    const res = applyDrop(ui.board, col, player);
    if (!res) return;
    ui.board = res.board;
    ui.lastIndex = res.index;
    ui.moveCount += 1;
    ui.history.push({ col, player });

    const win = findWin(ui.board);
    if (win) {
      ui.winCells = win.cells;
      if (win.player === ui.human && lineIsDiagonal(win.cells)) manualUnlocks.add("diagonal");
      finish(win.player === ui.human ? "win" : "loss");
      return;
    }
    if (isFull(ui.board)) {
      finish("draw");
      return;
    }
    ui.turn = other(player);
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
  }

  function scheduleAI() {
    ui.busy = true;
    renderStatus();
    setTimeout(() => {
      ui.busy = false;
      if (ui.finished || ui.turn !== ui.ai) return;
      const col = bestMove(ui.board, ui.ai, 5);
      if (col >= 0) drop(col, ui.ai);
    }, 120);
  }

  function finish(result) {
    ui.finished = true;
    manualUnlocks.add("first-game");
    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    const title = result === "win" ? "You win!" : result === "draw" ? "Draw" : "You lose";
    const body = result === "win"
      ? "Four in a row!"
      : result === "draw"
        ? "The board filled with no line of four."
        : "The opponent connected four.";

    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();

    Gamebase.endRun({
      score,
      meta: { result, mode: ui.mode, moves: ui.moveCount },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[connect-four] endRun failed", err));
  }

  function newGame() {
    ui.board = createBoard();
    ui.turn = P1;
    ui.busy = false;
    ui.finished = false;
    ui.winCells = [];
    ui.lastIndex = -1;
    ui.moveCount = 0;
    ui.history = [];
    manualUnlocks.clear();
    els.overlay.hidden = true;
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
  }

  function undo() {
    if (ui.busy || ui.history.length === 0) return;
    popOne();
    if (ui.mode === "ai") {
      while (ui.history.length && ui.turn !== ui.human) popOne();
    }
    ui.finished = false;
    ui.winCells = [];
    els.overlay.hidden = true;
    render();
  }

  function popOne() {
    const move = ui.history.pop();
    if (!move) return;
    // The removed disc is the top of its column: the first filled row from the top.
    for (let r = 0; r < ROWS; r++) {
      if (ui.board[idx(r, move.col)] !== EMPTY) {
        ui.board[idx(r, move.col)] = EMPTY;
        break;
      }
    }
    ui.turn = move.player;
    ui.moveCount = Math.max(0, ui.moveCount - 1);
    ui.lastIndex = -1;
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
      console.warn("[connect-four] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
