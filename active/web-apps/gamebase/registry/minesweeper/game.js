/*
 * Minesweeper — Gamebase
 *
 * Classic rules with a safe first click: mines are placed only after the
 * first reveal, excluding the clicked cell (and its neighbors when the board
 * has room). Flags block reveals, zero cells flood-reveal, and clicking a
 * revealed number "chords" when its adjacent flags match. Score rewards cells
 * revealed plus a time bonus on a win.
 *
 * The pure engine is exposed as the global `MinesweeperEngine` for headless
 * testing with `node`.
 */
(function (root) {
  "use strict";

  const DIFFICULTIES = {
    beginner: { rows: 9, cols: 9, mines: 10, label: "Beginner", base: 1000 },
    intermediate: { rows: 16, cols: 16, mines: 40, label: "Intermediate", base: 2500 },
    expert: { rows: 16, cols: 30, mines: 99, label: "Expert", base: 5000 },
  };

  function createGame(difficulty) {
    const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.beginner;
    const total = cfg.rows * cfg.cols;
    return {
      difficulty: DIFFICULTIES[difficulty] ? difficulty : "beginner",
      rows: cfg.rows,
      cols: cfg.cols,
      mines: cfg.mines,
      base: cfg.base,
      mine: new Array(total).fill(false),
      adj: new Array(total).fill(0),
      revealed: new Array(total).fill(false),
      flagged: new Array(total).fill(false),
      started: false,
      over: false,
      won: false,
      revealedCount: 0,
      flagCount: 0,
      playerFlagCount: 0,
      exploded: -1,
    };
  }

  function neighbors(state, i) {
    const r = Math.floor(i / state.cols), c = i % state.cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) out.push(nr * state.cols + nc);
      }
    }
    return out;
  }

  function placeMines(state, safeIndex) {
    const total = state.rows * state.cols;
    const forbidden = new Set([safeIndex, ...neighbors(state, safeIndex)]);
    let candidates = [];
    for (let i = 0; i < total; i++) if (!forbidden.has(i)) candidates.push(i);
    // Tiny boards may not have room for the 3x3 safe zone; keep just the click safe.
    if (candidates.length < state.mines) {
      candidates = [];
      for (let i = 0; i < total; i++) if (i !== safeIndex) candidates.push(i);
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.min(state.mines, candidates.length);
    for (let k = 0; k < count; k++) state.mine[candidates[k]] = true;

    for (let i = 0; i < total; i++) {
      if (state.mine[i]) continue;
      let n = 0;
      for (const nb of neighbors(state, i)) if (state.mine[nb]) n++;
      state.adj[i] = n;
    }
  }

  function checkWin(state) {
    if (state.over) return false;
    if (state.revealedCount === state.rows * state.cols - state.mines) {
      state.won = true;
      state.over = true;
      for (let i = 0; i < state.mine.length; i++) {
        if (state.mine[i] && !state.flagged[i]) {
          state.flagged[i] = true;
          state.flagCount += 1;
        }
      }
      return true;
    }
    return false;
  }

  function reveal(state, i) {
    if (state.over || state.revealed[i] || state.flagged[i]) return false;
    if (!state.started) {
      state.started = true;
      placeMines(state, i);
    }
    if (state.mine[i]) {
      state.revealed[i] = true;
      state.exploded = i;
      state.over = true;
      state.won = false;
      for (let j = 0; j < state.mine.length; j++) if (state.mine[j]) state.revealed[j] = true;
      return true;
    }
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop();
      if (state.revealed[cur] || state.flagged[cur]) continue;
      state.revealed[cur] = true;
      state.revealedCount += 1;
      if (state.adj[cur] === 0) {
        for (const nb of neighbors(state, cur)) {
          if (!state.revealed[nb] && !state.flagged[nb] && !state.mine[nb]) stack.push(nb);
        }
      }
    }
    checkWin(state);
    return true;
  }

  function toggleFlag(state, i) {
    if (state.over || state.revealed[i]) return false;
    state.flagged[i] = !state.flagged[i];
    if (state.flagged[i]) {
      state.flagCount += 1;
      state.playerFlagCount += 1;
    } else {
      state.flagCount -= 1;
      state.playerFlagCount -= 1;
    }
    return true;
  }

  function chord(state, i) {
    if (state.over || !state.revealed[i] || state.adj[i] === 0) return false;
    const nbs = neighbors(state, i);
    let flags = 0;
    for (const nb of nbs) if (state.flagged[nb]) flags++;
    if (flags !== state.adj[i]) return false;
    let changed = false;
    for (const nb of nbs) {
      if (!state.flagged[nb] && !state.revealed[nb]) changed = reveal(state, nb) || changed;
    }
    return changed;
  }

  function scoreFor(state, elapsedSeconds) {
    const timeBonus = state.won ? Math.max(0, 1000 - elapsedSeconds * 5) : 0;
    const base = state.won ? state.base : 0;
    return Math.round(state.revealedCount * 5 + timeBonus + base);
  }

  root.MinesweeperEngine = {
    DIFFICULTIES, createGame, neighbors, placeMines, checkWin, reveal,
    toggleFlag, chord, scoreFor,
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    mineCount: document.getElementById("mine-count"),
    time: document.getElementById("time"),
    revealed: document.getElementById("revealed"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    flagMode: document.getElementById("flag-mode"),
    diffs: Array.from(document.querySelectorAll(".diff")),
  };

  const ui = {
    difficulty: "beginner",
    state: createGame("beginner"),
    flagMode: false,
    elapsed: 0,
    startedAt: 0,
    timerId: null,
    longPressed: false,
    pressTimer: null,
    cells: [],
    manualUnlocks: new Set(),
  };

  function buildBoard() {
    const { cols, rows } = ui.state;
    els.board.style.setProperty("--cols", String(cols));
    els.board.innerHTML = "";
    ui.cells = [];
    for (let i = 0; i < rows * cols; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.cell = String(i);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", "cell " + (i + 1));
      bindCell(cell, i);
      els.board.appendChild(cell);
      ui.cells.push(cell);
    }
    sizeCells();
  }

  function sizeCells() {
    const { cols } = ui.state;
    const available = Math.min(window.innerWidth - 34, 900);
    const cell = Math.floor(Math.min(34, Math.max(16, (available - (cols - 1) * 2) / cols)));
    els.board.style.setProperty("--cell", cell + "px");
  }

  function bindCell(cell, i) {
    cell.addEventListener("pointerdown", (e) => {
      ui.longPressed = false;
      if (e.pointerType === "mouse") return;
      ui.pressTimer = setTimeout(() => {
        ui.longPressed = true;
        if (flagCell(i)) render();
      }, 450);
    });
    const cancel = () => { clearTimeout(ui.pressTimer); ui.pressTimer = null; };
    cell.addEventListener("pointerup", cancel);
    cell.addEventListener("pointerleave", cancel);
    cell.addEventListener("pointercancel", cancel);
    cell.addEventListener("click", () => {
      if (ui.longPressed) { ui.longPressed = false; return; }
      onCellClick(i);
    });
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (flagCell(i)) render();
    });
  }

  function onCellClick(i) {
    const state = ui.state;
    if (state.over) return;
    if (ui.flagMode) {
      if (flagCell(i)) render();
      return;
    }
    if (state.revealed[i]) {
      if (chord(state, i)) {
        render();
        if (state.over) finish();
      }
      return;
    }
    if (reveal(state, i)) {
      if (state.started && !ui.timerId && !state.over) startTimer();
      render();
      if (state.over) finish();
    }
  }

  function flagCell(i) {
    return MinesweeperEngine.toggleFlag(ui.state, i);
  }

  function startTimer() {
    ui.startedAt = Date.now();
    ui.timerId = setInterval(() => {
      if (ui.state.over) { stopTimer(); return; }
      ui.elapsed = Math.floor((Date.now() - ui.startedAt) / 1000);
      els.time.textContent = ui.elapsed + "s";
    }, 200);
  }

  function stopTimer() {
    if (ui.timerId) clearInterval(ui.timerId);
    ui.timerId = null;
  }

  function render() {
    const state = ui.state;
    for (let i = 0; i < state.rows * state.cols; i++) {
      const el = ui.cells[i];
      el.className = "cell";
      el.textContent = "";
      if (state.revealed[i]) {
        el.classList.add("revealed");
        if (state.mine[i]) {
          el.classList.add("mine");
          if (i === state.exploded) el.classList.add("exploded");
        } else if (state.adj[i] > 0) {
          el.textContent = String(state.adj[i]);
          el.classList.add("n" + state.adj[i]);
        }
      } else if (state.flagged[i]) {
        el.classList.add("flag");
        el.textContent = "🚩";
        if (state.over && !state.mine[i]) el.classList.add("wrong-flag");
      }
      el.disabled = state.over;
    }
    els.mineCount.textContent = String(state.mines - state.flagCount);
    els.revealed.textContent = String(state.revealedCount);
    els.time.textContent = ui.elapsed + "s";
    els.diffs.forEach((b) => b.classList.toggle("active", b.dataset.diff === ui.difficulty));
  }

  function finish() {
    const state = ui.state;
    stopTimer();
    if (state.started) ui.elapsed = Math.floor((Date.now() - ui.startedAt) / 1000);
    const score = MinesweeperEngine.scoreFor(state, ui.elapsed);
    const meta = { difficulty: ui.difficulty, result: state.won ? "win" : "loss", revealed: state.revealedCount };
    if (state.won) {
      meta.seconds = ui.elapsed;
      meta.flags = state.playerFlagCount;
      ui.manualUnlocks.add("first-clear");
      if (ui.difficulty === "expert") ui.manualUnlocks.add("expert-clear");
      if (state.playerFlagCount === 0) ui.manualUnlocks.add("no-flag-clear");
    }

    const title = state.won ? "Cleared!" : "Boom";
    const body = state.won
      ? `All ${state.rows * state.cols - state.mines} safe cells revealed in ${ui.elapsed}s. Score ${score}.`
      : `You hit a mine after revealing ${state.revealedCount} cells. Score ${score}.`;
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();

    Gamebase.checkpoint({
      score,
      meta,
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[minesweeper] checkpoint failed", err));
  }

  function newGame(difficulty) {
    ui.difficulty = difficulty || ui.difficulty;
    ui.state = createGame(ui.difficulty);
    ui.elapsed = 0;
    ui.startedAt = 0;
    ui.longPressed = false;
    ui.manualUnlocks = new Set();
    stopTimer();
    els.overlay.hidden = true;
    els.status.textContent = DIFFICULTIES[ui.difficulty].label + " · " +
      ui.state.mines + " mines";
    buildBoard();
    render();
  }

  function setFlagMode(on) {
    ui.flagMode = on;
    els.flagMode.textContent = "🚩 Flag mode: " + (on ? "on" : "off");
    els.flagMode.setAttribute("aria-pressed", String(on));
    els.flagMode.classList.toggle("active", on);
  }

  els.newGame.addEventListener("click", () => newGame());
  els.overlayBtn.addEventListener("click", () => newGame());
  els.flagMode.addEventListener("click", () => setFlagMode(!ui.flagMode));
  els.diffs.forEach((btn) => btn.addEventListener("click", () => newGame(btn.dataset.diff)));
  window.addEventListener("resize", sizeCells);

  setFlagMode(false);
  newGame("beginner");

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
      console.warn("[minesweeper] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
