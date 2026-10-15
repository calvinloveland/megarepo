/*
 * Snake — Gamebase
 *
 * Classic grid snake. Food grows the snake and raises the score; every bite
 * also shortens the tick, so the game speeds up as you go. Hitting a wall or
 * your own body ends the run. Direction input is queued so fast diagonal
 * turns feel right.
 *
 * The pure engine is exposed as `GamebaseSnakeEngine` for headless testing.
 */
(function (root) {
  "use strict";

  const COLS = 20;
  const ROWS = 20;
  const BASE_TICK = 150;
  const MIN_TICK = 60;
  const FOOD_SCORE = 10;

  function opposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function spawnFood(state, rng) {
    const rand = rng || Math.random;
    const occupied = new Set(state.snake.map((s) => s.x + "," + s.y));
    const free = [];
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (!occupied.has(x + "," + y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(rand() * free.length)];
  }

  function createState(cols, rows, rng) {
    const cx = Math.floor((cols || COLS) / 2);
    const cy = Math.floor((rows || ROWS) / 2);
    const state = {
      cols: cols || COLS,
      rows: rows || ROWS,
      snake: [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }],
      dir: { x: 1, y: 0 },
      queue: [],
      food: null,
      alive: true,
      won: false,
      score: 0,
      foodEaten: 0,
      tickMs: BASE_TICK,
    };
    state.food = spawnFood(state, rng);
    return state;
  }

  function queueDir(state, dir) {
    if (!state.alive) return false;
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (opposite(dir, last) || (dir.x === last.x && dir.y === last.y)) return false;
    if (state.queue.length >= 2) state.queue.shift();
    state.queue.push(dir);
    return true;
  }

  function speedLevel(state) {
    return 1 + Math.floor(state.foodEaten / 3);
  }

  function step(state, rng) {
    if (!state.alive) return state;
    if (state.queue.length) state.dir = state.queue.shift();

    const head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
    const growing = state.food && head.x === state.food.x && head.y === state.food.y;

    if (head.x < 0 || head.y < 0 || head.x >= state.cols || head.y >= state.rows) {
      state.alive = false;
      return state;
    }
    const limit = growing ? state.snake.length : state.snake.length - 1;
    for (let i = 0; i < limit; i++) {
      if (state.snake[i].x === head.x && state.snake[i].y === head.y) {
        state.alive = false;
        return state;
      }
    }

    state.snake.unshift(head);
    if (growing) {
      state.score += FOOD_SCORE;
      state.foodEaten += 1;
      state.tickMs = Math.max(MIN_TICK, BASE_TICK - state.foodEaten * 4);
      state.food = spawnFood(state, rng);
      if (!state.food) {
        state.won = true;
        state.alive = false;
      }
    } else {
      state.snake.pop();
    }
    return state;
  }

  root.GamebaseSnakeEngine = {
    COLS, ROWS, createState, queueDir, step, spawnFood, speedLevel,
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const els = {
    canvas: document.getElementById("canvas"),
    score: document.getElementById("score"),
    length: document.getElementById("length"),
    speed: document.getElementById("speed"),
    best: document.getElementById("best"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    pause: document.getElementById("pause"),
  };

  const ctx = els.canvas.getContext("2d");
  const ui = {
    state: createState(),
    best: 0,
    paused: false,
    running: false,
    submitted: false,
    timer: null,
    manualUnlocks: new Set(),
  };

  function render() {
    const state = ui.state;
    const cell = els.canvas.width / state.cols;
    ctx.fillStyle = "#0d1522";
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

    // subtle grid
    ctx.strokeStyle = "rgba(74, 222, 128, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < state.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, els.canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(els.canvas.width, i * cell);
      ctx.stroke();
    }

    if (state.food) {
      const fx = state.food.x * cell + cell / 2;
      const fy = state.food.y * cell + cell / 2;
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(fx, fy, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(fx - cell * 0.1, fy - cell * 0.1, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }

    state.snake.forEach((seg, i) => {
      const pad = Math.max(1, cell * 0.08);
      ctx.fillStyle = i === 0 ? "#86efac" : "#4ade80";
      if (i > 0 && i % 2 === 1) ctx.fillStyle = "#3fbf6e";
      roundRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.22);
      ctx.fill();
      if (i === 0) {
        ctx.fillStyle = "#04150b";
        const ex = seg.x * cell;
        const ey = seg.y * cell;
        const eye = cell * 0.13;
        ctx.beginPath();
        ctx.arc(ex + cell * 0.34, ey + cell * 0.34, eye, 0, Math.PI * 2);
        ctx.arc(ex + cell * 0.66, ey + cell * 0.34, eye, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    els.score.textContent = String(state.score);
    els.length.textContent = String(state.snake.length);
    els.speed.textContent = String(speedLevel(state));
    els.best.textContent = String(ui.best);
    els.pause.textContent = ui.paused ? "Resume" : "Pause";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function schedule() {
    if (ui.timer) clearTimeout(ui.timer);
    if (ui.paused || !ui.state.alive) return;
    ui.timer = setTimeout(() => {
      advance();
      render();
      if (ui.state.alive) schedule();
      else finish();
    }, ui.state.tickMs);
  }

  function advance() {
    GamebaseSnakeEngine.step(ui.state, Math.random);
    if (ui.state.foodEaten > 0) ui.manualUnlocks.add("first-bite");
    if (ui.state.score > ui.best) ui.best = ui.state.score;
  }

  function finish() {
    if (ui.submitted) return;
    ui.submitted = true;
    const state = ui.state;
    const title = state.won ? "You filled the board!" : "Game over";
    const body = "Score " + state.score + " · length " + state.snake.length +
      " · speed level " + speedLevel(state) + ".";
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    render();
    Gamebase.endRun({
      score: state.score,
      meta: {
        length: state.snake.length,
        speedLevel: speedLevel(state),
        food: state.foodEaten,
        won: state.won ? 1 : 0,
      },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[snake] endRun failed", err));
  }

  function newGame() {
    if (ui.timer) clearTimeout(ui.timer);
    ui.state = createState();
    ui.paused = false;
    ui.submitted = false;
    ui.manualUnlocks = new Set();
    els.overlay.hidden = true;
    render();
    schedule();
  }

  function togglePause() {
    if (!ui.state.alive) return;
    ui.paused = !ui.paused;
    render();
    if (ui.paused) {
      if (ui.timer) clearTimeout(ui.timer);
      ui.timer = null;
    } else {
      schedule();
    }
  }

  const KEY_DIRS = {
    ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 }, d: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
    A: { x: -1, y: 0 }, D: { x: 1, y: 0 }, W: { x: 0, y: -1 }, S: { x: 0, y: 1 },
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      event.preventDefault();
      togglePause();
      return;
    }
    const dir = KEY_DIRS[event.key];
    if (!dir) return;
    event.preventDefault();
    GamebaseSnakeEngine.queueDir(ui.state, dir);
  });

  let touchStart = null;
  els.canvas.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  els.canvas.addEventListener("touchmove", (event) => {
    if (touchStart) event.preventDefault();
  }, { passive: false });
  els.canvas.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? { x: dx > 0 ? 1 : -1, y: 0 }
      : { x: 0, y: dy > 0 ? 1 : -1 };
    GamebaseSnakeEngine.queueDir(ui.state, dir);
  }, { passive: true });
  els.canvas.addEventListener("touchcancel", () => { touchStart = null; });

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.pause.addEventListener("click", togglePause);

  render();
  schedule();

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
      console.warn("[snake] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
