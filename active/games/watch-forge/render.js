// render.js — Watch Forge canvas rendering (browser only)
// =========================================================
// Draws an animated skeletonized dial of a champion watch, a thickness
// side-profile, and the evolution fitness chart. Pure draw functions — no
// DOM access; game.js owns canvases and the RAF loop.

'use strict';

(function (root) {

const D = root.WATCH_DATA;
const { COMPLICATIONS, COMPLICATION_SLOTS, BARREL } = D;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  case:      '#3c4148',
  bezel:     '#565d66',
  backdrop:  '#101318',
  plate:     '#232931',
  bridge:    '#2e363f',
  brass:     '#d9a03f',
  brassDark: '#a8742c',
  steel:     '#b9c2cc',
  steelDark: '#7e8894',
  gold:      '#e8c36a',
  ruby:      '#e23b4e',
  dialMetal: '#1a1f26',
  hand:      '#dfe4ea',
  lume:      '#f4f7fb',
  accent:    '#ff7a3d',
  white:     '#e8ecf2',
  dim:       '#8b93a0',
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function pol(cx, cy, ang, rad) {
  return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
}

function near(value, target, eps) { return Math.abs(value - target) < eps; }

// ---------------------------------------------------------------------------
// Part drawing primitives
// ---------------------------------------------------------------------------

function drawGear(ctx, x, y, r, teeth, rot, opts = {}) {
  const body = opts.body || C.brass;
  const edge = opts.edge || C.brassDark;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // Teeth
  ctx.fillStyle = edge;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const a1 = a - 0.42 / teeth * Math.PI;
    const a2 = a + 0.42 / teeth * Math.PI;
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.lineTo(Math.cos(a) * (r + r * 0.16), Math.sin(a) * (r + r * 0.16));
    ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
  }
  ctx.closePath();
  ctx.fill();

  // Body
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();

  // Spokes + rim bridge look
  const spokes = opts.spokes || 4;
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, r * 0.09);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.10, Math.sin(a) * r * 0.10);
    ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
    ctx.stroke();
  }

  // Hub + ruby jewel
  ctx.fillStyle = C.steelDark;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBarrel(ctx, x, y, r, rot, wind = 0) {
  ctx.save();
  ctx.translate(x, y);
  // Ratchet wheel (top face)
  drawGear(ctx, 0, 0, r * 0.86, 14, rot, { body: C.steel, edge: C.steelDark, spokes: 3 });
  // Mainspring coils visible through the ratchet slots
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const rr = r * (0.28 + i * 0.085 + wind * 0.01);
    ctx.moveTo(rr, 0);
    ctx.arc(0, 0, rr, 0, Math.PI * 1.6);
  }
  ctx.stroke();
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.10, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBalance(ctx, x, y, r, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // Rim
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  // Cross arms
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, 0); ctx.lineTo(r * 0.95, 0);
  ctx.moveTo(0, -r * 0.95); ctx.lineTo(0, r * 0.95);
  ctx.stroke();
  // Spoke screws (the classic skeleton look)
  ctx.fillStyle = C.steel;
  for (const sx of [-r * 0.82, r * 0.82]) {
    ctx.beginPath(); ctx.arc(sx, 0, r * 0.11, 0, Math.PI * 2); ctx.fill();
  }
  // Hub
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawHairspring(ctx, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const rr = r * (0.14 + i * 0.12);
    ctx.moveTo(rr, 0);
    ctx.arc(0, 0, rr, 0, Math.PI * 1.7);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEscape(ctx, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = C.steel;
  const teeth = 15;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const a1 = a - (0.5 / teeth) * Math.PI;
    const a2 = a + (0.5 / teeth) * Math.PI;
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.lineTo(Math.cos(a) * (r + r * 0.38), Math.sin(a) * (r + r * 0.38));
    ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.steelDark;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawAnchor(ctx, x, y, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = C.steelDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(14, 0);
  ctx.moveTo(14, 0);
  ctx.lineTo(21, -7);
  ctx.moveTo(14, 0);
  ctx.lineTo(21, 7);
  ctx.stroke();
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(-14, 0, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(14, 0, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawHand(ctx, cx, cy, ang, len, width, color, tail = 0.18) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -len);
  ctx.lineTo(width, 0);
  ctx.lineTo(0, len * tail);
  ctx.lineTo(-width, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Complication furniture (dial-side drawings)
// ---------------------------------------------------------------------------

function drawWindow(ctx, x, y, w, h, text, sub = '') {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = C.dialMetal;
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.white;
  ctx.font = `bold ${Math.floor(h * 0.72)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, sub ? -2 : 1);
  if (sub) {
    ctx.fillStyle = C.dim;
    ctx.font = `${Math.floor(h * 0.26)}px ui-monospace, monospace`;
    ctx.fillText(sub, 0, h * 0.34);
  }
  ctx.restore();
}

function drawMoonphase(ctx, x, y, r, phase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = C.dialMetal;
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Moon disc: dark circle with a bright terminatored blob
  ctx.fillStyle = '#0b0d10';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.fill();
  const shift = Math.cos(phase * Math.PI * 2) * r * 0.5;
  ctx.fillStyle = '#e9eef5';
  ctx.beginPath();
  ctx.arc(shift, -r * 0.25, r * 0.38, 0, Math.PI * 2);
  ctx.arc(shift, r * 0.0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.dim;
  for (const s of [[-0.4, 0.5], [0.45, 0.45], [0.05, 0.75]]) {
    ctx.beginPath(); ctx.arc(s[0] * r, s[1] * r, 1.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = C.white;
  ctx.font = `${Math.round(r * 0.42)}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('☾', 0, -r * 0.02);
  ctx.restore();
}

function drawArcGauge(ctx, x, y, r, value, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  ctx.strokeStyle = C.accent;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 0.15 + value * Math.PI * 0.7); ctx.stroke();
  ctx.lineCap = 'butt';
  const a = Math.PI * 0.15 + value * Math.PI * 0.7;
  const p = pol(0, 0, a, r);
  ctx.strokeStyle = C.hand;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(p.x, p.y); ctx.stroke();
  ctx.fillStyle = C.dim;
  ctx.font = `${Math.round(r * 0.55)}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, -r * 0.1);
  ctx.restore();
}

function drawSubdial(ctx, cx, cy, r, handAng, label, ticks = 12) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = C.dialMetal;
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = 1;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
    ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.stroke();
  }
  drawHand(ctx, 0, 0, handAng, r * 0.68, r * 0.06, C.accent, 0);
  ctx.fillStyle = C.dim;
  ctx.font = `${Math.round(r * 0.5)}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, r * 0.02);
  ctx.restore();
}

function drawPerpetual(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = C.dialMetal;
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 3); ctx.fill(); ctx.stroke();
  const day = new Date(2026, 7, 27); // J.16 (Thu 27)
  const parts = [['D', String(27).padStart(2, '0')], ['AUG', '27'], ['THU', 'J.16'], ['24', 'LEAP']];
  const w = r * 0.42, h = r * 0.5;
  parts.forEach((p, i) => {
    const px = -r + w * 0.55 + i * w * 1.05;
    ctx.strokeStyle = C.brassDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(px - w / 2, -h / 2, w, h);
    ctx.fillStyle = C.white;
    ctx.font = `bold ${Math.round(h * 0.4)}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p[1], px, -h * 0.12);
    ctx.fillStyle = C.dim;
    ctx.font = `${Math.round(h * 0.22)}px ui-monospace, monospace`;
    ctx.fillText(p[0], px, h * 0.32);
  });
  ctx.restore();
}

function drawGMTRing(ctx, cx, cy, R, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = 1.2;
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rot;
    const isDay = i >= 6 && i < 18;
    ctx.strokeStyle = isDay ? '#e6c87c' : C.dim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.80, Math.sin(a) * R * 0.80);
    ctx.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorldTime(ctx, cx, cy, R, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = C.dialMetal;
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.save();
  ctx.rotate(rot);
  const cities = ['GMT', 'NYC', 'RIC', 'DUBAI', 'TYO', 'SYD', 'LAX', 'LON'];
  ctx.font = `${Math.round(R * 0.055)}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < cities.length; i++) {
    const a = (i / cities.length) * Math.PI * 2;
    const p = pol(0, 0, a - Math.PI / 2, R * 0.78);
    ctx.fillStyle = i === 0 ? C.accent : C.dim;
    ctx.fillText(cities[i], p.x, p.y);
  }
  ctx.restore();
  // Fixed index marker at 12
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.92); ctx.lineTo(-5, -R * 0.86); ctx.lineTo(5, -R * 0.86);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawTourbillon(ctx, x, y, r, cageRot, balAng, beatPhase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(cageRot);
  // Cage frame
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
  ctx.moveTo(0, -r); ctx.lineTo(0, r);
  ctx.stroke();
  // Balance inside the cage, oscillating in place
  const bAng = beatPhase * 0.5;
  drawBalance(ctx, 0, 0, r * 0.5, bAng);
  drawHairspring(ctx, 0, 0, r * 0.34, balAng);
  ctx.restore();
}

function drawRepeaterGongs(ctx, cx, cy, R, t) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = C.steelDark;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.90, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.93, 0, Math.PI * 2); ctx.stroke();
  // Hammer taps on a cycle
  const beat = Math.floor(t * 1.2) % 4;
  const a = Math.PI * 0.62;
  const p = pol(cx, cy, a, R * 0.9);
  const struck = near((t * 1.2) % 4, beat % 4, 0.2);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(a - Math.PI / 2) * 12 * (struck ? 1 : 0.3), p.y + Math.sin(a - Math.PI / 2) * 12 * (struck ? 1 : 0.3));
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The dial
// ---------------------------------------------------------------------------

// Layout constants (fractions of dial radius, origin = dial centre, y down).
const LAYOUT = {
  caseR: 1.00,
  barrelY: -0.58,          // barrel row near 12 o'clock
  wheelAt: (t) => ({ x: Math.sin(t * Math.PI) * 0.16, y: -0.50 + t * 0.50 }),
  fourth: { x: 0.20, y: 0.16 },
  escape: { x: 0.13, y: 0.33 },
  anchor: { x: 0.04, y: 0.40 },
  balance: { x: -0.27, y: 0.52 },
};

/**
 * Draw a watch dial. `pheno` is a phenotype object; `t` is seconds of
 * animation time; `specials` carries extra UI hints (e.g. showing a
 * second-time-zone hand angle).
 */
function drawWatchDial(ctx, size, pheno, t, specials = {}) {
  const S = size;                       // square logical size
  const R = S * 0.44;                   // dial radius in px
  const cx = S / 2, cy = S / 2;
  const open = pheno.open;
  const geno = pheno.geno;
  const P = (fx, fy) => ({ x: cx + fx * R, y: cy + fy * R });

  ctx.clearRect(0, 0, S, S);

  // Backdrop + case -------------------------------------------------------
  ctx.fillStyle = C.backdrop;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.case;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.bezel;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2); ctx.fill();
  // Crown at 3 o'clock
  ctx.fillStyle = C.case;
  ctx.beginPath();
  ctx.roundRect(cx + R * 0.985, cy - R * 0.05, R * 0.09, R * 0.10, 2);
  ctx.fill();

  // --- Under-plate layer (gears, barrels, escapement, balance) -----------
  const under = [];

  // Barrels
  const nBarrels = geno.barrels;
  const barrelPositions = [];
  for (let i = 0; i < nBarrels; i++) {
    const x = (i - (nBarrels - 1) / 2) * 0.34;
    barrelPositions.push(P(x, LAYOUT.barrelY));
  }

  // Gear train: snake from each barrel down to the centre wheel.
  const trainWheels = geno.trainWheels;
  const wheelPos = [];
  for (let i = 0; i < trainWheels; i++) {
    const t = trainWheels === 1 ? 0.5 : i / (trainWheels - 1);
    wheelPos.push(P(LAYOUT.wheelAt(t).x, LAYOUT.wheelAt(t).y));
  }

  // Speeds: barrel slowest, wheels ×4 per step, escape ticks.
  const tWheelSize = R * (0.075 + trainWheels * 0.004);

  // Under-plate drawing pass
  for (const bp of barrelPositions) {
    drawBarrel(ctx, bp.x, bp.y, R * 0.15, t * 0.05);
    under.push({ x: bp.x, y: bp.y, r: R * 0.17 });
  }
  wheelPos.forEach((wp, i) => {
    // ratio chain: 1:5 per wheel from barrel
    const speed = 0.05 * Math.pow(5, i / Math.max(1, trainWheels - 1));
    drawGear(ctx, wp.x, wp.y, tWheelSize, 14, t * speed);
    under.push({ x: wp.x, y: wp.y, r: tWheelSize * 1.45 });
  });
  // Centre wheel under the hands
  const cw = P(0, 0);
  drawGear(ctx, cw.x, cw.y, R * 0.16, 16, t * 0.22);
  under.push({ x: cw.x, y: cw.y, r: R * 0.20 });

  const fw = P(LAYOUT.fourth.x, LAYOUT.fourth.y);
  drawGear(ctx, fw.x, fw.y, R * 0.11, 12, t * 0.9);
  under.push({ x: fw.x, y: fw.y, r: R * 0.13 });

  const hasTourbillon = !!geno.complications.tourbillon;
  if (hasTourbillon) {
    // Balance lives inside the tourbillon cage at its slot.
    const slot = COMPLICATION_SLOTS.tourbillon;
    const tp = P(Math.cos(slot.ang) * slot.rad, Math.sin(slot.ang) * slot.rad);
    under.push({ x: tp.x, y: tp.y, r: R * 0.34 });
  } else {
    const ep = P(LAYOUT.escape.x, LAYOUT.escape.y);
    const ap = P(LAYOUT.anchor.x, LAYOUT.anchor.y);
    const bp = P(LAYOUT.balance.x, LAYOUT.balance.y);
    const escapeRot = Math.floor(t * 6) * (Math.PI * 2 / 15);
    drawEscape(ctx, ep.x, ep.y, R * 0.085, escapeRot);
    under.push({ x: ep.x, y: ep.y, r: R * 0.115 });
    const anchorAng = Math.sin(t * 6 * Math.PI * 2) * 0.45;
    drawAnchor(ctx, ap.x, ap.y, anchorAng);
    under.push({ x: ap.x, y: ap.y, r: R * 0.07 });
    const beat = geno.beat >= 36000 ? 6 : geno.beat >= 21600 ? 4 : 3;
    const balAng = Math.sin(t * 2 * Math.PI * (beat / 8)) * 0.5;
    drawBalance(ctx, bp.x, bp.y, R * 0.20, balAng);
    drawHairspring(ctx, bp.x, bp.y, R * 0.13, t * 2);
    under.push({ x: bp.x, y: bp.y, r: R * 0.24 });
  }

  // Complications that sit under the plate get aperture holes too.
  for (const id of Object.keys(geno.complications)) {
    const slot = COMPLICATION_SLOTS[id];
    if (!slot || slot.rad === 0 || id === 'tourbillon' || id === 'repeater' || id === 'gmt' || id === 'worldTime') continue;
    const cp = P(Math.cos(slot.ang) * slot.rad, Math.sin(slot.ang) * slot.rad);
    under.push({ x: cp.x, y: cp.y, r: R * 0.11 });
  }

  // --- Skeletonized plate with punched apertures -------------------------
  // Build the plate on an offscreen canvas, punch holes with the alpha
  // channel, then composite. Aperture size grows with openness.
  const plate = document.createElement('canvas');
  plate.width = S; plate.height = S;
  const pctx = plate.getContext('2d');
  const grd = pctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 0.99);
  grd.addColorStop(0, C.plate);
  grd.addColorStop(1, C.bridge);
  pctx.fillStyle = grd;
  pctx.beginPath(); pctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2); pctx.fill();
  pctx.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r) => {
    pctx.beginPath(); pctx.arc(x, y, r, 0, Math.PI * 2); pctx.fill();
  };
  const openScale = 0.45 + open * 0.85;
  for (const u of under) hole(u.x, u.y, u.r * openScale);
  // Rim-adjacent apertures let seconds/complication furniture breathe.
  hole(cx, cy, R * (0.10 + open * 0.10));
  ctx.drawImage(plate, 0, 0);

  // Bridge screws along the rim for the skeleton "openworked" feel.
  ctx.fillStyle = C.steelDark;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = pol(cx, cy, a, R * 0.93);
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // Minute track on the rim
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const big = i % 5 === 0;
    ctx.lineWidth = big ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.965, Math.sin(a) * R * 0.965);
    ctx.lineTo(Math.cos(a) * (big ? R * 0.94 : R * 0.955), Math.sin(a) * (big ? R * 0.94 : R * 0.955));
    ctx.stroke();
  }

  // --- Over-plate complication furniture ---------------------------------
  const comps = pheno.compList;
  const hasRegulator = !!geno.complications.regulator;
  const hourAng = specials.hourAng ?? Math.PI * 0.5;
  const minAng = specials.minAng ?? 0.2;
  const secAng = specials.secAng ?? t * 3;
  const dateValue = specials.dateValue ?? 27;
  const gmtAng = specials.gmtAng ?? 1.1;

  for (const comp of comps) {
    const slot = COMPLICATION_SLOTS[comp.id];
    if (!slot) continue;
    const cp = P(Math.cos(slot.ang) * slot.rad, Math.sin(slot.ang) * slot.rad);
    const v = comp.grade / 3; // 0..1 quality signal
    switch (slot.kind) {
      case 'window': {
        const labels = { date: ['DATE', String(dateValue).padStart(2, '0')],
                         day: ['DAY', 'THU'], month: ['MON', 'AUG'], leapYear: ['LEAP', 'J.16'] };
        const [sub, main] = labels[comp.id] || ['', String(dateValue)];
        drawWindow(ctx, cp.x, cp.y, R * 0.24, R * 0.13, main, comp.id === 'leapYear' ? '04' : sub);
        break;
      }
      case 'bigDate':
        drawWindow(ctx, cp.x, cp.y, R * 0.30, R * 0.15, String(dateValue).padStart(2, '0'), 'BIG DATE');
        break;
      case 'jumpingHour': {
        const jh = Math.floor(hourAng / (Math.PI * 2) * 12) % 12 + 1;
        drawWindow(ctx, cp.x, cp.y, R * 0.22, R * 0.26, String(jh), 'HOUR');
        break;
      }
      case 'moonphase':
        drawMoonphase(ctx, cp.x, cp.y, R * 0.17, t * 0.02 % 1 + v * 0.3);
        break;
      case 'arc': {
        const label = comp.id === 'powerReserve' ? 'RESERVE' : 'EQ. TIME';
        drawArcGauge(ctx, cp.x, cp.y, R * 0.16, v, label);
        break;
      }
      case 'chronograph':
        drawSubdial(ctx, cp.x, cp.y, R * 0.15, specials.chronoAng ?? t * 2, comp.id === 'splitSecond' ? 'RATTR.' : 'CHRONO');
        break;
      case 'perpetual':
        drawPerpetual(ctx, cp.x, cp.y, R * 0.20);
        break;
      case 'gmt': {
        drawGMTRing(ctx, cx, cy, R, gmtAng);
        const gp = P(Math.cos(slot.ang) * slot.rad, Math.sin(slot.ang) * slot.rad);
        drawWindow(ctx, gp.x, gp.y, R * 0.20, R * 0.12, '24H', 'GMT');
        break;
      }
      case 'worldTime':
        drawWorldTime(ctx, cx, cy, R, gmtAng);
        break;
      case 'tourbillon': {
        const slotT = COMPLICATION_SLOTS.tourbillon;
        const tp = P(Math.cos(slotT.ang) * slotT.rad, Math.sin(slotT.ang) * slotT.rad);
        const beat = geno.beat >= 36000 ? 6 : geno.beat >= 21600 ? 4 : 3;
        drawTourbillon(ctx, tp.x, tp.y, R * 0.30, t * 0.4, t * 3, Math.sin(t * 2 * Math.PI * (beat / 8)));
        break;
      }
      case 'repeater':
        drawRepeaterGongs(ctx, cx, cy, R, t);
        break;
      case 'regulator': {
        // Hours (small, 12), minutes (big, centre), seconds (small, 6)
        drawSubdial(ctx, P(0, -0.30).x, P(0, -0.30).y, R * 0.13, hourAng / 12, 'H');
        drawSubdial(ctx, cx, cy, R * 0.17, minAng, 'MIN');
        drawSubdial(ctx, P(0, 0.30).x, P(0, 0.30).y, R * 0.13, secAng, 'SEC');
        break;
      }
      default: break;
    }
  }

  // --- Hands ---------------------------------------------------------------
  if (!hasRegulator) {
    // Skeleton hands from the centre
    drawHand(ctx, cx, cy, minAng, R * 0.52, R * 0.012, C.hand);
    drawHand(ctx, cx, cy, hourAng, R * 0.34, R * 0.016, C.hand);
    const secLen = R * 0.58;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(secAng);
    ctx.fillStyle = C.accent;
    ctx.fillRect(-1, -secLen, 2, secLen);
    ctx.beginPath(); ctx.arc(0, secLen * 0.86, R * 0.016, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (geno.complications.gmt && !hasRegulator) {
    drawHand(ctx, cx, cy, gmtAng, R * 0.30, R * 0.010, C.accent);
  }
  // Centre cap
  ctx.fillStyle = C.brassDark;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ruby;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.015, 0, Math.PI * 2); ctx.fill();

  // --- Branding -------------------------------------------------------------
  ctx.save();
  ctx.fillStyle = C.dim;
  ctx.font = `600 ${Math.round(R * 0.045)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('WATCH FORGE', cx, cy - R * 0.78);
  ctx.fillStyle = C.white;
  ctx.font = `italic ${Math.round(R * 0.075)}px Georgia, serif`;
  ctx.fillText(pheno.name, cx, cy + R * 0.80);
  ctx.fillStyle = C.dim;
  ctx.font = `${Math.round(R * 0.04)}px ui-monospace, monospace`;
  ctx.fillText(`${geno.diameter}mm · ${pheno.thickness.toFixed(1)}mm · ${pheno.componentCount} parts`,
    cx, cy + R * 0.885);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Side profile (thickness breakdown)
// ---------------------------------------------------------------------------

function drawSideProfile(ctx, w, h, pheno) {
  const geno = pheno.geno;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.backdrop;
  ctx.fillRect(0, 0, w, h);

  // Build the layer stack: [name, thickness, color]
  const layers = [
    ['Case back', 0.45, '#3c4148'],
    ['Main plate', 0.35, '#2e363f'],
    ['Barrel stack', geno.barrels * BARREL.thick, '#8a6d32'],
    ['Gear train', geno.trainWheels * 0.12, '#b08a3c'],
    ['Escapement', D.ESCAPEMENTS[geno.escapement].thick, '#9aa3ad'],
    ['Balance + spring', D.BALANCES[geno.balance].thick + D.HAIRSPRINGS[geno.hairspring].thick, '#cfd6de'],
  ];
  for (const comp of pheno.compList) layers.push([comp.name, comp.thick, '#a04b5f']);
  layers.push(['Dial + case', 0.55, '#565d66']);

  const total = layers.reduce((s, l) => s + l[1], 0);
  const pxPerMm = (h - 40) / Math.max(5.5, total);
  let x = 30;
  ctx.font = '10px ui-monospace, monospace';

  for (const [name, mm, color] of layers) {
    const wPx = Math.max(3, mm * pxPerMm);
    ctx.fillStyle = color;
    ctx.fillRect(x, 18, wPx, 34);
    ctx.fillStyle = '#00000066';
    ctx.fillRect(x, 18, wPx, 3);
    ctx.fillStyle = C.white;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const label = `${name} ${mm.toFixed(2)}`;
    ctx.fillText(label, x, 58);
    x += wPx;
  }

  // Total thickness callout
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillStyle = C.accent;
  ctx.fillText(`total ${pheno.thickness.toFixed(1)} mm`, w - 12, 4);
  ctx.fillStyle = C.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('thickness by layer', w - 12, 20);
}

// ---------------------------------------------------------------------------
// Fitness chart
// ---------------------------------------------------------------------------

function drawFitnessChart(ctx, w, h, best, avg, maxGen) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.backdrop;
  ctx.fillRect(0, 0, w, h);

  const padL = 46, padB = 42, padT = 10, padR = 10;
  const iw = w - padL - padR, ih = h - padT - padB;
  const n = best.length;
  if (n < 2) {
    ctx.fillStyle = C.dim;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('running…', w / 2, h / 2);
    return;
  }
  const yMax = Math.max(1, ...best.slice(0, n)) * 1.08;
  const yMin = Math.min(0, ...avg.slice(0, n));
  const span = Math.max(1, yMax - yMin);

  const X = (i) => padL + (i / (n - 1)) * iw;
  const Y = (v) => padT + ih - ((v - yMin) / span) * ih;

  // Grid
  ctx.strokeStyle = '#2a3038';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = padT + (ih / 4) * g;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }
  // Y labels (max = best of all time)
  ctx.fillStyle = C.dim;
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const y = padT + (ih / 4) * g;
    const v = yMax - (span / 4) * g;
    ctx.fillText(Math.round(v), padL - 4, y);
  }

  // Average line
  ctx.strokeStyle = '#55606d';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = X(i), y = Y(avg[i]);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Best line + glow
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = X(i), y = Y(best[i]);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Trail of champions
  ctx.fillStyle = '#ffb27a';
  for (let i = Math.max(0, n - 20); i < n; i++) {
    ctx.beginPath(); ctx.arc(X(i), Y(best[i]), i === n - 1 ? 3.5 : 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // X labels
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const genStep = Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += genStep) {
    ctx.fillText(String(i), X(i), h - padB + 4);
  }
  ctx.fillText('generation', w / 2, h - 20);
}

// Export for the browser (game.js) — render is browser-only.
root.WATCH_RENDER = {
  drawWatchDial, drawSideProfile, drawFitnessChart, LAYOUT, C,
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));
