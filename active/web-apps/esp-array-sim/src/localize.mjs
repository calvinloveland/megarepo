// Acoustic self-localization.
//
// Inverts the capture model (see capture.mjs) by jointly estimating every
// node's 2D position *and* its residual clock offset from the shared-clock
// arrival times observed across the calibration sweep.
//
// The problem is non-linear (arrival depends on sqrt of squared coordinate
// differences), so we solve it with Levenberg–Marquardt (damped Gauss–Newton)
// using a numerical Jacobian. Pure TDOA from acoustics gives exact relative
// geometry up to a global translation + rotation + mirror — the speed of sound
// fixes the scale. We pick a gauge (N0 at the origin, N1 on the +x axis) to make
// the normal equations non-singular, then Procrustes-align the solved layout to
// the true layout for evaluation/display (translation + rotation only).

import { distance, propagationDelay, SPEED_OF_SOUND } from './acoustics.mjs';

/** Intra-device self path used by the predicted-arrival model too. */
const SELF_PATH = 0.02;

/**
 * Flatten the free parameter vector:
 *   [x1, x2, y2, ..., x_{n-1}, y_{n-1}, off1..off_{n-1}, skew1..skew_{n-1}]
 * where N0 is anchored at (0,0), N1 is on the +x axis (y1 = 0), off0 = skew0 = 0
 * as the clock reference. The skew block is present only when `withSkew`.
 */
export function packParams(pos, off, skew = null) {
  const n = pos.length;
  const p = [pos[1].x]; // gauge: N1 on x-axis
  for (let i = 2; i < n; i++) p.push(pos[i].x, pos[i].y);
  for (let i = 1; i < n; i++) p.push(off[i]);
  if (skew) for (let i = 1; i < n; i++) p.push(skew[i]);
  return p;
}

/** Inverse of packParams — rebuild full pos[]/off[]/skew[] from the free vector. */
export function unpackParams(p, n, withSkew = false) {
  const pos = new Array(n);
  const off = new Array(n).fill(0);
  const skew = new Array(n).fill(0);
  pos[0] = { x: 0, y: 0 };
  pos[1] = { x: p[0], y: 0 };
  let k = 1;
  for (let i = 2; i < n; i++) pos[i] = { x: p[k++], y: p[k++] };
  for (let i = 1; i < n; i++) off[i] = p[k++];
  if (withSkew) for (let i = 1; i < n; i++) skew[i] = p[k++];
  return { pos, off, skew };
}

/** Number of free parameters for n nodes. */
export function freeDim(n, withSkew = false) {
  return 2 * n - 3 + (n - 1) + (withSkew ? n - 1 : 0); // positions(offset+gauge) + offsets + skew
}

/** Predicted arrival on the listener's clock: offset_i + (1+skew_i)·(emit + d/c). */
export function predictedArrival(pos, off, skew, obs, c = SPEED_OF_SOUND) {
  const d =
    obs.emitterId === obs.listenerId
      ? SELF_PATH
      : distance(pos[obs.emitterId], pos[obs.listenerId]);
  const base = obs.emitClockSec + propagationDelay(d, c);
  return off[obs.listenerId] + (1 + (skew[obs.listenerId] ?? 0)) * base;
}

/** Residual vector r(p) = predicted − measured, one entry per observation. */
export function residuals(p, observations, n, c = SPEED_OF_SOUND, withSkew = false) {
  const { pos, off, skew } = unpackParams(p, n, withSkew);
  return observations.map((o) => predictedArrival(pos, off, skew, o, c) - o.arrivalClockSec);
}

/** Sum-of-squares cost. */
export function cost(p, observations, n, c = SPEED_OF_SOUND, withSkew = false) {
  const r = residuals(p, observations, n, c, withSkew);
  let s = 0;
  for (const v of r) s += v * v;
  return s;
}

