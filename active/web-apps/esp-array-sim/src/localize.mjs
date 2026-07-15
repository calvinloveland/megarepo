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
 *   [x1, x2, y2, x3, y3, ..., x_{n-1}, y_{n-1}, off1, off2, ..., off_{n-1}]
 * where N0 is anchored at (0,0) and N1 is on the +x axis (y1 = 0).
 */
export function packParams(pos, off) {
  const n = pos.length;
  const p = [pos[1].x]; // gauge: N1 on x-axis
  for (let i = 2; i < n; i++) p.push(pos[i].x, pos[i].y);
  for (let i = 1; i < n; i++) p.push(off[i]);
  return p;
}

/** Inverse of packParams — rebuild full pos[] and off[] arrays from the free vector. */
export function unpackParams(p, n) {
  const pos = new Array(n);
  const off = new Array(n).fill(0);
  pos[0] = { x: 0, y: 0 };
  pos[1] = { x: p[0], y: 0 };
  let k = 1;
  for (let i = 2; i < n; i++) pos[i] = { x: p[k++], y: p[k++] };
  for (let i = 1; i < n; i++) off[i] = p[k++];
  return { pos, off };
}

/** Number of free parameters for n nodes. */
export function freeDim(n) {
  return 2 * n - 3 + (n - 1); // gauge positions + offsets
}

/** Predicted arrival for one observation given current estimates. */
export function predictedArrival(pos, off, obs, c = SPEED_OF_SOUND) {
  const d =
    obs.emitterId === obs.listenerId
      ? SELF_PATH
      : distance(pos[obs.emitterId], pos[obs.listenerId]);
  return obs.emitClockSec + propagationDelay(d, c) + off[obs.listenerId];
}

/** Residual vector r(p) = predicted − measured, one entry per observation. */
export function residuals(p, observations, n, c = SPEED_OF_SOUND) {
  const { pos, off } = unpackParams(p, n);
  return observations.map((o) => predictedArrival(pos, off, o, c) - o.arrivalClockSec);
}

/** Sum-of-squares cost. */
export function cost(p, observations, n, c = SPEED_OF_SOUND) {
  const r = residuals(p, observations, n, c);
  let s = 0;
  for (const v of r) s += v * v;
  return s;
}

/** Numerical Jacobian (central differences). Fine for small meshes. */
function numericalJacobian(p, observations, n, c) {
  const m = observations.length;
  const cols = p.length;
  const J = Array.from({ length: m }, () => new Array(cols).fill(0));
  const eps = 1e-6;
  for (let j = 0; j < cols; j++) {
    const pp = p.slice();
    pp[j] += eps;
    const rp = residuals(pp, observations, n, c);
    pp[j] = p[j] - eps;
    const rm = residuals(pp, observations, n, c);
    for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * eps);
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
  let lambda = lambda0;
  let cur = p0.slice();
  let curCost = cost(cur, observations, n, c);
  const costs = [curCost];
  let converged = false;
  for (let iter = 0; iter < maxIters; iter++) {
    const J = numericalJacobian(cur, observations, n, c);
    const m = observations.length;
    const cols = cur.length;
    const JtJ = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const Jtr = new Array(cols).fill(0);
    const r = residuals(cur, observations, n, c);
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < cols; a++) {
        Jtr[a] += J[i][a] * r[i];
        for (let b = 0; b < cols; b++) JtJ[a][b] += J[i][a] * J[i][b];
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
    const trialCost = cost(trial, observations, n, c);
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
  const { pos, off } = unpackParams(cur, n);
  return { pos, off, iterations: costs.length - 1, costs, converged };
}

/**
 * Random initial guess: scatter nodes uniformly in the room then apply the
 * gauge (N0 at origin, N1 on +x). Good for multistart restarts.
 */
export function randomGuess(n, room, rng) {
  const pos = new Array(n);
  for (let i = 0; i < n; i++)
    pos[i] = { x: rng() * room.width, y: rng() * room.height };
  pos[0] = { x: 0, y: 0 };
  pos[1] = { x: pos[1].x || 0.1, y: 0 };
  return packParams(pos, new Array(n).fill(0));
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
  let best = localize(initialGuess(n, room), observations, n, opts);
  for (let k = 1; k < starts; k++) {
    const cand = localize(randomGuess(n, room, seedRng), observations, n, opts);
    if (cand.costs.at(-1) < best.costs.at(-1)) best = cand;
  }
  return { ...best, starts };
}

/**
 * Initial guess: spread nodes along a coarse grid ignoring the true layout.
 * Good enough to fall inside the LM basin for small rooms.
 */
export function initialGuess(n, room) {
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
  return packParams(pos, off);
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