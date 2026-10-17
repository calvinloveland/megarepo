/*
 * Brass & Boiler — page wiring.
 *
 * Responsibilities, in order of importance:
 *   1. Run the engine off the wall clock (PROTOCOL.md §4) and answer the Arena.
 *   2. Render, make noise, update the HUD.
 *   3. Let a human play with the keyboard.
 *
 * The protocol surface lives behind the official `game-adapter.js`, which the
 * challenge ships for exactly this purpose; `window.installTetrisAdapter` is
 * loaded by a classic <script> before this module runs.
 *
 * Built by Calvin Loveland with the deepseek agent.
 */

import { TetrisEngine } from './engine.js';
import { Renderer } from './render.js';
import { SteamAudio } from './audio.js';
import { PIECE_PALETTE } from './theme.js';
import { PIECE_TYPES } from './constants.js';

const GAME_NAME = 'Brass & Boiler';
const GAME_AUTHOR = 'Calvin Loveland (agent: deepseek)';

const engine = new TetrisEngine({ seed: 'arena' });
const audio = new SteamAudio();
const renderer = new Renderer(document.getElementById('board'), {
  nextCanvas: document.getElementById('next'),
  holdCanvas: document.getElementById('hold'),
});

/* Deterministic test surface (see project AGENTS.md): Playwright drives the
   engine through this instead of gambling on real-time frames. */
let frozen = false;
let clockOffset = 0;
const now = () => performance.now() + clockOffset;

/* ------------------------------------------------------------ human input */

const DAS_MS = 150;
const ARR_MS = 38;
const SOFT_DAS_MS = 60;
const SOFT_ARR_MS = 40;

const held = { left: false, right: false, down: false };
let moveDir = 0;
let dasTimer = 0;
let arrTimer = 0;
let softDas = 0;
let softArr = 0;
let overlayMode = 'intro';
let introUntil = 0;

const el = (id) => document.getElementById(id);
const ui = {
  score: el('score'), level: el('level'), lines: el('lines'), tetrises: el('tetrises'),
  pieces: el('pieces'), clock: el('clock'), needle: el('needle'),
  pressure: el('pressure-readout'), gravity: el('gravity-readout'),
  feat: el('feat-readout'), tally: el('tally'), overlay: el('overlay'),
  overlayTitle: el('overlay-title'), overlayBody: el('overlay-body'),
  overlayKeys: el('overlay-keys'), alarm: el('alarm'),
};

const last = {};
function setText(node, value) {
  if (!node) return;
  if (last[node.id] === value) return;
  last[node.id] = value;
  node.textContent = value;
}

function setOverlay(mode, title, body, keys) {
  overlayMode = mode;
  ui.overlay.dataset.mode = mode;
  if (title) ui.overlayTitle.textContent = title;
  if (body) ui.overlayBody.textContent = body;
  if (ui.overlayKeys) {
    ui.overlayKeys.hidden = !keys;
    if (keys) ui.overlayKeys.textContent = keys;
  }
}

