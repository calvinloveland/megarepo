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
export function drawTile(ctx, px, py, size, palette, { aged = 0, glow = 0, alpha = 1 } = {}) {
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
    this.shake = 0;
    this.shakeSeed = 0;
    this.time = 0;
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

  kick(amount) {
    this.shake = Math.min(18, this.shake + amount);
  }

  update(dt) {
    this.time += dt;
    const decay = Math.pow(0.0016, dt);
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.vx *= Math.pow(0.2, dt);
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
    this.shake *= decay;
    if (this.shake < 0.2) this.shake = 0;
    this.shakeSeed += dt * 60;
  }

  /* -------------------------------------------------------------- drawing */

  draw(engine) {
    const ctx = this.ctx;
    const { cell } = this;
    const w = this.cssW;
    const h = this.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = Math.sin(this.shakeSeed * 1.7) * this.shake;
      sy = Math.cos(this.shakeSeed * 2.3) * this.shake;
    }

    ctx.save();
    ctx.translate(this.originX + sx, this.originY + sy);
    this.drawWell(ctx, w, h);

    const state = engine.toState();

    // Locked cells
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const ch = state.board[y][x];
        if (ch === '.') continue;
        drawTile(ctx, x * cell, y * cell, cell, PIECE_PALETTE[ch], { aged: 0.18 });
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
          roundRect(ctx, dx * cell + cell * 0.14, yy * cell + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.12);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Active piece, lifted slightly for a pressure-plate feel
      const lift = clamp(1 - (state.lock_timer_ms === null ? 1 : state.lock_timer_ms / 500), 0, 1);
      for (const [dx, dy] of state.piece.cells) {
        drawTile(ctx, dx * cell, dy * cell - lift * cell * 0.06, cell, PIECE_PALETTE[state.piece.type], { glow: 0.8 });
      }
    }

    this.drawParticles(ctx);
    this.drawSteam(ctx);
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

  drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const t = 1 - p.life / p.max;
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        ctx.fillRect(p.x, p.y, p.size, p.size * 1.6);
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
    for (const s of this.steam) {
      const t = 1 - s.life / s.max;
      ctx.globalAlpha = clamp(t, 0, 1) * 0.22;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size);
      g.addColorStop(0, 'rgba(238,231,218,.9)');
      g.addColorStop(1, 'rgba(238,231,218,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
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
        drawTile(ctx, ox + cx * cell, oy + cy * cell, cell, PIECE_PALETTE[type], { glow: big ? 0.6 : 0.25 });
      }
    }
  }
}
