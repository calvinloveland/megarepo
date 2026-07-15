import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateCaptures } from '../src/capture.mjs';
import { localizeBest, initialGuess, cost } from '../src/localize.mjs';
import { procrustesAlign } from '../src/localize.mjs';

// Inject gross TOA outliers (the NLOS-echo-hijacked-estimator failure mode) and
// show plain OLS LM is wrecked while Huber-robust LM recovers the true geometry.

function buildScenarioSeed(seed, n, room) {
  const rng = makeRng(seed);
  const nodes = randomLayout(n, room, rng);
  const obs = simulateCaptures(nodes, makeEmitSchedule(nodes));
  return { nodes, obs, rng };
}

function alignError(sol, nodes) {
  const truth = nodes.map((nd) => ({ x: nd.pos.x, y: nd.pos.y }));
  const a1 = procrustesAlign(sol.pos, truth);
  const a2 = procrustesAlign(sol.pos.map((p) => ({ x: p.x, y: -p.y })), truth);
  return Math.min(a1.errorM, a2.errorM);
}

test('without outliers, OLS and robust LM agree (robust is a no-op)', () => {
  const { nodes, obs, rng } = buildScenarioSeed(42, 6, { width: 6, height: 5 });
  const room = { width: 6, height: 5 };
  const ols = localizeBest(obs, 6, room, { starts: 4, seedRng: rng });
  const { nodes: n2, obs: o2, rng: r2 } = buildScenarioSeed(42, 6, room);
  void n2; void o2;
  const rob = localizeBest(obs, 6, room, { starts: 4, seedRng: makeRng(42), robust: 1e-4 });
  assert.ok(alignError(ols, nodes) < 0.05);
  assert.ok(alignError(rob, nodes) < 0.05);
});

// Gross, random-signed TOA outliers (a loud NLOS echo hijacks the estimator in
// the + or − direction) — the realistic failure mode robust LM must survive.
function corrupt(obs, frac, jumpSec, seed) {
  const rng = makeRng(seed);
  return obs.map((o) => {
    const s = rng() < frac ? (rng() < 0.5 ? 1 : -1) : 0;
    return { ...o, arrivalClockSec: o.arrivalClockSec + s * jumpSec };
  });
}
const OUTLIER_FRAC = 0.15;
const OUTLIER_JUMP = 2e-3;   // 2 ms ≈ 68 cm equiv — far beyond any jitter
const HUBER_DELTA = 5e-5;    // ~2.5× the 20 µs mic jitter → inliers keep weight 1

test('gross TOA outliers degrade OLS LM and Huber-robust LM beats it', () => {
  const { nodes, obs } = buildScenarioSeed(42, 6, { width: 6, height: 5 });
  const room = { width: 6, height: 5 };
  const corrupted = corrupt(obs, OUTLIER_FRAC, OUTLIER_JUMP, 1);
  const ols = localizeBest(corrupted, 6, room, { starts: 6, seedRng: makeRng(3) });
  const rob = localizeBest(corrupted, 6, room, { starts: 6, seedRng: makeRng(3), robust: HUBER_DELTA });
  const olsErr = alignError(ols, nodes);
  const robErr = alignError(rob, nodes);
  assert.ok(olsErr > 0.10, `OLS should be degraded by outliers, got ${olsErr.toFixed(3)} m`);
  assert.ok(robErr < olsErr - 0.05,
    `robust (${robErr.toFixed(3)} m) should beat OLS (${olsErr.toFixed(3)} m) by a clear margin`);
  assert.ok(robErr < 0.05, `robust should recover geometry, got ${robErr.toFixed(3)} m`);
});

test('Huber-robust LM recovers the geometry despite gross outliers', () => {
  const { nodes, obs } = buildScenarioSeed(42, 6, { width: 6, height: 5 });
  const room = { width: 6, height: 5 };
  const corrupted = corrupt(obs, OUTLIER_FRAC, OUTLIER_JUMP, 1);
  const sol = localizeBest(corrupted, 6, room, { starts: 6, seedRng: makeRng(3), robust: HUBER_DELTA });
  const err = alignError(sol, nodes);
  assert.ok(err < 0.05, `robust LM should recover geometry, got ${err.toFixed(3)} m`);
});

test('robust weights down-weight the corrupted observations', () => {
  const { nodes, obs } = buildScenarioSeed(42, 6, { width: 6, height: 5 });
  const room = { width: 6, height: 5 };
  const rng = makeRng(1);
  const corruptedIdx = new Set();
  const corrupted = obs.map((o, i) => {
    if (rng() < OUTLIER_FRAC) {
      corruptedIdx.add(i);
      return { ...o, arrivalClockSec: o.arrivalClockSec + (rng() < 0.5 ? 1 : -1) * OUTLIER_JUMP };
    }
    return o;
  });
  const sol = localizeBest(corrupted, 6, room, { starts: 6, seedRng: makeRng(3), robust: HUBER_DELTA });
  const w = sol.weights;
  assert.ok(w && w.length === corrupted.length);
  let outlierMin = Infinity, inlierMax = -Infinity;
  for (let i = 0; i < corrupted.length; i++) {
    if (corruptedIdx.has(i)) outlierMin = Math.min(outlierMin, w[i]);
    else inlierMax = Math.max(inlierMax, w[i]);
  }
  assert.ok(outlierMin < inlierMax,
    `outlier weights (${outlierMin.toFixed(3)}) should be below inlier weights (${inlierMax.toFixed(3)})`);
});