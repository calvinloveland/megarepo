/*
 * Canvas renderer — the steampunk cabinet.
 *
 * Canvas 2D, no frameworks, no build step (project AGENTS.md). The board is
 * drawn as a riveted brass plate: every block is a beveled metal tile with four
 * rivets, the well behind it is an engraved ledger grid, and cleared rows vent
 * steam. All of it is cosmetic; none of it touches the protocol.
 */

import { INK, PIECE_PALETTE } from './theme.js';
import { BOARD_H, BOARD_W, PIECE_CELLS } from './constants.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Hard caps: the whole point is to look like the boiler is coming apart, and it
   still has to hold 60 fps on the Arena's projector. */
const MAX_PARTICLES = 700;
const MAX_STEAM = 260;
const MAX_SHOCKWAVES = 6;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** One riveted metal tile. `aged` dulls it (locked pieces), `glow` lights it (active). */
export function paintTile(ctx, px, py, size, palette, { aged = 0, glow = 0, alpha = 1 } = {}) {
  const inset = Math.max(1, size * 0.06);
  const x = px + inset;
  const y = py + inset;
  const s = size - inset * 2;
  const r = Math.max(2, s * 0.16);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Drop shadow / seat
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  roundRect(ctx, x + s * 0.06, y + s * 0.09, s, s, r);
  ctx.fill();

  // Body
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, palette.light);
  grad.addColorStop(0.42, palette.face);
  grad.addColorStop(1, palette.dark);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, s, s, r);
  ctx.fill();

  if (aged > 0) {
    ctx.fillStyle = `rgba(24,18,10,${0.42 * aged})`;
    ctx.fill();
  }

  // Bevel
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = 'rgba(255,246,222,.55)';
  ctx.beginPath();
  ctx.moveTo(x + r, y + ctx.lineWidth * 0.5);
  ctx.lineTo(x + s - r, y + ctx.lineWidth * 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.5)';
  ctx.beginPath();
  ctx.moveTo(x + r, y + s - ctx.lineWidth * 0.5);
  ctx.lineTo(x + s - r, y + s - ctx.lineWidth * 0.5);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = 'rgba(28,20,10,.75)';
  roundRect(ctx, x, y, s, s, r);
  ctx.stroke();

  // Engraved inner plate
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = 'rgba(255,240,205,.22)';
  roundRect(ctx, x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56, r * 0.5);
  ctx.stroke();

  // Rivets
  const rv = Math.max(1, s * 0.07);
  const pad = s * 0.17;
  ctx.fillStyle = 'rgba(255,244,214,.75)';
  for (const [rx, ry] of [[pad, pad], [s - pad, pad], [pad, s - pad], [s - pad, s - pad]]) {
    ctx.beginPath();
    ctx.arc(x + rx, y + ry, rv, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(40,28,12,.6)';
  for (const [rx, ry] of [[pad, pad], [s - pad, pad], [pad, s - pad], [s - pad, s - pad]]) {
    ctx.beginPath();
    ctx.arc(x + rx + rv * 0.3, y + ry + rv * 0.35, rv * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  if (glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 * glow;
    ctx.fillStyle = palette.glow;
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Sprite cache.
 *
 * Every tile used to be rebuilt from gradients and arcs on every frame — up to
 * 200 of them, plus a radial gradient per steam puff. Measured at critical
 * pressure that cost more than 100 ms a frame in a software-rendered browser.
 * Each tile variant and the steam puff are drawn once into an offscreen canvas
 * at the current cell size and then blitted, which is visually identical and
 * roughly an order of magnitude cheaper.
 */
function makeSprite(size, dpr, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(size * dpr));
  canvas.height = Math.max(1, Math.ceil(size * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  paint(ctx, size);
  return canvas;
}

export class Renderer {
  constructor(canvas, { nextCanvas = null, holdCanvas = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.holdCanvas = holdCanvas;
    this.cell = 28;
    this.originX = 0;
    this.originY = 0;
    this.dpr = 1;
    this.particles = [];
    this.steam = [];
    this.flashes = [];
    this.shockwaves = [];
    this.heat = 0;
    this.level = 1;
    this.shake = 0;
    this.shakeSeed = 0;
    this.time = 0;
    this.sprites = new Map();
    this.emberAcc = 0;
    this.steamAcc = 0;
    this.flameAcc = 0;
    this.rivetAcc = 0;
    this.reliefTimer = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(120, rect.width || this.canvas.width || 280);
    const cssH = Math.max(240, rect.height || this.canvas.height || 560);
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.cssW = cssW;
    this.cssH = cssH;

    const padX = 8;
    const padY = 8;
    this.cell = Math.floor(Math.min((cssW - padX * 2) / BOARD_W, (cssH - padY * 2) / BOARD_H));
    this.originX = (cssW - this.cell * BOARD_W) / 2;
    this.originY = (cssH - this.cell * BOARD_H) / 2;
    if (this.nextCanvas) this.fitPreview(this.nextCanvas);
    if (this.holdCanvas) this.fitPreview(this.holdCanvas);
    this.sprites.clear(); // sizes changed, every cached sprite is stale
  }

  /** One tile variant, drawn once per size: aged stack, live piece, hot piece. */
  tileSprite(type, variant) {
    const key = `tile|${type}|${variant}|${this.cell}|${this.dpr}`;
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    const palette = PIECE_PALETTE[type];
    sprite = makeSprite(this.cell, this.dpr, (ctx, size) => {
      paintTile(ctx, 0, 0, size, palette, {
        aged: variant === 'aged' ? 0.18 : 0,
        glow: variant === 'hot' ? 0.8 : 0,
      });
    });
    this.sprites.set(key, sprite);
    return sprite;
  }

  /** A soft radial puff, scaled at draw time instead of rebuilt per particle. */
  puffSprite() {
    const key = `puff|${this.dpr}`;
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    sprite = makeSprite(64, this.dpr, (ctx, size) => {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(238,231,218,0.95)');
      grad.addColorStop(0.5, 'rgba(238,231,218,0.35)');
      grad.addColorStop(1, 'rgba(238,231,218,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    });
    this.sprites.set(key, sprite);
    return sprite;
  }

  fitPreview(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(40, rect.width || canvas.width || 120);
    const cssH = Math.max(40, rect.height || canvas.height || 120);
    canvas.width = Math.round(cssW * this.dpr);
    canvas.height = Math.round(cssH * this.dpr);
  }

  /* ------------------------------------------------------------- effects */

  burst(cells, { count = 14, kind = 'spark', spread = 1 } = {}) {
    for (const [cx, cy] of cells) {
      for (let i = 0; i < count / cells.length + 1; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.4 + Math.random()) * 90 * spread;
        this.particles.push({
          x: (cx + 0.5) * this.cell, y: (cy + 0.5) * this.cell,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: 0, max: 0.35 + Math.random() * 0.4,
          size: this.cell * (0.06 + Math.random() * 0.09),
          kind, color: kind === 'spark' ? INK.ember : INK.copper,
        });
      }
    }
  }

  vent(rowCount) {
    for (let i = 0; i < 18 + rowCount * 10; i++) {
      this.steam.push({
        x: Math.random() * this.cell * BOARD_W,
        y: this.cell * BOARD_H * (0.55 + Math.random() * 0.45),
        vx: (Math.random() - 0.5) * 30,
        vy: -30 - Math.random() * 60,
        life: 0,
        max: 0.9 + Math.random() * 1.1,
        size: this.cell * (0.3 + Math.random() * 0.6),
      });
    }
  }

  flash(rows) {
    for (const row of rows) this.flashes.push({ row, life: 0, max: 0.42 });
  }

  /** A ring of pressure racing out of a clear. */
  shockwave({ x = null, y = null, strength = 1, color = '255,196,110' } = {}) {
    this.shockwaves.push({
      x: x === null ? (this.cell * BOARD_W) / 2 : x,
      y: y === null ? (this.cell * BOARD_H) / 2 : y,
      life: 0,
      max: 0.55 + strength * 0.25,
      radius: this.cell * (1 + strength),
      strength,
      color,
    });
    if (this.shockwaves.length > MAX_SHOCKWAVES) this.shockwaves.shift();
  }

  /**
   * Ambient chaos. The higher the pressure, the more the boiler leaks: embers
   * drift up out of the grate, steam hisses out of the seams, and the cabinet
   * gets a permanent rumble. Rate scales with heat squared so the early levels
   * stay calm and the late ones do not.
   */
  spawnAmbient(dt) {
    const h = this.heat;
    if (h <= 0.02) return;
    const panic = h * h;

    this.emberAcc += dt * (4 + panic * 110);
    while (this.emberAcc >= 1 && this.particles.length < MAX_PARTICLES) {
      this.emberAcc -= 1;
      const fromLeft = Math.random() < 0.5;
      this.particles.push({
        x: (fromLeft ? 0.06 : 0.94) * this.cell * BOARD_W + (Math.random() - 0.5) * this.cell * 2,
        y: this.cell * BOARD_H * (0.7 + Math.random() * 0.32),
        vx: (fromLeft ? 1 : -1) * (10 + Math.random() * 50 * panic),
        vy: -(30 + Math.random() * 110 * (0.4 + h)),
        life: 0,
        max: 0.8 + Math.random() * 1.8,
        size: this.cell * (0.06 + Math.random() * 0.13),
        kind: 'ember',
        behind: true,
        color: Math.random() < 0.3 ? '255,226,160' : '255,140,60',
      });
    }

    /* Rivets working themselves loose off the frame, faster the hotter it gets. */
    this.rivetAcc += dt * panic * 9;
    while (this.rivetAcc >= 1 && this.particles.length < MAX_PARTICLES) {
      this.rivetAcc -= 1;
      const edge = Math.floor(Math.random() * 4);
      const w = this.cell * BOARD_W;
      const h2 = this.cell * BOARD_H;
      const x = edge === 0 || edge === 1 ? Math.random() * w : (edge === 2 ? 0 : w);
      const y = edge === 0 ? 0 : edge === 1 ? h2 : Math.random() * h2;
      this.particles.push({
        x, y,
        vx: (x < w / 2 ? 1 : -1) * (40 + Math.random() * 120),
        vy: -(60 + Math.random() * 140),
        life: 0,
        max: 0.9 + Math.random() * 1.2,
        size: this.cell * (0.05 + Math.random() * 0.06),
        kind: 'rivet',
        behind: true,
        color: '240,214,139',
      });
    }

    /* Flame licks off the grate under the well: short-lived, fast, bright. */
    this.flameAcc += dt * (panic * 46);
    while (this.flameAcc >= 1 && this.particles.length < MAX_PARTICLES) {
      this.flameAcc -= 1;
      this.particles.push({
        x: Math.random() * this.cell * BOARD_W,
        y: this.cell * BOARD_H - Math.random() * this.cell * 0.5,
        vx: (Math.random() - 0.5) * 30,
        vy: -(90 + Math.random() * 260 * h),
        life: 0,
        max: 0.35 + Math.random() * 0.5,
        size: this.cell * (0.1 + Math.random() * 0.2),
        kind: 'flame',
        behind: true,
        color: Math.random() < 0.4 ? '255,236,170' : '255,146,44',
      });
    }

    this.steamAcc += dt * (2 + panic * 26);
    while (this.steamAcc >= 1 && this.steam.length < MAX_STEAM) {
      this.steamAcc -= 1;
      const fromTop = Math.random() < 0.35;
      this.steam.push({
        x: Math.random() * this.cell * BOARD_W,
        y: fromTop ? this.cell * BOARD_H * 0.1 : this.cell * BOARD_H * (0.82 + Math.random() * 0.18),
        vx: (Math.random() - 0.5) * (20 + 40 * panic),
        vy: (fromTop ? 1 : -1) * (20 + Math.random() * 70 * (0.3 + h)),
        life: 0,
        max: 1 + Math.random() * 1.4,
        size: this.cell * (0.25 + Math.random() * 0.5),
      });
    }
  }

  /** Full-width eruption: level ups, Tetrises, and the top of the dial. */
  erupt(strength = 1) {
    const h = this.heat;
    this.shockwave({ strength });
    for (let i = 0; i < 26 * strength; i++) {
      const x = Math.random() * this.cell * BOARD_W;
      this.steam.push({
        x,
        y: this.cell * BOARD_H * (0.55 + Math.random() * 0.45),
        vx: (Math.random() - 0.5) * 90,
        vy: -(80 + Math.random() * 190),
        life: 0,
        max: 0.9 + Math.random() * 1.2,
        size: this.cell * (0.4 + Math.random() * 0.8),
      });
    }
    if (this.steam.length > MAX_STEAM) this.steam.splice(0, this.steam.length - MAX_STEAM);
    this.burst([[0, BOARD_H - 1], [BOARD_W - 1, BOARD_H - 1]], { count: 30 * strength, spread: 1.4 });
    this.kick(6 + strength * 10 + h * 8);
  }

  /** How violently the cabinet is allowed to move right now. */
  get violence() {
    return 1 + this.level * 0.09;
  }

  kick(amount) {
    this.shake = Math.min(46, this.shake + amount * this.violence);
  }

  /**
   * Per-tile vibration. Every locked block gets its own phase and frequency pair
   * from its board coordinates, so the stack rattles itself apart instead of
   * sliding around as one piece. Amplitude is multiplied by the level.
   */
  cellShake(x, y, cell) {
    const amp = cell * Math.min(0.18, 0.008 + this.level * 0.0065) * (0.3 + this.heat * 1.05);
    if (amp < 0.2) return null;
    const phase = ((x * 12.9898 + y * 78.233) * 43758.5453) % 6.283;
    return [
      Math.sin(this.time * (17 + ((x * 7 + y * 13) % 11)) + phase) * amp,
      Math.cos(this.time * (19 + ((x * 5 + y * 11) % 9)) + phase * 1.7) * amp,
    ];
  }

  /** The live piece shakes as one body, and harder than the settled stack. */
  pieceShake(cell) {
    const amp = cell * Math.min(0.3, 0.012 + this.level * 0.01) * (0.4 + this.heat * 1.1);
    if (amp < 0.25) return [0, 0];
    return [
      Math.sin(this.time * 31) * amp + Math.sin(this.time * 47.3) * amp * 0.4,
      Math.cos(this.time * 37.7) * amp + Math.cos(this.time * 53.1) * amp * 0.4,
    ];
  }

  update(dt) {
    this.time += dt;
    const decay = Math.pow(0.0016, dt);
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Embers are buoyant; sparks from a slam fall.
      const buoyant = p.kind === 'ember' || p.kind === 'flame';
      if (p.kind === 'rivet') p.spin = (p.spin || 0) + dt * 14;
      p.vy += (buoyant ? -26 : 420) * dt;
      p.vx *= Math.pow(buoyant ? 0.6 : 0.2, dt);
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const s of this.steam) {
      s.life += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.35, dt);
      s.size += this.cell * 0.5 * dt;
    }
    this.steam = this.steam.filter((s) => s.life < s.max);
    for (const f of this.flashes) f.life += dt;
    this.flashes = this.flashes.filter((f) => f.life < f.max);
    for (const w of this.shockwaves) w.life += dt;
    this.shockwaves = this.shockwaves.filter((w) => w.life < w.max);

    /* Steam screaming out of the frame's side seams. */
    if (this.heat > 0.35) {
      this.sideAcc = (this.sideAcc || 0) + dt * (this.heat - 0.3) * 34;
      while (this.sideAcc >= 1 && this.steam.length < MAX_STEAM) {
        this.sideAcc -= 1;
        const left = Math.random() < 0.5;
        this.steam.push({
          x: left ? 0 : this.cell * BOARD_W,
          y: this.cell * BOARD_H * Math.random(),
          vx: (left ? -1 : 1) * (60 + Math.random() * 130),
          vy: -(20 + Math.random() * 60),
          life: 0,
          max: 0.7 + Math.random() * 0.9,
          size: this.cell * (0.2 + Math.random() * 0.35),
        });
      }
    }

    /* Past critical the boiler lets go on its own every few seconds. */
    if (this.heat > 0.78) {
      this.reliefTimer -= dt;
      if (this.reliefTimer <= 0) {
        this.reliefTimer = 3.4 - (this.heat - 0.78) * 6;
        this.erupt(0.5 + this.heat * 0.5);
      }
    } else {
      this.reliefTimer = 1.5;
    }
    this.shake *= decay;
    if (this.shake < 0.2) this.shake = 0;
    this.shakeSeed += dt * 60;
    this.spawnAmbient(dt);
  }

  /* -------------------------------------------------------------- drawing */

  draw(engine) {
    const ctx = this.ctx;
    const { cell } = this;
    const w = this.cssW;
    const h = this.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.level = engine.level || 1;

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = Math.sin(this.shakeSeed * 1.7) * this.shake;
      sy = Math.cos(this.shakeSeed * 2.3) * this.shake;
    }
    // The cabinet itself starts to rattle once the pressure is up, and the level
    // multiplies it — a level 20 board is genuinely hard to look at.
    const rumble = this.heat > 0.2 ? (this.heat - 0.2) * 3.4 * this.violence : 0;
    if (rumble > 0) {
      sx += Math.sin(this.time * 41) * rumble;
      sy += Math.cos(this.time * 53) * rumble * 0.7;
    }

    ctx.save();
    ctx.translate(this.originX + sx, this.originY + sy);
    this.drawWell(ctx, w, h);

    const state = engine.toState();

    // Ambient fire and embers read as *behind* the stack, so a level 20 board is
    // still legible through the blaze.
    this.drawParticles(ctx, true);

    // Locked cells
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const ch = state.board[y][x];
        if (ch === '.') continue;
        const jitter = this.cellShake(x, y, cell);
        ctx.drawImage(
          this.tileSprite(ch, 'aged'),
          x * cell + (jitter ? jitter[0] : 0),
          y * cell + (jitter ? jitter[1] : 0),
          cell,
          cell,
        );
      }
    }

    // Clear flashes sit over the freshly collapsed stack
    for (const f of this.flashes) {
      const t = 1 - f.life / f.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, t) * 0.85;
      const grad = ctx.createLinearGradient(0, f.row * cell, 0, (f.row + 1) * cell);
      grad.addColorStop(0, 'rgba(255,236,190,0)');
      grad.addColorStop(0.5, 'rgba(255,214,130,.95)');
      grad.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-cell * 0.6, f.row * cell, cell * (BOARD_W + 1.2), cell);
      ctx.restore();
    }

    if (!state.game_over && state.piece) {
      const [pjx, pjy] = this.pieceShake(cell);

      // Ghost: where the piece lands (FEATURES.md core polish)
      const gy = engine.ghostY();
      if (gy !== null && gy !== state.piece.y) {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.setLineDash([cell * 0.12, cell * 0.12]);
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.strokeStyle = PIECE_PALETTE[state.piece.type].light;
        for (const [dx, dy] of state.piece.cells) {
          const yy = gy + dy - state.piece.y;
          roundRect(ctx, dx * cell + cell * 0.14 + pjx, yy * cell + cell * 0.14 + pjy, cell * 0.72, cell * 0.72, cell * 0.12);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Active piece, lifted slightly for a pressure-plate feel
      const lift = clamp(1 - (state.lock_timer_ms === null ? 1 : state.lock_timer_ms / 500), 0, 1);
      const sprite = this.tileSprite(state.piece.type, 'hot');
      for (const [dx, dy] of state.piece.cells) {
        ctx.drawImage(sprite, dx * cell + pjx, dy * cell - lift * cell * 0.06 + pjy, cell, cell);
      }
    }

    this.drawGrate(ctx);
    this.drawShockwaves(ctx);
    this.drawParticles(ctx, false);
    this.drawSteam(ctx);
    this.drawHaze(ctx);
    ctx.restore();

    this.drawPreview(this.holdCanvas, state.hold ? [state.hold] : [], { big: true });
    this.drawPreview(this.nextCanvas, state.next || [], { big: false });
    return state;
  }

  drawWell(ctx, w, h) {
    const { cell } = this;
    const bw = cell * BOARD_W;
    const bh = cell * BOARD_H;

    // Soot-black pressure chamber
    const grad = ctx.createLinearGradient(0, 0, 0, bh);
    grad.addColorStop(0, '#191510');
    grad.addColorStop(0.5, '#100e0b');
    grad.addColorStop(1, '#161209');
    ctx.fillStyle = grad;
    ctx.fillRect(-cell * 0.35, -cell * 0.35, bw + cell * 0.7, bh + cell * 0.7);

    // Engraved ledger grid
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(200,162,74,.24)';
    ctx.beginPath();
    for (let x = 1; x < BOARD_W; x++) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, bh);
    }
    for (let y = 1; y < BOARD_H; y++) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(bw, y * cell);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,162,74,.34)';
    ctx.strokeRect(0.5, 0.5, bw - 1, bh - 1);
    ctx.restore();

    // Corner bolts on the chamber
    ctx.fillStyle = 'rgba(200,162,74,.5)';
    for (const [bx, by] of [[0, 0], [bw, 0], [0, bh], [bw, bh]]) {
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1.5, cell * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
    void w; void h;
  }

  /** The fire under the floor: a hot bar of light along the bottom of the well. */
  drawGrate(ctx) {
    if (this.heat < 0.2) return;
    const bw = this.cell * BOARD_W;
    const bh = this.cell * BOARD_H;
    const flicker = 0.75 + Math.sin(this.time * 9.3) * 0.15 + Math.sin(this.time * 23.7) * 0.1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(0, bh, 0, bh - this.cell * (1.6 + this.heat * 3));
    grad.addColorStop(0, `rgba(255,168,60,${(0.28 + this.heat * 0.5) * flicker})`);
    grad.addColorStop(0.4, `rgba(255,104,32,${(0.12 + this.heat * 0.3) * flicker})`);
    grad.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, bh - this.cell * (1.6 + this.heat * 3), bw, this.cell * (1.6 + this.heat * 3));
    ctx.restore();
  }

  drawShockwaves(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this.shockwaves) {
      const t = w.life / w.max;
      const r = w.radius + t * this.cell * (6 + w.strength * 8);
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = `rgba(${w.color},${0.9 - t * 0.7})`;
      ctx.lineWidth = Math.max(1, this.cell * 0.16 * (1 - t) * w.strength);
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Heat shimmer: a warm gradient over the top of the well, thicker with heat. */
  drawHaze(ctx) {
    if (this.heat < 0.15) return;
    const h = this.heat;
    const bw = this.cell * BOARD_W;
    const bh = this.cell * BOARD_H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.05 + h * 0.13;
    const wobble = Math.sin(this.time * 3.1) * 0.5 + 0.5;
    const grad = ctx.createLinearGradient(0, bh * (0.55 - wobble * 0.1), 0, bh);
    grad.addColorStop(0, 'rgba(255,120,40,0)');
    grad.addColorStop(0.55, `rgba(255,${110 + h * 60},40,0.5)`);
    grad.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, bh * 0.5, bw, bh * 0.5);
    ctx.restore();
  }

  drawParticles(ctx, behind) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (!!p.behind !== !!behind) continue;
      const t = 1 - p.life / p.max;
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = p.color;
      const colour = p.kind === 'spark' ? INK.ember : `rgba(${p.color},1)`;
      ctx.fillStyle = colour;
      if (p.kind === 'spark') {
        ctx.fillRect(p.x, p.y, p.size, p.size * 1.6);
      } else if (p.kind === 'rivet') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin || 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(60,40,10,.7)';
        ctx.beginPath();
        ctx.arc(p.size * 0.3, p.size * 0.3, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'flame') {
        ctx.globalAlpha = clamp(t, 0, 1) * 0.9;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 0.7, p.size * (1.4 + t), 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ember') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawSteam(ctx) {
    ctx.save();
    const puff = this.puffSprite();
    for (const s of this.steam) {
      const t = 1 - s.life / s.max;
      ctx.globalAlpha = clamp(t, 0, 1) * (0.2 + this.heat * 0.22);
      ctx.drawImage(puff, s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    }
    ctx.restore();
  }

  /** Next / hold preview. Pieces are drawn in their spawn orientation. */
  drawPreview(canvas, pieces, { big }) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = this.dpr;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const slots = big ? 1 : 5;
    const slotH = h / slots;
    const cell = Math.min(slotH * 0.26, w * 0.16, 22);

    for (let i = 0; i < slots; i++) {
      const type = pieces[i];
      if (!type) continue;
      const boxX = 0;
      const boxY = i * slotH;
      if (!big) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = INK.brass;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(boxX + 4, boxY + slotH - 1);
        ctx.lineTo(boxX + w - 4, boxY + slotH - 1);
        ctx.stroke();
        ctx.restore();
      }
      const cellsOfPiece = PIECE_CELLS[type][0];
      const minX = Math.min(...cellsOfPiece.map((c) => c[0]));
      const maxX = Math.max(...cellsOfPiece.map((c) => c[0]));
      const minY = Math.min(...cellsOfPiece.map((c) => c[1]));
      const maxY = Math.max(...cellsOfPiece.map((c) => c[1]));
      const pw = (maxX - minX + 1) * cell;
      const ph = (maxY - minY + 1) * cell;
      const ox = (w - pw) / 2 - minX * cell;
      const oy = boxY + (slotH - ph) / 2 - minY * cell;
      for (const [cx, cy] of cellsOfPiece) {
        paintTile(ctx, ox + cx * cell, oy + cy * cell, cell, PIECE_PALETTE[type], { glow: big ? 0.6 : 0.25 });
      }
    }
  }
}
