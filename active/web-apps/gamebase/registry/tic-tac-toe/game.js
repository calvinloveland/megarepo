/*
 * Tic-Tac-Toe — Gamebase
 *
 * Standard 3x3 rules against an unbeatable perfect-play AI (minimax), a local
 * two-player opponent, or an online opponent found through Gamebase
 * matchmaking. Online play relays the board through the match state API.
 *
 * The pure engine is exposed as the global `TicTacToeEngine` so it can be
 * exercised headlessly with `node`.
 */
(function (root) {
  "use strict";

  const EMPTY = 0, X = 1, O = 2;
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  const other = (p) => (p === X ? O : X);
  const createBoard = () => [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];

  function winnerOf(board) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (board[a] !== EMPTY && board[a] === board[b] && board[a] === board[c]) {
        return { player: board[a], line };
      }
    }
    return null;
  }

  const isFull = (board) => board.every((v) => v !== EMPTY);

  function available(board) {
    const out = [];
    for (let i = 0; i < 9; i++) if (board[i] === EMPTY) out.push(i);
    return out;
  }

  function minimax(board, turn, ai, depth) {
    const win = winnerOf(board);
    if (win) return win.player === ai ? 10 - depth : depth - 10;
    if (isFull(board)) return 0;
    let best = turn === ai ? -Infinity : Infinity;
    for (const move of available(board)) {
      board[move] = turn;
      const score = minimax(board, other(turn), ai, depth + 1);
      board[move] = EMPTY;
      best = turn === ai ? Math.max(best, score) : Math.min(best, score);
    }
    return best;
  }

  function bestMove(board, ai) {
    const moves = available(board);
    if (moves.length === 0) return -1;
    let bestScore = -Infinity;
    let choice = moves[0];
    for (const move of moves) {
      board[move] = ai;
      const score = minimax(board, other(ai), ai, 1);
      board[move] = EMPTY;
      if (score > bestScore) {
        bestScore = score;
        choice = move;
      }
    }
    return choice;
  }

  root.TicTacToeEngine = { EMPTY, X, O, LINES, createBoard, winnerOf, isFull, available, bestMove };

  // ── UI ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    tally: document.getElementById("tally"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    resetTally: document.getElementById("reset-tally"),
  };

  const MODES = ["ai", "local", "online"];
  const MODE_LABELS = {
    ai: "Mode: vs Perfect AI",
    local: "Mode: 2-player",
    online: "Mode: Online",
  };

  const ui = {
    board: createBoard(),
    turn: X,
    human: X,
    ai: O,
    mode: "ai",
    busy: false,
    finished: false,
    winLine: null,
    moveCount: 0,
    tally: { wins: 0, draws: 0, losses: 0, streak: 0 },
    revision: 0,
  };

  const online = {
    matchId: null,
    myId: null,
    opponentId: null,
    myMark: X,
    revision: 0,
    pollTimer: null,
    active: false,
  };

  const manualUnlocks = new Set();
  let cellEls = [];

  function buildBoard() {
    els.board.innerHTML = "";
    cellEls = [];
    for (let i = 0; i < 9; i++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.cell = String(i);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", "cell " + (i + 1));
      button.addEventListener("click", () => onCell(i));
      els.board.appendChild(button);
      cellEls.push(button);
    }
  }

  function myTurn() {
    if (ui.finished || ui.busy) return false;
    if (ui.mode === "ai") return ui.turn === ui.human;
    if (ui.mode === "online") return ui.turn === online.myMark;
    return true;
  }

  function render() {
    for (let i = 0; i < 9; i++) {
      const el = cellEls[i];
      const value = ui.board[i];
      el.textContent = value === X ? "✕" : value === O ? "○" : "";
      el.className = "cell" + (value ? " taken " + (value === X ? "x" : "o") : "");
      if (ui.winLine && ui.winLine.includes(i)) el.classList.add("win");
      el.disabled = Boolean(value) || !myTurn();
    }
    els.tally.textContent = `W ${ui.tally.wins} · D ${ui.tally.draws} · L ${ui.tally.losses}`;
    renderStatus();
  }

  function renderStatus() {
    if (ui.finished) return;
    if (ui.mode === "ai") {
      els.status.textContent = ui.turn === ui.human ? "Your move (✕)" : "AI thinking…";
    } else if (ui.mode === "online") {
      if (!online.matchId) els.status.textContent = "Finding an opponent…";
      else if (ui.turn === online.myMark) els.status.textContent = "Your move (" + (online.myMark === X ? "✕" : "○") + ")";
      else els.status.textContent = "Waiting for opponent…";
    } else {
      els.status.textContent = `${ui.turn === X ? "✕" : "○"} to move`;
    }
  }

  function onCell(i) {
    if (!myTurn() || ui.board[i] !== EMPTY) return;
    place(i, ui.turn);
  }

  function place(i, player) {
    ui.board[i] = player;
    ui.moveCount += 1;
    ui.winLine = null;
    const win = winnerOf(ui.board);
    if (win) {
      ui.winLine = win.line;
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
    if (ui.mode === "online") publishOnline();
  }

  function scheduleAI() {
    ui.busy = true;
    renderStatus();
    setTimeout(() => {
      ui.busy = false;
      if (ui.finished || ui.turn !== ui.ai) return;
      const move = bestMove(ui.board, ui.ai);
      if (move >= 0) place(move, ui.ai);
    }, 220);
  }

  function finish(result) {
    ui.finished = true;
    if (result === "win") {
      ui.tally.wins += 1;
      ui.tally.streak += 1;
    } else if (result === "draw") {
      ui.tally.draws += 1;
      ui.tally.streak = 0;
    } else {
      ui.tally.losses += 1;
      ui.tally.streak = 0;
    }
    manualUnlocks.add("first-game");
    stopOnlinePolling();

    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    const title = result === "win" ? "You win!" : result === "draw" ? "Draw" : "You lose";
    const body = result === "win" ? "Three in a row." : result === "draw" ? "Nobody could find a line." : "The opponent got three in a row.";

    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();

    persistTally();
    if (ui.mode === "online" && online.matchId) {
      Gamebase.reportResult(online.matchId, { result }).catch((err) => console.warn("[tic-tac-toe] reportResult failed", err));
    }
    Gamebase.endRun({
      score,
      meta: { result, mode: ui.mode, moves: ui.moveCount, streak: ui.tally.streak },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[tic-tac-toe] endRun failed", err));
  }

  function newGame() {
    ui.board = createBoard();
    ui.turn = X;
    ui.busy = false;
    ui.finished = false;
    ui.winLine = null;
    ui.moveCount = 0;
    manualUnlocks.clear();
    els.overlay.hidden = true;
    render();
    if (ui.mode === "ai" && ui.turn === ui.ai) scheduleAI();
    if (ui.mode === "online") startOnline();
  }

  // ── Online ────────────────────────────────────────────────────────────────

  function stopOnlinePolling() {
    if (online.pollTimer) {
      clearTimeout(online.pollTimer);
      online.pollTimer = null;
    }
  }

  async function startOnline() {
    stopOnlinePolling();
    online.active = true;
    ui.board = createBoard();
    ui.turn = O;
    ui.finished = false;
    ui.winLine = null;
    ui.moveCount = 0;
    els.overlay.hidden = true;
    render();
    try {
      await Gamebase.findMatch();
      const match = await Gamebase.waitForMatch({ timeout: 120000 });
      if (ui.mode !== "online" || !match) {
        if (ui.mode === "online") els.status.textContent = "No opponent found — try again.";
        return;
      }
      const me = Gamebase.player;
      online.matchId = match.id;
      online.myId = me.id;
      online.opponentId = (match.players.find((p) => p.player_id !== me.id) || {}).player_id || null;
      online.myMark = match.players[0].player_id === me.id ? X : O;
      online.revision = match.revision || 0;
      ui.human = online.myMark;
      ui.turn = online.myMark;
      applyRemote(match.game_state);
      render();
      pollOnline();
    } catch (error) {
      els.status.textContent = "Matchmaking failed: " + error.message;
    }
  }

  function applyRemote(state) {
    if (!state || !state.board) return;
    ui.board = state.board.slice();
    ui.moveCount = ui.board.filter((v) => v !== EMPTY).length;
    const win = winnerOf(ui.board);
    if (win) {
      ui.winLine = win.line;
      finish(win.player === online.myMark ? "win" : "loss");
      return;
    }
    if (isFull(ui.board)) {
      finish("draw");
      return;
    }
    ui.turn = state.turn === online.myId ? online.myMark : other(online.myMark);
  }

  async function publishOnline() {
    if (!online.matchId) return;
    try {
      const saved = await Gamebase.updateMatch(
        online.matchId,
        { board: ui.board.slice(), turn: online.opponentId, moveCount: ui.moveCount },
        online.revision
      );
      if (saved && typeof saved.revision === "number") online.revision = saved.revision;
    } catch (error) {
      if (error.status === 409) {
        const match = await Gamebase.match(online.matchId);
        if (match) {
          online.revision = match.revision || 0;
          applyRemote(match.game_state);
          render();
        }
      } else {
        console.warn("[tic-tac-toe] updateMatch failed", error);
      }
    }
  }

  async function pollOnline() {
    if (ui.mode !== "online" || !online.matchId || ui.finished || !online.active) return;
    try {
      const match = await Gamebase.match(online.matchId);
      if (match && (match.revision || 0) > online.revision) {
        online.revision = match.revision || 0;
        applyRemote(match.game_state);
        render();
      }
    } catch (error) {
      /* keep polling */
    }
    if (!ui.finished) online.pollTimer = setTimeout(pollOnline, 1500);
  }

  // ── Mode + controls ──────────────────────────────────────────────────────

  function setMode(next) {
    ui.mode = next;
    els.modeBtn.textContent = MODE_LABELS[next];
    if (next !== "online") {
      online.active = false;
      stopOnlinePolling();
    }
    newGame();
  }

  function resetTally() {
    ui.tally = { wins: 0, draws: 0, losses: 0, streak: 0 };
    render();
    persistTally();
  }

  function persistTally() {
    if (!root.Gamebase || !Gamebase.player) return;
    Gamebase.saveState({ tally: ui.tally }, { revision: ui.revision })
      .then((saved) => {
        if (saved && typeof saved.revision === "number") ui.revision = saved.revision;
      })
      .catch((err) => console.warn("[tic-tac-toe] saveState failed", err));
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.modeBtn.addEventListener("click", () => {
    const index = MODES.indexOf(ui.mode);
    setMode(MODES[(index + 1) % MODES.length]);
  });
  els.resetTally.addEventListener("click", resetTally);

  buildBoard();
  render();

  Gamebase.ready()
    .then(async (player) => {
      els.tag.textContent = player.handle;
      try {
        const saved = await Gamebase.loadState();
        if (saved && saved.state && saved.state.tally) {
          ui.tally = Object.assign(ui.tally, saved.state.tally);
          ui.revision = saved.revision || 0;
          render();
        }
      } catch (err) {
        console.warn("[tic-tac-toe] loadState failed", err);
      }
      try {
        const best = await Gamebase.myBest();
        if (best) els.tag.textContent = player.handle + " · best " + best.best;
      } catch (err) { /* no best yet */ }
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[tic-tac-toe] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
