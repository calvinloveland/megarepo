/*
 * Conway War — Gamebase
 *
 * Conway's Game of Life plus two-player territory warfare, ported to a
 * client-only browser game. Players seed cells around an immortal base by
 * spending energy, then a generation advances: Life birth/survival resolves,
 * cells adjacent to an enemy die in combat, and every cell flips to the local
 * majority owner. Energy is harvested from "crops" on owned dead cells.
 *
 * Simplifications vs. the Flask original (documented in the final report):
 *   - a smaller toroidal board (31x21) instead of 127x131, so a game fits on
 *     screen and finishes quickly;
 *   - turns alternate seeding phases instead of simultaneous ready-up, with a
 *     single automaton step per round;
 *   - one simple heuristic AI instead of easy/medium/hard;
 *   - a player is defeated when they have no living non-immortal cells (the
 *     original counted any owned non-immortal cell), and a 60-generation cap
 *     decides on living territory.
 *
 * The pure engine is exposed as the global `ConwayWarEngine`.
 */
(function (root) {
  "use strict";

  // ── Engine ───────────────────────────────────────────────────────────────

  const BOARD_W = 31;
  const BOARD_H = 21;
  const STARTING_ENERGY = 15;
  const FREE_BASE_RADIUS = 1;
  const CROP_RESET = 2 / 16;
  const CROP_MAX = 2;
  const MAX_AI_ACTIONS = 4;

  const idx = (g, x, y) => y * g.w + x;

  function forNeighbors(g, x, y, fn) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = (x + dx + g.w) % g.w;
        const ny = (y + dy + g.h) % g.h;
        fn(nx, ny, idx(g, nx, ny));
      }
    }
  }

  function createGame(width, height) {
    const w = width || BOARD_W;
    const h = height || BOARD_H;
    const n = w * h;
    const g = {
      w,
      h,
      alive: new Uint8Array(n),
      immortal: new Uint8Array(n),
      owner: new Int8Array(n).fill(-1),
      crop: new Float32Array(n).fill(CROP_RESET),
      start: [[4, 4], [w - 5, h - 5]],
      energy: [STARTING_ENERGY, STARTING_ENERGY],
      turnCount: 0,
      over: false,
      winner: null,
    };
    for (let player = 0; player < 2; player++) {
      const sx = g.start[player][0];
      const sy = g.start[player][1];
      const i = idx(g, sx, sy);
      g.owner[i] = player;
      g.alive[i] = 1;
      g.immortal[i] = 1;
      claimNeighbors(g, sx, sy, player);
    }
    return g;
  }

  function claimNeighbors(g, x, y, player) {
    forNeighbors(g, x, y, (nx, ny, i) => {
      if (!g.immortal[i] && g.owner[i] === -1) g.owner[i] = player;
    });
  }

  function toroidalDistance(g, x, y, player) {
    const sx = g.start[player][0];
    const sy = g.start[player][1];
    let dx = Math.abs(x - sx);
    let dy = Math.abs(y - sy);
    dx = Math.min(dx, g.w - dx);
    dy = Math.min(dy, g.h - dy);
    return Math.max(dx, dy);
  }

  function energyCost(g, x, y, player) {
    const distance = toroidalDistance(g, x, y, player);
    if (distance <= FREE_BASE_RADIUS) return 0;
    return Math.pow(distance - FREE_BASE_RADIUS, 2);
  }

  function countAlive(g, x, y) {
    let count = 0;
    forNeighbors(g, x, y, (nx, ny, i) => { if (g.alive[i]) count++; });
    return count;
  }

  function countFriendly(g, x, y, player) {
    let count = 0;
    forNeighbors(g, x, y, (nx, ny, i) => {
      if (g.alive[i] && g.owner[i] === player) count++;
    });
    return count;
  }

  function countEnemy(g, x, y, player) {
    let count = 0;
    forNeighbors(g, x, y, (nx, ny, i) => {
      if (g.alive[i] && g.owner[i] >= 0 && g.owner[i] !== player) count++;
    });
    return count;
  }

  function hasUnfriendly(g, x, y, player) {
    if (player < 0) return false;
    let found = false;
    forNeighbors(g, x, y, (nx, ny, i) => {
      if (g.alive[i] && g.owner[i] >= 0 && g.owner[i] !== player) found = true;
    });
    return found;
  }

  function actionKind(g, x, y, player) {
    const i = idx(g, x, y);
    if (g.immortal[i]) return null;
    if (g.energy[player] < energyCost(g, x, y, player)) return null;
    if (g.owner[i] === player) return g.alive[i] ? "toggle-off" : "toggle-on";
    if (!g.alive[i] && g.owner[i] === -1 && countFriendly(g, x, y, player) > 0) return "claim";
    return null;
  }

  function applyCellAction(g, x, y, player, kind) {
    const i = idx(g, x, y);
    const cost = energyCost(g, x, y, player);
    if (g.energy[player] < cost) return false;
    if (kind === "claim") {
      g.energy[player] -= cost;
      g.owner[i] = player;
      g.alive[i] = 1;
      claimNeighbors(g, x, y, player);
      return true;
    }
    if (kind === "toggle-on" || kind === "toggle-off") {
      g.energy[player] -= cost;
      g.alive[i] = kind === "toggle-on" ? 1 : 0;
      return true;
    }
    return false;
  }

  function step(g) {
    const n = g.w * g.h;
    const aliveNeighbors = new Int16Array(n);
    const owner0 = new Int16Array(n);
    const owner1 = new Int16Array(n);

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = idx(g, x, y);
        let alive = 0;
        let o0 = 0;
        let o1 = 0;
        forNeighbors(g, x, y, (nx, ny, j) => {
          if (!g.alive[j]) return;
          alive++;
          if (g.owner[j] === 0) o0++;
          else if (g.owner[j] === 1) o1++;
        });
        aliveNeighbors[i] = alive;
        owner0[i] = o0;
        owner1[i] = o1;
      }
    }

    const nextAlive = g.alive.slice();
    const nextOwner = g.owner.slice();
    const nextCrop = g.crop.slice();
    const energyDelta = [0, 0];

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = idx(g, x, y);
        const owner = g.owner[i];
        const immortal = g.immortal[i];
        const alive = g.alive[i];
        let crop = g.crop[i];
        if (!alive && crop < CROP_MAX && owner >= 0) crop = crop * 2;

        let newAlive;
        if (immortal) {
          newAlive = alive;
        } else if (alive && owner >= 0 && hasUnfriendly(g, x, y, owner)) {
          newAlive = 0;
        } else if (!alive) {
          newAlive = aliveNeighbors[i] === 3 ? 1 : 0;
        } else {
          newAlive = aliveNeighbors[i] >= 2 && aliveNeighbors[i] <= 3 ? 1 : 0;
        }

        let newOwner = owner;
        let current = owner >= 0 ? (owner === 0 ? owner0[i] : owner1[i]) : 0;
        if (owner0[i] > current) {
          newOwner = 0;
          current = owner0[i];
        }
        if (owner1[i] > current) {
          newOwner = 1;
        }

        if (owner >= 0 && newAlive) {
          energyDelta[newOwner] += g.crop[i];
          crop = CROP_RESET;
        }

        nextAlive[i] = newAlive;
        nextOwner[i] = newOwner;
        nextCrop[i] = crop;
      }
    }

    g.alive = nextAlive;
    g.owner = nextOwner;
    g.crop = nextCrop;
    g.energy[0] += energyDelta[0];
    g.energy[1] += energyDelta[1];
    g.turnCount += 1;
    return g;
  }

  function countOwned(g, player, aliveOnly, includeImmortal) {
    let count = 0;
    const n = g.w * g.h;
    for (let i = 0; i < n; i++) {
      if (g.owner[i] !== player) continue;
      if (aliveOnly && !g.alive[i]) continue;
      if (!includeImmortal && g.immortal[i]) continue;
      count++;
    }
    return count;
  }

  function aliveTerritory(g, player) {
    return countOwned(g, player, true, false);
  }

  function winnerIndex(g) {
    const owned0 = countOwned(g, 0, false, false) > 0;
    const owned1 = countOwned(g, 1, false, false) > 0;
    if (owned0 && !owned1) return 0;
    if (owned1 && !owned0) return 1;
    if (!owned0 && !owned1) return -1;
    // Knockout: once the world has ticked, a side with no living non-immortal
    // cells cannot act or recover, so it loses even though it still owns ground.
    if (g.turnCount > 0) {
      const alive0 = aliveTerritory(g, 0) > 0;
      const alive1 = aliveTerritory(g, 1) > 0;
      if (alive0 && !alive1) return 0;
      if (alive1 && !alive0) return 1;
      if (!alive0 && !alive1) return -1;
    }
    return null;
  }

  function aiTakeTurn(g, player) {
    const opponent = 1 - player;
    for (let action = 0; action < MAX_AI_ACTIONS; action++) {
      let best = null;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          const kind = actionKind(g, x, y, player);
          if (!kind) continue;
          const cost = energyCost(g, x, y, player);
          const friendly = countFriendly(g, x, y, player);
          const enemy = countEnemy(g, x, y, player);
          let score = friendly * 3 - enemy * 5 - cost * 0.4;
          if (kind === "claim") score += 1.5;
          if (kind === "toggle-off") score -= 2.5;
          score -= toroidalDistance(g, x, y, opponent) * 0.05;
          if (!best || score > best.score) best = { x, y, kind, score };
        }
      }
      if (!best) break;
      applyCellAction(g, best.x, best.y, player, best.kind);
    }
  }

  root.ConwayWarEngine = {
    BOARD_W, BOARD_H, STARTING_ENERGY, FREE_BASE_RADIUS, CROP_RESET, MAX_AI_ACTIONS,
    createGame, claimNeighbors, toroidalDistance, energyCost,
    countAlive, countFriendly, countEnemy, hasUnfriendly,
    actionKind, applyCellAction, step, countOwned, aliveTerritory, winnerIndex, aiTakeTurn,
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const MODES = ["ai", "local"];
  const MODE_LABELS = { ai: "Mode: vs AI", local: "Mode: 2-player" };
  const MAX_ROUNDS = 30;

  const COLORS = [
    { alive: "#ff5a5a", dead: "#3a1418", bar: "#ff9a9a", glow: "rgba(255,90,90,0.85)" },
    { alive: "#5a9bff", dead: "#12213c", bar: "#9ac0ff", glow: "rgba(90,155,255,0.85)" },
  ];

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    endTurn: document.getElementById("end-turn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    resetTally: document.getElementById("reset-tally"),
    e0: document.getElementById("e0"),
    e1: document.getElementById("e1"),
    t0: document.getElementById("t0"),
    t1: document.getElementById("t1"),
    gen: document.getElementById("gen"),
    p2Name: document.getElementById("p2-name"),
  };

  const overlay = GameKit.overlay({
    overlay: els.overlay,
    title: els.overlayTitle,
    body: els.overlayBody,
    button: els.overlayBtn,
  });

  const ui = {
    game: createGame(),
    mode: "ai",
    human: 0,
    active: 0,
    busy: false,
    finished: false,
    tally: { wins: 0, draws: 0, losses: 0, streak: 0 },
    revision: 0,
  };

  const manualUnlocks = new Set();
  let dpr = 1;

  function activeSeeder() {
    return ui.mode === "ai" ? 0 : ui.active;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function layout() {
    const container = els.board.parentElement;
    const cssWidth = Math.max(280, Math.min(container.clientWidth || 640, 920));
    const cssHeight = cssWidth * ui.game.h / ui.game.w;
    dpr = window.devicePixelRatio || 1;
    els.board.width = Math.max(1, Math.round(cssWidth * dpr));
    els.board.height = Math.max(1, Math.round(cssHeight * dpr));
    els.board.style.height = cssHeight + "px";
  }

  function drawBoard() {
    const ctx = els.board.getContext("2d");
    const g = ui.game;
    const cssWidth = els.board.width / dpr;
    const cssHeight = els.board.height / dpr;
    const cs = cssWidth / g.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        const px = x * cs;
        const py = y * cs;
        let fill = "#0e141d";
        let color = null;
        if (g.owner[i] >= 0) {
          color = COLORS[g.owner[i]];
          fill = g.alive[i] ? color.alive : color.dead;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(px + 0.5, py + 0.5, cs - 1, cs - 1);

        if (color && !g.alive[i] && g.crop[i] > 0.08) {
          const barHeight = Math.min(1, g.crop[i]) * (cs * 0.3);
          ctx.fillStyle = color.bar;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(px + 1, py + cs - 1 - barHeight, cs - 2, barHeight);
          ctx.globalAlpha = 1;
        }

        if (g.immortal[i]) {
          ctx.fillStyle = "#fde68a";
          ctx.font = "bold " + (cs * 0.85) + "px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", px + cs / 2, py + cs / 2 + 0.5);
        }
      }
    }

    if (!ui.finished && !ui.busy) {
      const player = activeSeeder();
      ctx.lineWidth = Math.max(1, cs * 0.12);
      ctx.strokeStyle = COLORS[player].glow;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          if (actionKind(g, x, y, player)) {
            ctx.strokeRect(x * cs + 1.5, y * cs + 1.5, cs - 3, cs - 3);
          }
        }
      }
    }
  }

  function updateHud() {
    const g = ui.game;
    els.e0.textContent = g.energy[0].toFixed(1);
    els.e1.textContent = g.energy[1].toFixed(1);
    els.t0.textContent = String(aliveTerritory(g, 0));
    els.t1.textContent = String(aliveTerritory(g, 1));
    els.gen.textContent = String(g.turnCount);
    els.p2Name.textContent = ui.mode === "local" ? "P2" : "AI";
  }

  function updateStatus() {
    if (ui.finished) return;
    if (ui.busy) {
      setStatus("AI is seeding the grid…");
    } else if (ui.mode === "local") {
      setStatus("Player " + (ui.active + 1) + " — seed cells, then advance.");
    } else {
      setStatus("Your turn — seed cells, then advance.");
    }
  }

  function render() {
    drawBoard();
    updateHud();
    updateStatus();
  }

  function onCanvasClick(event) {
    if (ui.finished || ui.busy) return;
    const g = ui.game;
    const rect = els.board.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.floor((event.clientX - rect.left) / rect.width * g.w);
    const y = Math.floor((event.clientY - rect.top) / rect.height * g.h);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
    const player = activeSeeder();
    const kind = actionKind(g, x, y, player);
    if (!kind) return;
    applyCellAction(g, x, y, player, kind);
    render();
  }

  function resolveStep() {
    const g = ui.game;
    step(g);
    const winner = winnerIndex(g);
    let result = null;
    if (winner === 0 || winner === 1) {
      result = winner === ui.human ? "win" : "loss";
    } else if (winner === -1) {
      result = "draw";
    } else if (g.turnCount >= MAX_ROUNDS) {
      const mine = aliveTerritory(g, 0);
      const theirs = aliveTerritory(g, 1);
      if (mine > theirs) result = ui.human === 0 ? "win" : "loss";
      else if (theirs > mine) result = ui.human === 1 ? "win" : "loss";
      else result = "draw";
    }
    ui.busy = false;
    if (result) {
      finish(result);
      return;
    }
    ui.active = 0;
    render();
  }

  function endTurn() {
    if (ui.finished || ui.busy) return;
    if (ui.mode === "ai") {
      ui.busy = true;
      render();
      setTimeout(() => {
        if (ui.finished) return;
        aiTakeTurn(ui.game, 1);
        resolveStep();
      }, 320);
      return;
    }
    if (ui.active === 0) {
      ui.active = 1;
      render();
    } else {
      resolveStep();
    }
  }

  function finish(result) {
    if (ui.finished) return;
    ui.finished = true;
    const g = ui.game;

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

    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    const myTerritory = aliveTerritory(g, ui.human);
    const oppTerritory = aliveTerritory(g, 1 - ui.human);
    const title = result === "win" ? "You win!" : result === "draw" ? "Draw" : "You lose";
    const body = result === "draw"
      ? "Both sides hold " + myTerritory + " living cells."
      : "Living territory " + myTerritory + " to " + oppTerritory + " after " + g.turnCount + " generations.";

    overlay.show(title, body, "New game", newGame);
    render();
    persistTally();

    try {
      Gamebase.endRun({
        score,
        meta: {
          result,
          mode: ui.mode,
          turn: g.turnCount,
          territory: myTerritory,
          streak: ui.tally.streak,
        },
        unlock: Array.from(manualUnlocks),
      }).catch(() => {});
    } catch (error) { /* offline */ }
  }

  function resetGame() {
    ui.game = createGame();
    ui.active = 0;
    ui.busy = false;
    ui.finished = false;
    ui.human = 0;
  }

  function newGame() {
    resetGame();
    overlay.hide();
    layout();
    render();
  }

  function setMode(next) {
    ui.mode = next;
    resetGame();
    overlay.hide();
    layout();
    render();
  }

  function resetTally() {
    ui.tally = { wins: 0, draws: 0, losses: 0, streak: 0 };
    persistTally();
  }

  function persistTally() {
    if (!root.Gamebase || !Gamebase.player) return;
    try {
      Gamebase.saveState({ tally: ui.tally }, { revision: ui.revision })
        .then((saved) => {
          if (saved && typeof saved.revision === "number") ui.revision = saved.revision;
        })
        .catch(() => {});
    } catch (error) { /* offline */ }
  }

  GameKit.modeCycle(els.modeBtn, MODES, MODE_LABELS, () => ui.mode, setMode);
  els.endTurn.addEventListener("click", endTurn);
  els.newGame.addEventListener("click", newGame);
  els.resetTally.addEventListener("click", resetTally);
  els.board.addEventListener("click", onCanvasClick);
  window.addEventListener("resize", () => { layout(); render(); });

  layout();
  render();
  requestAnimationFrame(() => { layout(); render(); });

  try {
    GameKit.ready({ tagElement: els.tag, onPlayer: async (player) => {
      try {
        const saved = await Gamebase.loadState();
        if (saved && saved.state && saved.state.tally) {
          ui.tally = Object.assign(ui.tally, saved.state.tally);
          ui.revision = saved.revision || 0;
        }
      } catch (error) { /* no saved state */ }
      try {
        const best = await Gamebase.myBest();
        if (best) els.tag.textContent = player.handle + " · best " + best.best;
      } catch (error) { /* no best yet */ }
    } }).catch(() => {
      els.tag.textContent = "guest";
    });
  } catch (error) {
    els.tag.textContent = "guest";
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