function clockText(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* --------------------------------------------------------------- adapter */

const adapter = window.installTetrisAdapter({
  name: GAME_NAME,
  author: GAME_AUTHOR,
  getState: () => engine.toState(),
  onNew: ({ seed, sequence }) => {
    engine.reset({ seed, sequence });
    setOverlay('hidden');
    renderer.particles.length = 0;
    renderer.steam.length = 0;
    renderer.flashes.length = 0;
  },
  onInput: (action) => engine.applyAction(action),
  onPause: (paused) => engine.setPaused(paused),
});

/* ------------------------------------------------------------------ loop */

let lastFrame = 0;

function frame(ts) {
  const dtMs = lastFrame ? Math.min(100, ts - lastFrame) : 16;
  lastFrame = ts;

  if (!frozen) {
    engine.tick(now());
    handleEvents();
    adapter.notify();
  }
  if (!engine.paused && !engine.gameOver) humanRepeat(dtMs);
  renderer.update(dtMs / 1000);
  paint(renderer.draw(engine));

  if (overlayMode === 'intro' && now() > introUntil) setOverlay('hidden');
  requestAnimationFrame(frame);
}

function handleEvents() {
  for (const ev of engine.drainEvents()) {
    switch (ev.type) {
      case 'move':
        audio.move();
        break;
      case 'rotate':
        audio.rotate();
        break;
      case 'softdrop':
        audio.softDrop();
        break;
      case 'lock':
        audio.lock();
        renderer.burst(lastPieceCells, { count: 8, spread: 0.6 });
        renderer.kick(1.6);
        break;
      case 'harddrop':
        audio.hardDrop();
        renderer.burst(lastPieceCells, { count: 16, spread: 1.2 });
        renderer.kick(3 + Math.min(6, ev.detail * 0.8));
        break;
      case 'hold':
        audio.hold();
        break;
      case 'clear': {
        const { lines, rows, perfect } = ev.detail;
        audio.clear(lines);
        renderer.flash(rows);
        renderer.vent(lines);
        renderer.kick(lines * 4);
        // Every clear is a pressure spike; a Tetris is a relief valve letting go.
        heatSurge = Math.min(0.45, heatSurge + 0.06 + lines * 0.035);
        if (lines >= 4) {
          renderer.kick(12);
          renderer.erupt(1.15);
          audio.pressureBurst(0.9);
          heatSurge = Math.min(0.6, heatSurge + 0.2);
        }
        if (perfect) {
          renderer.kick(10);
          renderer.erupt(1.6);
          audio.pressureBurst(1.3);
          heatSurge = 0.6;
        }
        break;
      }
      case 'gameover':
        audio.gameOver();
        setOverlay('over', 'Boiler blown', `Final score ${engine.score}. Lines ${engine.lines}.`,
          'Press R to fire up a new run.');
        break;
      default:
        break;
    }
  }
}

function humanRepeat(dt) {
  if (moveDir !== 0) {
    if (dasTimer > 0) {
      dasTimer -= dt;
      if (dasTimer <= 0) arrTimer = 0;
    } else {
      arrTimer += dt;
      let guard = 0;
      while (arrTimer >= ARR_MS && guard++ < 6) {
        arrTimer -= ARR_MS;
        pressAction(moveDir < 0 ? 'left' : 'right');
      }
    }
  }
  if (held.down) {
    if (softDas > 0) {
      softDas -= dt;
      if (softDas <= 0) softArr = 0;
    } else {
      softArr += dt;
      let guard = 0;
      while (softArr >= SOFT_ARR_MS && guard++ < 8) {
        softArr -= SOFT_ARR_MS;
        pressAction('soft_drop');
      }
    }
  }
}

/* ----------------------------------------------------------------- paint */

let lastPieceCells = [];
let lastLevel = 1;
/* Pressure, 0..1. Level drives the floor, clears push it up, and it decays back
   down — the whole presentation (steam, embers, rumble, drone, CSS glow) reads
   from this one number. */
let heat = 0;
let heatSurge = 0;
let lastNeedle = -999;
let lastHeatCss = -1;

function paint(state) {
  if (state.piece) lastPieceCells = state.piece.cells;

  setText(ui.score, state.score.toLocaleString('en-US'));
  setText(ui.level, String(state.level));
  setText(ui.lines, String(state.lines));
  setText(ui.tetrises, String(engine.tetrises));
  setText(ui.pieces, String(state.piece_count));
  setText(ui.clock, clockText(state.elapsed_ms));
  setText(ui.pressure, `Level ${state.level}`);
  setText(ui.gravity, `${state.gravity_ms} ms / row`);

  if (ui.needle) {
    const pct = Math.min(1, (state.level - 1) / 19);
    // Past halfway up the dial the needle starts deflecting on its own.
    const twitch = heat > 0.45 ? (Math.random() - 0.5) * (heat - 0.45) * 46 : 0;
    const target = -120 + pct * 240 + twitch;
    if (Math.abs(target - lastNeedle) > 0.4) {
      lastNeedle = target;
      ui.needle.style.transform = `rotate(${target.toFixed(1)}deg)`;
    }
  }

  const lc = engine.lastClear;
  const fresh = state.elapsed_ms - lc.at < 2600;
  setText(ui.feat, state.game_over
    ? `Topped out at level ${state.level}`
    : (lc.lines && fresh)
      ? `${['', 'Single', 'Double', 'Triple', 'TETRIS'][lc.lines]}${lc.spin ? ` · ${lc.spin}` : ''}${lc.perfect ? ' · PERFECT CLEAR' : ''}`
      : `${GAME_NAME} · ${state.piece_count} pieces fed`);

  if (state.level !== lastLevel) {
    if (state.level > lastLevel) {
      // Level up: the boiler surges and vents everything it has.
      audio.levelUp();
      audio.pressureBurst(0.55 + Math.min(0.6, state.level / 30));
      renderer.erupt(0.55 + Math.min(0.8, state.level / 24));
      heatSurge = Math.min(0.5, heatSurge + 0.18);
    }
    lastLevel = state.level;
  }

  /* One animated scalar for the entire presentation. */
  const baseHeat = Math.min(1, Math.max(0, (state.level - 1) / 18));
  heatSurge = Math.max(0, heatSurge - 0.012);
  heat = Math.min(1, baseHeat + heatSurge);
  renderer.heat = heat;
  audio.setHeat(heat);
  const cssHeat = Math.round(heat * 50) / 50;
  if (cssHeat !== lastHeatCss) {
    lastHeatCss = cssHeat;
    document.documentElement.style.setProperty('--heat', cssHeat.toFixed(2));
    if (ui.alarm) {
      ui.alarm.dataset.heat = heat > 0.82 ? 'critical' : heat > 0.45 ? 'rising' : 'calm';
      ui.alarm.textContent = heat > 0.82 ? 'PRESSURE CRITICAL'
        : heat > 0.45 ? 'PRESSURE RISING'
          : heat > 0.2 ? 'BOILER WARM' : 'BOILER IDLE';
    }
  }
  paintTally();
}

function buildTally() {
  ui.tally.innerHTML = '';
  for (const type of PIECE_TYPES) {
    const li = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = PIECE_PALETTE[type].face;
    const name = document.createElement('span');
    name.textContent = type;
    const count = document.createElement('span');
    count.className = 'count';
    count.dataset.type = type;
    count.textContent = '0';
    li.append(chip, name, count);
    ui.tally.append(li);
  }
}

function paintTally() {
  for (const node of ui.tally.querySelectorAll('.count')) {
    const next = String(engine.pieceStats[node.dataset.type] || 0);
    if (node.textContent !== next) node.textContent = next;
  }
}

/* ------------------------------------------------------------- keyboard */

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'rotate_cw', KeyX: 'rotate_cw', KeyW: 'rotate_cw',
  KeyZ: 'rotate_ccw', ControlLeft: 'rotate_ccw', ControlRight: 'rotate_ccw',
  Space: 'hard_drop', Enter: 'hard_drop',
  KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
};

