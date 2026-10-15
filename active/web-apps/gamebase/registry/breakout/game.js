/*
 * Breakout — Gamebase
 *
 * Paddle, ball, and a wall of bricks across three lives. Clearing a wall
 * advances the level and speeds the ball up. Ball physics run in substeps so
 * a fast ball cannot tunnel through bricks on a slow frame.
 */
(function (root) {
  "use strict";

  const W = 480;
  const H = 560;
  const PADDLE_H = 12;
  const PADDLE_Y = H - 40;
  const PADDLE_W = 84;
  const BALL_R = 7;
  const COLS = 8;
  const ROWS = 5;
  const BRICK_TOP = 74;
  const BRICK_SIDE = 20;
  const BRICK_GAP = 6;
  const BRICK_H = 20;
  const ROW_COLORS = ["#f43f5e", "#fb923c", "#facc15", "#4ade80", "#22d3ee"];

  if (typeof document === "undefined") return;

  const els = {
    canvas: document.getElementById("canvas"),
    score: document.getElementById("score"),
    lives: document.getElementById("lives"),
    level: document.getElementById("level"),
    best: document.getElementById("best"),
    tag: document.getElementById("tag"),
    status: document.getElementById("status"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
  };

  const ctx = els.canvas.getContext("2d");
  const brickW = (W - BRICK_SIDE * 2 - BRICK_GAP * (COLS - 1)) / COLS;
  const ui = {
    paddleX: (W - PADDLE_W) / 2,
    ball: { x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true },
    bricks: [],
    bricksAlive: 0,
    bricksBroken: 0,
    score: 0,
    best: 0,
    lives: 3,
    level: 1,
    over: false,
    submitted: false,
    keys: Object.create(null),
    manualUnlocks: new Set(),
  };

  function ballSpeed() {
    return 300 + (ui.level - 1) * 45;
  }

  function buildBricks() {
    ui.bricks = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        ui.bricks.push({
          x: BRICK_SIDE + col * (brickW + BRICK_GAP),
          y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
          w: brickW,
          h: BRICK_H,
          row: row,
          alive: true,
        });
      }
    }
    ui.bricksAlive = ui.bricks.length;
  }

  function resetBall() {
    ui.ball.x = ui.paddleX + PADDLE_W / 2;
    ui.ball.y = PADDLE_Y - BALL_R;
    ui.ball.vx = 0;
    ui.ball.vy = 0;
    ui.ball.stuck = true;
    els.status.textContent = "Press Space or tap to launch.";
  }

  function launch() {
    if (ui.over || !ui.ball.stuck) return;
    const speed = ballSpeed();
    const vx = speed * (Math.random() * 0.5 - 0.25);
    const vy = -Math.sqrt(Math.max(1, speed * speed - vx * vx));
    ui.ball.vx = vx;
    ui.ball.vy = vy;
    ui.ball.stuck = false;
    els.status.textContent = "Level " + ui.level;
  }

  function newGame() {
    ui.score = 0;
    ui.lives = 3;
    ui.level = 1;
    ui.over = false;
    ui.submitted = false;
    ui.bricksBroken = 0;
    ui.manualUnlocks = new Set();
    ui.paddleX = (W - PADDLE_W) / 2;
    buildBricks();
    resetBall();
    els.overlay.hidden = true;
    render();
  }

  function nextLevel() {
    ui.score += 100;
    ui.level += 1;
    buildBricks();
    ui.paddleX = (W - PADDLE_W) / 2;
    resetBall();
  }

  function loseLife() {
    ui.lives -= 1;
    if (ui.lives <= 0) {
      gameOver();
    } else {
      resetBall();
    }
  }

  function gameOver() {
    ui.over = true;
    els.overlayTitle.textContent = "Game over";
    els.overlayBody.textContent = "Score " + ui.score + " · reached level " + ui.level +
      " · " + ui.bricksBroken + " bricks broken.";
    els.overlay.hidden = false;
    render();
    if (ui.submitted) return;
    ui.submitted = true;
    Gamebase.endRun({
      score: ui.score,
      meta: { level: ui.level, bricks: ui.bricksBroken, lives: 0 },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[breakout] endRun failed", err));
  }

  function hitBrick() {
    const ball = ui.ball;
    for (const brick of ui.bricks) {
      if (!brick.alive) continue;
      const cx = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
      const cy = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      const ox = (brick.w / 2 + BALL_R) - Math.abs(ball.x - (brick.x + brick.w / 2));
      const oy = (brick.h / 2 + BALL_R) - Math.abs(ball.y - (brick.y + brick.h / 2));
      if (ox < oy) {
        ball.x += ball.x < brick.x + brick.w / 2 ? -ox : ox;
        ball.vx = -ball.vx;
      } else {
        ball.y += ball.y < brick.y + brick.h / 2 ? -oy : oy;
        ball.vy = -ball.vy;
      }
      brick.alive = false;
      ui.bricksAlive -= 1;
      ui.bricksBroken += 1;
      ui.score += 10;
      ui.manualUnlocks.add("first-brick");
      if (ui.bricksAlive <= 0) nextLevel();
      return true;
    }
    return false;
  }

  function moveBall(dt) {
    const ball = ui.ball;
    if (ball.stuck || ui.over) return;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }

    // Paddle
    if (
      ball.vy > 0 &&
      ball.y + BALL_R >= PADDLE_Y &&
      ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
      ball.x >= ui.paddleX - BALL_R &&
      ball.x <= ui.paddleX + PADDLE_W + BALL_R
    ) {
      ball.y = PADDLE_Y - BALL_R;
      const speed = ballSpeed();
      const rel = Math.max(-1, Math.min(1, (ball.x - (ui.paddleX + PADDLE_W / 2)) / (PADDLE_W / 2)));
      const angle = rel * (Math.PI / 3);
      ball.vx = speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
    }

    hitBrick();

    if (ball.y - BALL_R > H) loseLife();
  }

  function updatePaddle(dt) {
    const speed = 460;
    if (ui.keys.left) ui.paddleX -= speed * dt;
    if (ui.keys.right) ui.paddleX += speed * dt;
    ui.paddleX = Math.max(0, Math.min(W - PADDLE_W, ui.paddleX));
    if (ui.ball.stuck) {
      ui.ball.x = ui.paddleX + PADDLE_W / 2;
      ui.ball.y = PADDLE_Y - BALL_R;
    }
  }

  function update(dt) {
    if (ui.over) return;
    updatePaddle(dt);
    if (ui.ball.stuck) return;
    const speed = Math.hypot(ui.ball.vx, ui.ball.vy) || ballSpeed();
    const maxStep = (BALL_R * 0.8) / speed;
    let remaining = Math.min(dt, 0.05);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, maxStep);
      moveBall(step);
      remaining -= step;
      if (ui.over || ui.ball.stuck) break;
    }
  }

  function render() {
    ctx.fillStyle = "#0d1522";
    ctx.fillRect(0, 0, W, H);

    for (const brick of ui.bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = ROW_COLORS[brick.row % ROW_COLORS.length];
      ctx.globalAlpha = 0.92;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(brick.x, brick.y, brick.w, 3);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "#4ade80";
    ctx.fillRect(ui.paddleX, PADDLE_Y, PADDLE_W, PADDLE_H);

    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.arc(ui.ball.x, ui.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(74,222,128,0.35)";
    ctx.beginPath();
    ctx.arc(ui.ball.x, ui.ball.y, BALL_R + 4, 0, Math.PI * 2);
    ctx.fill();

    els.score.textContent = String(ui.score);
    els.lives.textContent = String(Math.max(0, ui.lives));
    els.level.textContent = String(ui.level);
    els.best.textContent = String(ui.best);
  }

  let last = 0;
  function frame(now) {
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function pointerToPaddle(clientX) {
    const rect = els.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / rect.width);
    ui.paddleX = Math.max(0, Math.min(W - PADDLE_W, x - PADDLE_W / 2));
  }

  els.canvas.addEventListener("pointermove", (event) => {
    pointerToPaddle(event.clientX);
  });
  els.canvas.addEventListener("pointerdown", (event) => {
    pointerToPaddle(event.clientX);
    launch();
  });

  const KEY = {
    ArrowLeft: "left", ArrowRight: "right",
    a: "left", d: "right", A: "left", D: "right",
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === " ") { event.preventDefault(); launch(); return; }
    const dir = KEY[event.key];
    if (dir) { event.preventDefault(); ui.keys[dir] = true; }
  });
  window.addEventListener("keyup", (event) => {
    const dir = KEY[event.key];
    if (dir) ui.keys[dir] = false;
  });

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);

  newGame();
  requestAnimationFrame(frame);

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
      console.warn("[breakout] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
