/*
 * 2048 — Gamebase
 *
 * The classic sliding-merge puzzle. Tiles slide as far as they can in the
 * chosen direction and equal neighbours merge exactly once per move. A new
 * tile (90% a 2, 10% a 4) appears after every move that changes the board.
 *
 * The pure engine is exposed as `Gamebase2048Engine` for headless testing.
 */
(function (root) {
  "use strict";

  const SIZE = 4;
  const DIRECTIONS = {
    left: "left", right: "right", up: "up", down: "down",
  };

  function emptyBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  // Slide one line toward index 0 and merge equal neighbours once.
  function slideLine(line) {
    const nums = line.filter((v) => v);
    const out = [];
    const mergedPositions = [];
    let gained = 0;
    for (let i = 0; i < nums.length; i++) {
      if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
        const merged = nums[i] * 2;
        mergedPositions.push(out.length);
        out.push(merged);
        gained += merged;
        i++;
      } else {
        out.push(nums[i]);
      }
    }
    while (out.length < SIZE) out.push(0);
    return { line: out, gained, mergedPositions };
  }

  function lineCoords(direction, index, position) {
    switch (direction) {
      case "left": return [index, position];
      case "right": return [index, SIZE - 1 - position];
      case "up": return [position, index];
      default: return [SIZE - 1 - position, index];
    }
  }

  function readLine(board, direction, index) {
    const line = [];
    for (let p = 0; p < SIZE; p++) {
      const [r, c] = lineCoords(direction, index, p);
      line.push(board[r][c]);
    }
    return line;
  }

  function writeLine(board, direction, index, line) {
    for (let p = 0; p < SIZE; p++) {
      const [r, c] = lineCoords(direction, index, p);
      board[r][c] = line[p];
    }
  }

  function move(board, direction) {
    if (!DIRECTIONS[direction]) return { board: cloneBoard(board), gained: 0, changed: false, merged: [] };
    const next = cloneBoard(board);
    let gained = 0;
    let changed = false;
    const merged = [];
    for (let i = 0; i < SIZE; i++) {
      const line = readLine(next, direction, i);
      const result = slideLine(line);
      if (result.gained) gained += result.gained;
      if (result.line.some((v, idx) => v !== line[idx])) changed = true;
      result.mergedPositions.forEach((p) => merged.push(lineCoords(direction, i, p)));
      writeLine(next, direction, i, result.line);
    }
    return { board: next, gained, changed, merged };
  }

  function emptyCells(board) {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) if (!board[r][c]) cells.push([r, c]);
    }
    return cells;
  }

  function addRandomTile(board, random) {
    const rand = random || Math.random;
    const cells = emptyCells(board);
    if (!cells.length) return null;
    const [r, c] = cells[Math.floor(rand() * cells.length)];
    board[r][c] = rand() < 0.9 ? 2 : 4;
    return [r, c];
  }

  function canMove(board) {
    if (emptyCells(board).length) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = board[r][c];
        if (c + 1 < SIZE && board[r][c + 1] === v) return true;
        if (r + 1 < SIZE && board[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function highestTile(board) {
    let max = 0;
    for (const row of board) for (const v of row) if (v > max) max = v;
    return max;
  }

  root.Gamebase2048Engine = {
    SIZE, slideLine, move, addRandomTile, canMove, emptyBoard, highestTile,
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const els = {
    board: document.getElementById("board"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    moves: document.getElementById("moves"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    keepBtn: document.getElementById("keep-btn"),
    newGame: document.getElementById("new-game"),
    undo: document.getElementById("undo"),
  };

  const ui = {
    board: emptyBoard(),
    score: 0,
    moves: 0,
    highest: 0,
    best: 0,
    over: false,
    won: false,
    keepPlaying: false,
    submitted: false,
    snapshot: null,
    spawn: [],
    merged: [],
    tiles: [],
    manualUnlocks: new Set(),
  };

  function buildGrid() {
    els.board.innerHTML = "";
    ui.tiles = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("role", "gridcell");
      els.board.appendChild(tile);
      ui.tiles.push(tile);
    }
  }

  function tileClass(value) {
    if (value > 2048) return "tile tbig";
    if (value === 2048) return "tile t2048";
    return "tile t" + value;
  }

  function render() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = ui.tiles[r * SIZE + c];
        const value = ui.board[r][c];
        el.className = value ? tileClass(value) : "tile";
        el.textContent = value ? String(value) : "";
        el.dataset.value = value ? String(value) : "";
      }
    }
    ui.spawn.forEach(([r, c]) => {
      const el = ui.tiles[r * SIZE + c];
      el.classList.remove("spawn");
      void el.offsetWidth;
      el.classList.add("spawn");
    });
    ui.merged.forEach(([r, c]) => {
      const el = ui.tiles[r * SIZE + c];
      el.classList.remove("merged");
      void el.offsetWidth;
      el.classList.add("merged");
    });
    ui.spawn = [];
    ui.merged = [];
    els.score.textContent = String(ui.score);
    els.moves.textContent = String(ui.moves);
    els.best.textContent = String(ui.best);
    els.undo.disabled = !ui.snapshot || ui.over;
  }

  function snapshot() {
    return {
      board: cloneBoard(ui.board),
      score: ui.score,
      moves: ui.moves,
      highest: ui.highest,
      won: ui.won,
      keepPlaying: ui.keepPlaying,
    };
  }

  function finish(title, body, keepVisible) {
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.keepBtn.hidden = !keepVisible;
    els.overlay.hidden = false;
  }

  function submitRun() {
    if (ui.submitted && ui.lastSubmitted === ui.score) return;
    ui.submitted = true;
    ui.lastSubmitted = ui.score;
    Gamebase.endRun({
      score: ui.score,
      meta: { highest: ui.highest, moves: ui.moves, won: ui.won ? 1 : 0 },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[2048] endRun failed", err));
  }

  function gameOver() {
    ui.over = true;
    render();
    finish("Game over", "No moves left. Score " + ui.score + " · best tile " + ui.highest + ".", false);
    submitRun();
  }

  function checkState() {
    if (!ui.won && ui.highest >= 2048) {
      ui.won = true;
      finish("You win!", "You built the 2048 tile with a score of " + ui.score + ". Keep going for a higher score.", true);
      submitRun();
      return;
    }
    if (!canMove(ui.board)) gameOver();
  }

  function doMove(direction) {
    if (ui.over || (ui.won && !ui.keepPlaying)) return;
    const before = snapshot();
    const result = Gamebase2048Engine.move(ui.board, direction);
    if (!result.changed) return;
    ui.board = result.board;
    ui.score += result.gained;
    ui.moves += 1;
    ui.highest = Gamebase2048Engine.highestTile(ui.board);
    ui.snapshot = before;
    ui.merged = result.merged;
    if (result.gained > 0) ui.manualUnlocks.add("first-merge");
    const spawn = Gamebase2048Engine.addRandomTile(ui.board);
    ui.spawn = spawn ? [spawn] : [];
    if (ui.score > ui.best) ui.best = ui.score;
    render();
    checkState();
  }

  function undo() {
    if (!ui.snapshot || ui.over) return;
    const snap = ui.snapshot;
    ui.board = snap.board;
    ui.score = snap.score;
    ui.moves = snap.moves;
    ui.highest = snap.highest;
    ui.won = snap.won;
    ui.keepPlaying = snap.keepPlaying;
    ui.snapshot = null;
    ui.spawn = [];
    ui.merged = [];
    render();
  }

  function newGame() {
    ui.board = emptyBoard();
    ui.score = 0;
    ui.moves = 0;
    ui.highest = 0;
    ui.over = false;
    ui.won = false;
    ui.keepPlaying = false;
    ui.submitted = false;
    ui.snapshot = null;
    ui.spawn = [];
    ui.merged = [];
    ui.manualUnlocks = new Set();
    Gamebase2048Engine.addRandomTile(ui.board);
    Gamebase2048Engine.addRandomTile(ui.board);
    els.overlay.hidden = true;
    render();
  }

  // Keyboard
  const KEY_DIRS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    a: "left", d: "right", w: "up", s: "down",
    A: "left", D: "right", W: "up", S: "down",
  };
  window.addEventListener("keydown", (event) => {
    const dir = KEY_DIRS[event.key];
    if (!dir) return;
    event.preventDefault();
    doMove(dir);
  });

  // Touch swipe
  let touchStart = null;
  els.board.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  els.board.addEventListener("touchmove", (event) => {
    if (touchStart) event.preventDefault();
  }, { passive: false });
  els.board.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
    else doMove(dy > 0 ? "down" : "up");
  }, { passive: true });
  els.board.addEventListener("touchcancel", () => { touchStart = null; });

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.undo.addEventListener("click", undo);
  els.keepBtn.addEventListener("click", () => {
    ui.keepPlaying = true;
    els.overlay.hidden = true;
    checkState();
  });

  buildGrid();
  newGame();

  Gamebase.ready()
    .then((player) => {
      els.tag.textContent = player.handle;
      return Gamebase.myBest();
    })
    .then((best) => {
      if (best && best.best != null) {
        ui.best = best.best;
        if (Gamebase.player) els.tag.textContent = Gamebase.player.handle + " · best " + best.best;
        render();
      }
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[2048] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