/** Apply a human action and immediately service its side effects (sound,
    particles, the game-over card) so the UI never lags a frame behind. */
function pressAction(action) {
  audio.unlock();
  if (overlayMode === 'over') setOverlay('hidden');
  const legal = engine.applyAction(action);
  handleEvents();
  return legal;
}

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'KeyM') {
    audio.setEnabled(!audio.enabled);
    return;
  }
  if (e.code === 'KeyR') {
    e.preventDefault();
    engine.reset({ seed: `human-${Date.now().toString(36)}` });
    setOverlay('hidden');
    renderer.flashes.length = 0;
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    engine.setPaused(!engine.paused);
    setOverlay(engine.paused ? 'paused' : 'hidden', 'Boiler banked', 'Pause engaged — the clock is stopped.',
      'Press P to stoke it back up.');
    return;
  }

  const action = KEYMAP[e.code];
  if (!action) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();

  if (action === 'left' || action === 'right') {
    const dir = action === 'left' ? -1 : 1;
    held[action] = true;
    moveDir = dir;
    dasTimer = DAS_MS;
    arrTimer = 0;
    pressAction(action);
    return;
  }
  if (action === 'down') {
    if (!held.down) {
      held.down = true;
      softDas = SOFT_DAS_MS;
      softArr = 0;
      pressAction('soft_drop');
    }
    return;
  }
  pressAction(action);
});

window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (!action) return;
  if (action === 'left' || action === 'right') {
    held[action] = false;
    if (held.left) moveDir = -1;
    else if (held.right) moveDir = 1;
    else moveDir = 0;
  }
  if (action === 'down') held.down = false;
});

/* Touch pad: one action per tap, held buttons repeat like keys. */
for (const button of document.querySelectorAll('.touch-pad button')) {
  const action = button.dataset.action;
  let holdTimer = null;
  const fire = () => pressAction(action);
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fire();
    if (action === 'left' || action === 'right' || action === 'soft_drop') {
      holdTimer = setInterval(fire, 55);
    }
  });
  const stop = () => {
    if (holdTimer) clearInterval(holdTimer);
    holdTimer = null;
  };
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
}

window.addEventListener('resize', () => renderer.resize());

/* ----------------------------------------------------------------- boot */

buildTally();

/* The page is live from the first frame: the protocol requires the game to run
   without any input, so a human gets a running demo and presses R when ready. */
setOverlay('intro', 'Brass & Boiler', 'Stoke the boiler — pieces fall on the wall clock, not on frames.',
  '← → move · ↑ rotate · ↓ drop · space slam · C stow · P pause · R new game');
introUntil = now() + 4200;

requestAnimationFrame(frame);

window.__tetris = {
  version: '2.0',
  name: GAME_NAME,
  author: GAME_AUTHOR,
  engine,
  renderer,
  adapter,
  api: {
    state: () => engine.toState(),
    reset: (opts) => engine.reset(opts),
    freeze: () => { frozen = true; },
    unfreeze: () => { frozen = false; },
    /** Deterministic time travel for tests: freezes the page clock first. */
    advance: (ms, step = 8) => {
      frozen = true;
      if (engine.lastNow === null) engine.tick(now()); // prime the frame delta
      for (let acc = 0; acc < ms; acc += step) {
        clockOffset += step;
        engine.tick(now());
        handleEvents();
      }
      adapter.notify();
      return engine.toState();
    },
    press: (action) => pressAction(action),
    tally: () => ({ ...engine.pieceStats }),
  },
};