/** Huber robust cost: Σ ρ(r) where ρ(r)=r² for |r|≤δ else δ(2|r|−δ). */
export function robustCost(p, observations, n, delta, c = SPEED_OF_SOUND, withSkew = false) {
  const r = residuals(p, observations, n, c, withSkew);
  let s = 0;
  for (const v of r) {
    const a = Math.abs(v);
    s += a <= delta ? v * v : delta * (2 * a - delta);
  }
  return s;
}

/** Huber IRLS weight: 1 inside δ, δ/|r| outside. */
function huberWeight(r, delta) {
  const a = Math.abs(r);
  return a <= delta ? 1 : delta / (a || 1e-12);
}

/** Numerical Jacobian (central differences). Reference + fallback for the analytic version. */
export function numericalJacobian(p, observations, n, c = SPEED_OF_SOUND, withSkew = false) {
  const m = observations.length;
  const cols = p.length;
  const J = Array.from({ length: m }, () => new Array(cols).fill(0));
  const eps = 1e-8;
  for (let j = 0; j < cols; j++) {
    const pp = p.slice();
    pp[j] += eps;
    const rp = residuals(pp, observations, n, c, withSkew);
    pp[j] = p[j] - eps;
    const rm = residuals(pp, observations, n, c, withSkew);
    for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * eps);
  }
  return J;
}

/* Free-parameter index helpers for the packed gauge vector:
 *   [x1, (x2,y2), (x3,y3), …, off1, off2, …]
 * N0 is fixed at the origin; N1 is fixed on the +x axis (y1 = 0).
 */
function freeXIndex(node) {
  if (node === 0) return -1;
  if (node === 1) return 0;
  return 1 + 2 * (node - 2);
}
function freeYIndex(node) {
  if (node === 0 || node === 1) return -1;
  return 1 + 2 * (node - 2) + 1;
}
function freeOffIndex(node, n) {
  if (node === 0) return -1;
  return 1 + 2 * (n - 2) + (node - 1);
}
/** Index of the free skew param for `node` (-1 when absent or the reference node 0). */
function freeSkewIndex(node, n, withSkew) {
  if (!withSkew || node === 0) return -1;
  return 1 + 2 * (n - 2) + (n - 1) + (node - 1);
}

/**
 * Analytic Jacobian of the residual vector w.r.t. the free parameters.
 * One residual per observation; each row is non-zero only in the free coords of
 * the emitter and listener (plus that listener's offset). ~single-eval cost
 * instead of 2·cols residual sweeps like the numerical version.
 */
export function analyticJacobian(p, observations, n, c = SPEED_OF_SOUND, withSkew = false) {
  const { pos, off, skew } = unpackParams(p, n, withSkew);
  const m = observations.length;
  const cols = p.length;
  const J = Array.from({ length: m }, () => new Array(cols).fill(0));
  for (let i = 0; i < m; i++) {
    const o = observations[i];
    const row = new Array(cols).fill(0);
    const s = pos[o.emitterId];
    const li = pos[o.listenerId];
    const liSkew = skew[o.listenerId] ?? 0;
    const self = o.emitterId === o.listenerId;
    const d = self ? SELF_PATH : distance(s, li);
    const base = o.emitClockSec + propagationDelay(d, c); // emit + d/c on true/shared clock
    const rate = 1 + liSkew;
    // ∂(residual)/∂(off_listener) = 1
    const oi = freeOffIndex(o.listenerId, n);
    if (oi >= 0) row[oi] = 1;
    // ∂(residual)/∂(skew_listener) = base (rate multiplies base; skew derivative = base)
    const si = freeSkewIndex(o.listenerId, n, withSkew);
    if (si >= 0) row[si] = base;
    if (!self) {
      const dx = s.x - li.x, dy = s.y - li.y;
      const dist = Math.hypot(dx, dy) || 1e-9;
      // ∂base/∂p_s = +unit/c, ∂base/∂p_i = -unit/c; the upward ((1+skew)) scales it
      for (const [pt, sign] of [
        [o.emitterId, +1],
        [o.listenerId, -1],
      ]) {
        const sx = freeXIndex(pt);
        const sy = freeYIndex(pt);
        if (sx >= 0) row[sx] += sign * rate * (dx / dist) / c;
        if (sy >= 0) row[sy] += sign * rate * (dy / dist) / c;
      }
    } // self-arrival: fixed SELF_PATH => no position partials
    J[i] = row;
  }
  return J;
}

