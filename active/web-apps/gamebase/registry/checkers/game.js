/*
 * Checkers — Gamebase
 *
 * Standard American checkers (English draughts): forced captures, maximal
 * multi-jump chains, men capture forward only, kings move and capture in all
 * four diagonal directions, crowning ends a jump chain. Includes a small
 * alpha-beta AI. The engine is attached to the global as `CheckersEngine`.
 */
(function (root) {
  "use strict";

  const EMPTY = 0;
  const MAN = 1, KING = 2;
  const WHITE = 0, BLACK = 1;

  const pc = (type, color) => type * 2 + color;
  const ptype = (p) => p >> 1;
  const pcolor = (p) => p & 1;

  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const sq = (f, r) => r * 8 + f;
  const fileOf = (s) => s & 7;
  const rankOf = (s) => s >> 3;
  const playable = (f, r) => (f + r) % 2 === 1;

  const DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  function dirsFor(piece, color) {
    if (ptype(piece) === KING) return DIAG;
    return color === WHITE ? [[-1, -1], [1, -1]] : [[-1, 1], [1, 1]];
  }

  function createState() {
    const board = new Int16Array(64);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (!playable(f, r)) continue;
        if (r <= 2) board[sq(f, r)] = pc(MAN, BLACK);
        else if (r >= 5) board[sq(f, r)] = pc(MAN, WHITE);
      }
    }
    return { board, turn: WHITE, halfmove: 0, undoStack: [], keys: [positionKey({ board, turn: WHITE })] };
  }

  function positionKey(st) {
    let key = st.turn ? "b" : "w";
    for (let i = 0; i < 64; i++) key += String.fromCharCode(48 + st.board[i]);
    return key;
  }

  // --- Jump generation ------------------------------------------------------
  function genJumps(st) {
    const board = st.board;
    const us = st.turn;
    const out = [];

    function dfs(start, cur, path, captures) {
      const piece = board[cur];
      const color = pcolor(piece);
      const promoRow = color === WHITE ? 0 : 7;
      let extended = false;

      for (const [df, dr] of dirsFor(piece, color)) {
        const f = fileOf(cur), r = rankOf(cur);
        const mf = f + df, mr = r + dr, lf = f + 2 * df, lr = r + 2 * dr;
        if (!onBoard(lf, lr) || !onBoard(mf, mr)) continue;
        const mid = sq(mf, mr), land = sq(lf, lr);
        const victim = board[mid];
        if (!victim || pcolor(victim) === color) continue;
        if (board[land] !== EMPTY) continue;

        board[mid] = EMPTY;
        board[cur] = EMPTY;
        board[land] = piece;
        path.push(land);
        captures.push(mid);
        extended = true;

        const promoted = ptype(piece) === MAN && lr === promoRow;
        if (promoted) {
          out.push({ from: start, path: path.slice(), captures: captures.slice() });
        } else {
          dfs(start, land, path, captures);
        }

        path.pop();
        captures.pop();
        board[land] = EMPTY;
        board[cur] = piece;
        board[mid] = victim;
      }

      if (!extended && path.length > 0) {
        out.push({ from: start, path: path.slice(), captures: captures.slice() });
      }
    }

    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (p && pcolor(p) === us) dfs(s, s, [], []);
    }
    return out;
  }

  function genSimple(st) {
    const board = st.board;
    const us = st.turn;
    const out = [];
    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (!p || pcolor(p) !== us) continue;
      const f = fileOf(s), r = rankOf(s);
      for (const [df, dr] of dirsFor(p, us)) {
        const nf = f + df, nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = sq(nf, nr);
        if (board[to] === EMPTY) out.push({ from: s, path: [to], captures: [] });
      }
    }
    return out;
  }

  function legalMoves(st) {
    const jumps = genJumps(st);
    if (jumps.length) return jumps;
    return genSimple(st);
  }

  function hasJumps(st) {
    return genJumps(st).length > 0;
  }

  // --- Make / unmake --------------------------------------------------------
  function makeMove(st, m) {
    const board = st.board;
    const original = board[m.from];
    const color = pcolor(original);
    const promoRow = color === WHITE ? 0 : 7;
    const undo = { piece: original, captured: m.captures.map((c) => board[c]), halfmove: st.halfmove, promoted: false };

    for (const c of m.captures) board[c] = EMPTY;
    board[m.from] = EMPTY;
    const land = m.path[m.path.length - 1];
    if (ptype(original) === MAN && rankOf(land) === promoRow) {
      board[land] = pc(KING, color);
      undo.promoted = true;
    } else {
      board[land] = original;
    }

    st.halfmove = (m.captures.length || ptype(original) === MAN) ? 0 : st.halfmove + 1;
    st.turn = color ^ 1;
    st.undoStack.push(undo);
    return undo;
  }

  function unmakeMove(st, m) {
    const undo = st.undoStack.pop();
    const board = st.board;
    const land = m.path[m.path.length - 1];
    board[m.from] = undo.piece;
    board[land] = EMPTY;
    for (let i = 0; i < m.captures.length; i++) board[m.captures[i]] = undo.captured[i];
    st.halfmove = undo.halfmove;
    st.turn = pcolor(undo.piece);
  }

  // --- Status ---------------------------------------------------------------
  function countPieces(st) {
    let white = 0, black = 0, kings = { w: 0, b: 0 }, men = { w: 0, b: 0 };
    for (let i = 0; i < 64; i++) {
      const p = st.board[i];
      if (!p) continue;
      if (pcolor(p) === WHITE) { white++; if (ptype(p) === KING) kings.w++; else men.w++; }
      else { black++; if (ptype(p) === KING) kings.b++; else men.b++; }
    }
    return { white, black, kings, men };
  }

  function repetitionCount(st) {
    const current = st.keys[st.keys.length - 1];
    let n = 0;
    for (const k of st.keys) if (k === current) n++;
    return n;
  }

  function gameStatus(st) {
    const moves = legalMoves(st);
    if (moves.length === 0) {
      return { over: true, reason: countPieces(st)[st.turn === WHITE ? "white" : "black"] === 0 ? "no-pieces" : "blocked", winner: st.turn ^ 1 };
    }
    if (st.halfmove >= 80) return { over: true, reason: "forty-move", winner: -1 };
    if (repetitionCount(st) >= 3) return { over: true, reason: "threefold", winner: -1 };
    const c = countPieces(st);
    if (c.white === 0 && c.black === 0) return { over: true, reason: "empty", winner: -1 };
    return null;
  }

  // --- Evaluation & search --------------------------------------------------
  // Values are from the side-to-move perspective (negamax convention).
  function evaluate(st) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = st.board[i];
      if (!p) continue;
      const color = pcolor(p);
      const f = fileOf(i), r = rankOf(i);
      let v;
      if (ptype(p) === KING) {
        v = 170;
        // Kings belong near the centre.
        v += 6 * (3.5 - Math.abs(3.5 - f)) * 0.4;
      } else {
        const adv = color === WHITE ? 7 - r : r; // 0..7
        v = 100 + adv * 7;
        if ((color === WHITE && r === 7) || (color === BLACK && r === 0)) v += 8; // defend back row
      }
      score += color === WHITE ? v : -v;
    }
    return st.turn === WHITE ? score : -score;
  }

  const MATE = 100000;

  function orderMoves(moves) {
    moves.sort((a, b) => {
      const ca = a.captures.length + (a.path.length > 1 ? 0.5 : 0);
      const cb = b.captures.length + (b.path.length > 1 ? 0.5 : 0);
      return cb - ca;
    });
  }

  function negamax(st, depth, alpha, beta, ply) {
    const moves = legalMoves(st);
    if (moves.length === 0) return -MATE + ply;
    if (st.halfmove >= 80) return 0;
    const forced = moves[0].captures.length > 0;
    if (depth <= 0 && (!forced || ply > 24)) return evaluate(st);

    orderMoves(moves);
    let best = -Infinity;
    const next = depth <= 0 ? 0 : depth - 1;
    for (const m of moves) {
      makeMove(st, m);
      const val = -negamax(st, next, -beta, -alpha, ply + 1);
      unmakeMove(st, m);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(st, depth) {
    const moves = legalMoves(st);
    if (moves.length === 0) return null;
    orderMoves(moves);
    let alpha = -Infinity;
    let bestScore = -Infinity;
    let candidates = [];
    for (const m of moves) {
      makeMove(st, m);
      const val = -negamax(st, depth - 1, -Infinity, -alpha, 1);
      unmakeMove(st, m);
      if (val > bestScore + 0.5) {
        bestScore = val;
        candidates = [m];
        if (val > alpha) alpha = val;
      } else if (Math.abs(val - bestScore) <= 0.5) {
        candidates.push(m);
      }
    }
    return candidates[Math.floor(Math.random() * candidates.length)] || moves[0];
  }

  root.CheckersEngine = {
    WHITE, BLACK, MAN, KING, pc, ptype, pcolor, sq, fileOf, rankOf, playable,
    createState, positionKey, legalMoves, hasJumps, genJumps, makeMove, unmakeMove,
    gameStatus, evaluate, bestMove, countPieces, repetitionCount,
  };

  // --- UI -------------------------------------------------------------------
  if (typeof document === "undefined") return;

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    tag: document.getElementById("tag"),
    counts: document.getElementById("counts"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    undoBtn: document.getElementById("undo"),
  };

  const ui = {
    st: createState(),
    selected: -1,
    targets: [],
    lastMove: null,
    mode: "ai",
    humanColor: WHITE,
    busy: false,
    finished: false,
    moveCount: 0,
    bestChain: 0,
    moveHistory: [],
  };

  let squareEls = [];

  const MODES = ["ai", "human", "online"];
  const MODE_LABELS = {
    ai: "Mode: vs AI",
    human: "Mode: 2-player",
    online: "Mode: Online",
  };

  const online = {
    matchId: null,
    myId: null,
    opponentId: null,
    myColor: WHITE,
    revision: 0,
    pollTimer: null,
    active: false,
  };

  function localColor() {
    return ui.mode === "online" ? online.myColor : ui.humanColor;
  }

  function buildBoard() {
    els.board.innerHTML = "";
    squareEls = [];
    for (let s = 0; s < 64; s++) {
      const f = fileOf(s), r = rankOf(s);
      const div = document.createElement("div");
      div.className = "sq " + (playable(f, r) ? "dark" : "light") + (playable(f, r) ? " play" : "");
      div.dataset.sq = String(s);
      div.setAttribute("role", "gridcell");
      if (playable(f, r)) div.addEventListener("click", () => onSquareClick(s));
      els.board.appendChild(div);
      squareEls.push(div);
    }
  }

  function render() {
    const st = ui.st;
    for (let s = 0; s < 64; s++) {
      const el = squareEls[s];
      const f = fileOf(s), r = rankOf(s);
      el.className = "sq " + (playable(f, r) ? "dark play" : "light");
      el.innerHTML = "";
      const p = st.board[s];
      if (p) {
        const span = document.createElement("span");
        span.className = "piece " + (pcolor(p) === WHITE ? "w" : "b");
        span.textContent = ptype(p) === KING ? "\u265B" : "";
        el.appendChild(span);
      }
      if (ui.lastMove && (s === ui.lastMove.from || s === ui.lastMove.to)) el.classList.add("last");
      if (s === ui.selected) el.classList.add("sel");
      const target = ui.targets.find((m) => m.to === s);
      if (target) {
        const marker = document.createElement("span");
        marker.className = (p || target.captures.length) ? "ring" : "dot";
        el.appendChild(marker);
      }
    }
    renderCounts();
    renderStatus();
  }

  function renderCounts() {
    const c = countPieces(ui.st);
    els.counts.textContent = `⚪ ${c.white} · ⚫ ${c.black}`;
  }

  function sideName(c) { return c === WHITE ? "White" : "Black"; }

  function renderStatus() {
    if (ui.finished) { els.status.textContent = ui.finishedText || "Game over"; return; }
    const st = ui.st;
    if (ui.mode === "online") {
      if (!online.matchId) els.status.textContent = "Finding an opponent…";
      else if (st.turn === online.myColor) els.status.textContent = "Your move";
      else els.status.textContent = "Waiting for opponent…";
    } else if (ui.mode === "ai") {
      els.status.textContent = st.turn === ui.humanColor ? "Your move (White)" : "AI thinking…";
    } else {
      els.status.textContent = `${sideName(st.turn)} to move`;
    }
  }

  function movesForSelection(s) {
    return legalMoves(ui.st).filter((m) => m.from === s);
  }

  function myTurn() {
    if (ui.busy || ui.finished) return false;
    if (ui.mode === "ai") return ui.st.turn === ui.humanColor;
    if (ui.mode === "online") return Boolean(online.matchId) && ui.st.turn === online.myColor;
    return true;
  }

  function onSquareClick(s) {
    if (!myTurn()) return;
    const st = ui.st;
    const p = st.board[s];
    if (p && pcolor(p) === st.turn) {
      ui.selected = s;
      const grouped = new Map();
      for (const m of movesForSelection(s)) {
        const to = m.path[m.path.length - 1];
        const existing = grouped.get(to);
        if (!existing || m.captures.length > existing.captures.length) grouped.set(to, m);
      }
      ui.targets = Array.from(grouped.values()).map((m) => ({
        to: m.path[m.path.length - 1],
        captures: m.captures,
        move: m,
      }));
      render();
      return;
    }
    const target = ui.targets.find((t) => t.to === s);
    if (target) {
      applyMove(target.move);
    } else {
      ui.selected = -1;
      ui.targets = [];
      render();
    }
  }

  function applyMove(move) {
    const st = ui.st;
    const undo = makeMove(st, move);
    st.keys.push(positionKey(st));
    ui.moveHistory.push(move);
    ui.lastMove = { from: move.from, to: move.path[move.path.length - 1] };
    ui.selected = -1;
    ui.targets = [];
    ui.moveCount += 1;
    if (move.captures.length > ui.bestChain) ui.bestChain = move.captures.length;
    if (undo.promoted && pcolor(undo.piece) === localColor()) manualUnlocks.add("crowned");

    render();
    finishIfOver();
    if (ui.mode === "online") publishOnline();
    else if (!ui.finished && ui.mode === "ai" && st.turn !== ui.humanColor) scheduleAI();
  }

  const manualUnlocks = new Set();

  function scheduleAI() {
    ui.busy = true;
    renderStatus();
    setTimeout(() => {
      if (ui.finished) { ui.busy = false; return; }
      const move = bestMove(ui.st, 5);
      ui.busy = false;
      if (!move) { finishIfOver(); return; }
      applyMove(move);
    }, 60);
  }

  function finishIfOver() {
    if (ui.finished) return;
    const status = gameStatus(ui.st);
    if (!status) return;
    ui.finished = true;
    let result, title, body;
    if (status.winner === -1) {
      result = "draw";
      title = "Draw";
      body = {
        "forty-move": "Drawn by the forty-move rule.",
        threefold: "Drawn by threefold repetition.",
        empty: "Drawn — no pieces remain.",
      }[status.reason] || "Drawn.";
    } else {
      const humanWon = ui.mode === "human"
        ? status.winner === WHITE
        : ui.mode === "online"
          ? status.winner === online.myColor
          : status.winner === ui.humanColor;
      result = humanWon ? "win" : "loss";
      if (ui.mode === "ai") title = humanWon ? "You win!" : "AI wins";
      else if (ui.mode === "online") title = humanWon ? "You win!" : "You lose";
      else title = `${sideName(status.winner)} wins`;
      body = status.reason === "no-pieces" ? "All opposing pieces captured." : "The opponent has no legal moves.";
    }

    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    manualUnlocks.add("first-game");
    ui.finishedText = title;
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();

    if (ui.mode === "online") {
      stopOnlinePolling();
      if (online.matchId) {
        Gamebase.reportResult(online.matchId, { result }).catch((err) => console.warn("[checkers] reportResult failed", err));
      }
    }
    Gamebase.endRun({
      score,
      meta: { result, mode: ui.mode, moves: ui.moveCount, bestChain: ui.bestChain },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[checkers] endRun failed", err));
  }

  function newGame() {
    ui.st = createState();
    ui.selected = -1;
    ui.targets = [];
    ui.lastMove = null;
    ui.busy = false;
    ui.finished = false;
    ui.finishedText = "";
    ui.moveCount = 0;
    ui.bestChain = 0;
    ui.moveHistory = [];
    manualUnlocks.clear();
    els.overlay.hidden = true;
    render();
    if (ui.mode === "ai" && ui.st.turn !== ui.humanColor) scheduleAI();
    else if (ui.mode === "online") startOnline();
  }

  function undo() {
    if (ui.mode === "online") return;
    if (ui.busy || ui.st.undoStack.length === 0) return;
    popOne();
    if (ui.mode === "ai") {
      while (ui.st.undoStack.length && ui.st.turn !== ui.humanColor) popOne();
    }
    ui.finished = false;
    ui.finishedText = "";
    els.overlay.hidden = true;
    ui.selected = -1;
    ui.targets = [];
    render();
  }

  function popOne() {
    const m = ui.moveHistory.pop();
    if (!m) return;
    unmakeMove(ui.st, m);
    ui.st.keys.pop();
    ui.moveCount = Math.max(0, ui.moveCount - 1);
    ui.lastMove = ui.moveHistory.length
      ? { from: ui.moveHistory[ui.moveHistory.length - 1].from, to: ui.moveHistory[ui.moveHistory.length - 1].path.slice(-1)[0] }
      : null;
  }

  // ── Online ────────────────────────────────────────────────────────────────

  function stopOnlinePolling() {
    if (online.pollTimer) {
      clearTimeout(online.pollTimer);
      online.pollTimer = null;
    }
  }

  function serializeCheckers() {
    const st = ui.st;
    return {
      board: Array.from(st.board),
      side: st.turn,
      halfmove: st.halfmove,
      keys: st.keys.slice(),
      moveCount: ui.moveCount,
      bestChain: ui.bestChain,
      turn: online.opponentId,
    };
  }

  function applyOnlineState(state) {
    if (!state || !state.board) return false;
    const st = createState();
    st.board = Int16Array.from(state.board);
    st.turn = typeof state.side === "number" ? state.side : st.turn;
    st.halfmove = typeof state.halfmove === "number" ? state.halfmove : 0;
    st.undoStack = [];
    st.keys = Array.isArray(state.keys) && state.keys.length ? state.keys.slice() : [positionKey(st)];
    ui.st = st;
    ui.moveCount = typeof state.moveCount === "number" ? state.moveCount : 0;
    ui.bestChain = typeof state.bestChain === "number" ? state.bestChain : 0;
    ui.selected = -1;
    ui.targets = [];
    ui.lastMove = null;
    ui.moveHistory = [];
    finishIfOver();
    return true;
  }

  async function startOnline() {
    stopOnlinePolling();
    online.active = true;
    online.matchId = null;
    online.opponentId = null;
    online.revision = 0;
    ui.st = createState();
    ui.selected = -1;
    ui.targets = [];
    ui.lastMove = null;
    ui.busy = false;
    ui.finished = false;
    ui.finishedText = "";
    ui.moveCount = 0;
    ui.bestChain = 0;
    ui.moveHistory = [];
    manualUnlocks.clear();
    els.overlay.hidden = true;
    render();
    try {
      await Gamebase.findMatch();
      const match = await Gamebase.waitForMatch({ timeout: 120000 });
      if (ui.mode !== "online") return;
      if (!match) {
        els.status.textContent = "No opponent found — try again.";
        return;
      }
      const me = Gamebase.player;
      online.matchId = match.id;
      online.myId = me.id;
      online.opponentId = (match.players.find((p) => p.player_id !== me.id) || {}).player_id || null;
      online.myColor = match.players[0].player_id === me.id ? WHITE : BLACK;
      online.revision = match.revision || 0;
      applyOnlineState(match.game_state);
      render();
      pollOnline();
    } catch (error) {
      els.status.textContent = "Matchmaking failed: " + error.message;
    }
  }

  async function publishOnline() {
    if (!online.matchId) return;
    try {
      const saved = await Gamebase.updateMatch(online.matchId, serializeCheckers(), online.revision);
      if (saved && typeof saved.revision === "number") online.revision = saved.revision;
    } catch (error) {
      if (error.status === 409) {
        const match = await Gamebase.match(online.matchId);
        if (match) {
          online.revision = match.revision || 0;
          applyOnlineState(match.game_state);
          render();
        }
      } else {
        console.warn("[checkers] updateMatch failed", error);
      }
    }
  }

  async function pollOnline() {
    if (ui.mode !== "online" || !online.matchId || ui.finished || !online.active) return;
    try {
      const match = await Gamebase.match(online.matchId);
      if (match && (match.revision || 0) > online.revision) {
        online.revision = match.revision || 0;
        applyOnlineState(match.game_state);
        render();
      }
    } catch (error) {
      /* keep polling */
    }
    if (!ui.finished && ui.mode === "online") online.pollTimer = setTimeout(pollOnline, 1500);
  }

  function setMode(next) {
    ui.mode = next;
    els.modeBtn.textContent = MODE_LABELS[next];
    els.undoBtn.hidden = next === "online";
    if (next !== "online") {
      online.active = false;
      stopOnlinePolling();
    }
    newGame();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.modeBtn.addEventListener("click", () => {
    const index = MODES.indexOf(ui.mode);
    setMode(MODES[(index + 1) % MODES.length]);
  });
  els.undoBtn.addEventListener("click", undo);

  let focusSq = 40;
  document.addEventListener("keydown", (e) => {
    const map = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (map[e.key] !== undefined) {
      const target = focusSq + map[e.key];
      if (target >= 0 && target < 64 && Math.abs(fileOf(target) - fileOf(focusSq)) <= 1) {
        squareEls[focusSq].classList.remove("focus");
        focusSq = target;
        squareEls[focusSq].classList.add("focus");
        e.preventDefault();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      onSquareClick(focusSq);
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
      console.warn("[checkers] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