/** Solve a small linear system A x = b via Gauss–Jordan elimination with pivoting. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-18) throw new Error('singular');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/**
 * Levenberg–Marquardt driver: minimizes Σ residual².
 *
 * @param {number[]} p0              initial free vector
 * @param {object[]} observations
 * @param {number} n                 node count
 * @param {object} [opts]
 * @returns {{pos:{x:number,y:number}[], off:number[], iterations:number, costs:number[], converged:boolean}}
 */
export function localize(p0, observations, n, opts = {}) {
  const c = opts.speedOfSound ?? SPEED_OF_SOUND;
  const maxIters = opts.maxIters ?? 100;
  const lambda0 = opts.lambda ?? 1e-3;
  const tol = opts.tol ?? 1e-14;
  const withSkew = opts.withSkew ?? false;
  const robust = opts.robust ?? 0; // Huber delta; 0 = ordinary least squares
  let lambda = lambda0;
  let cur = p0.slice();
  // Per-observation IRLS weights, refreshed each iteration when robust>0.
  let weights = new Array(observations.length).fill(1);
  const evalCost = (p) => robust > 0
    ? robustCost(p, observations, n, robust, c, withSkew)
    : cost(p, observations, n, c, withSkew);
  let curCost = evalCost(cur);
  const costs = [curCost];
  let converged = false;
  for (let iter = 0; iter < maxIters; iter++) {
    const J = opts.analytic === false
      ? numericalJacobian(cur, observations, n, c, withSkew)
      : analyticJacobian(cur, observations, n, c, withSkew);
    const m = observations.length;
    const cols = cur.length;
    const JtJ = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const Jtr = new Array(cols).fill(0);
    const r = residuals(cur, observations, n, c, withSkew);
    if (robust > 0) {
      for (let i = 0; i < m; i++) weights[i] = huberWeight(r[i], robust);
    }
    for (let i = 0; i < m; i++) {
      const w = weights[i] || 0;
      for (let a = 0; a < cols; a++) {
        Jtr[a] += w * J[i][a] * r[i];
        for (let b = 0; b < cols; b++) JtJ[a][b] += w * J[i][a] * J[i][b];
      }
    }
    // LM step: (JᵀJ + λ diag) Δ = −Jᵀr
    const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda : v)));
    const rhs = Jtr.map((v) => -v);
    let delta;
    try {
      delta = solveLinear(A, rhs);
    } catch {
      lambda = Math.min(lambda * 5, 1e12);
      continue;
    }
    const trial = cur.map((v, i) => v + delta[i]);
    const trialCost = evalCost(trial);
    if (trialCost < curCost) {
      cur = trial;
      const rel = (curCost - trialCost) / (curCost + 1e-18);
      curCost = trialCost;
      costs.push(curCost);
      lambda = Math.max(lambda * 0.3, 1e-14);
      if (rel < tol) {
        converged = true;
        break;
      }
    } else {
      lambda = Math.min(lambda * 5, 1e12);
      if (lambda > 1e11) break; // unable to descend
    }
  }
  const { pos, off, skew } = unpackParams(cur, n, withSkew);
  return { pos, off, skew, iterations: costs.length - 1, costs, converged, weights };
}

/**
 * Random initial guess: scatter nodes uniformly in the room then apply the
 * gauge (N0 at origin, N1 on +x). Good for multistart restarts.
 */
export function randomGuess(n, room, rng, withSkew = false) {
  const pos = new Array(n);
  for (let i = 0; i < n; i++)
    pos[i] = { x: rng() * room.width, y: rng() * room.height };
  pos[0] = { x: 0, y: 0 };
  pos[1] = { x: pos[1].x || 0.1, y: 0 };
  const off = new Array(n).fill(0);
  const skew = withSkew ? new Array(n).fill(0) : null;
  return packParams(pos, off, skew);
}

/**
 * Multi-start LM: run from the grid init plus a few random restarts and keep
 * the lowest-cost solution. Avoids local minima for sparse/random layouts.
 *
 * @returns {ReturnType<typeof localize> & {starts:number}}
 */
export function localizeBest(observations, n, room, opts = {}) {
  const starts = opts.starts ?? 6;
  const seedRng = opts.seedRng ?? (() => Math.random());
  let best = localize(initialGuess(n, room, opts), observations, n, opts);
  for (let k = 1; k < starts; k++) {
    const cand = localize(randomGuess(n, room, seedRng, opts.withSkew), observations, n, opts);
    if (cand.costs.at(-1) < best.costs.at(-1)) best = cand;
  }
  return { ...best, starts };
}

/**
 * Initial guess: spread nodes along a coarse grid ignoring the true layout.
 * Good enough to fall inside the LM basin for small rooms.
 */
export function initialGuess(n, room, opts = {}) {
  const withSkew = opts.withSkew ?? false;
  const pos = new Array(n);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const dx = room.width / (cols + 1);
  const dy = room.height / (rows + 1);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const ci = i % cols;
    pos[i] = { x: dx * (ci + 1), y: dy * (r + 1) };
  }
  pos[0] = { x: 0, y: 0 };
  pos[1] = { x: pos[1].x || dx, y: 0 };
  const off = new Array(n).fill(0);
  const skew = withSkew ? new Array(n).fill(0) : null;
  return packParams(pos, off, skew);
}

/**
 * 2D Procrustes alignment (translation + rotation, no scaling) mapping `solved`
 * onto `target` with least squared error. Removes the unobservable rigid motion
 * so the solved layout can be compared with truth and drawn over it.
 *
 * @param {{x:number,y:number}[]} solved
 * @param {{x:number,y:number}[]} target
 * @returns {{aligned:{x:number,y:number}[], R:number[][], t:{x:number,y:number}, errorM:number}}
 */
export function procrustesAlign(solved, target) {
  const n = solved.length;
  if (n < 2) {
    return { aligned: solved.map((p) => ({ ...p })), R: [[1, 0], [0, 1]], t: { x: 0, y: 0 }, errorM: 0 };
  }
  const muP = mean(solved);
  const muT = mean(target);
  // Closed-form 2D Procrustes rotation. Maximize Σ y·(Rθ x) over θ, where
  // x = solved-centered, y = target-centered. Expanding for Rθ=[[c,-s],[s,c]]:
  //   Σ y·(Rθ x) = cosθ·A + sinθ·B,
  //   A = Σ(x₁y₁ + x₂y₂) , B = Σ(x₁y₂ − x₂y₁)  →  θ = atan2(B, A)
  let a = 0, b = 0, cc = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const x = solved[i].x - muP.x;
    const y = solved[i].y - muP.y;
    const u = target[i].x - muT.x;
    const v = target[i].y - muT.y;
    a += x * u; // Σ x₁y₁
    b += x * v; // Σ x₁y₂
    cc += y * u; // Σ x₂y₁
    d += y * v; // Σ x₂y₂
  }
  const A = a + d;
  const B = b - cc;
  const theta = Math.atan2(B, A);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const R = [[cos, -sin], [sin, cos]];
  const t = {
    x: muT.x - (R[0][0] * muP.x + R[0][1] * muP.y),
    y: muT.y - (R[1][0] * muP.x + R[1][1] * muP.y),
  };
  const aligned = solved.map((p) => ({
    x: R[0][0] * p.x + R[0][1] * p.y + t.x,
    y: R[1][0] * p.x + R[1][1] * p.y + t.y,
  }));
  let err = 0;
  for (let i = 0; i < n; i++)
    err += (aligned[i].x - target[i].x) ** 2 + (aligned[i].y - target[i].y) ** 2;
  return { aligned, R, t, errorM: Math.sqrt(err / n) };
}

function mean(pts) {
  let x = 0, y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}