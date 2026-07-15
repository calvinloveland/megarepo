import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/scenario.mjs';
import { analyticJacobian, numericalJacobian, freeDim } from '../src/localize.mjs';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateCaptures } from '../src/capture.mjs';

function rms(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

test('freeDim grows by (n-1) when skew is estimated', () => {
  assert.equal(freeDim(6), 14);            // positions(2n-3=9) + offsets(n-1=5) = 14
  assert.equal(freeDim(6, true), 19);       // + skew(n-1=5) = 19
});

test('analytic Jacobian matches numerical when estimating skew', () => {
  const rng = makeRng(2024);
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(6, room, rng, undefined, undefined, { skewMaxPpm: 50 });
  const obs = simulateCaptures(nodes, makeEmitSchedule(nodes));
  const n = 6;
  const cols = freeDim(n, true);
  // seed a plausible packed free vector (incl. skew block)
  const p = new Array(cols);
  for (let i = 0; i < cols; i++) p[i] = (i % 2 ? 0.6 : -0.3) + 0.07 * i;
  const Ja = analyticJacobian(p, obs, n, undefined, true);
  const Jn = numericalJacobian(p, obs, n, undefined, true);
  let max = 0;
  for (let i = 0; i < Ja.length; i++)
    for (let j = 0; j < Ja[0].length; j++) max = Math.max(max, Math.abs(Ja[i][j] - Jn[i][j]));
  assert.ok(max < 1e-4, `skew Jacobian mismatch ${max.toExponential(3)}`);
});

test('skewed clocks still localize when skew is jointly estimated', () => {
  const s = runScenario({ seed: 77, nodeCount: 6, room: { width: 6, height: 5 }, clockSkew: true });
  assert.ok(s.withSkew, 'scenario should report withSkew=true');
  assert.ok(s.alignErrorM < 0.10, `skew-aware localization too coarse: ${s.alignErrorM.toFixed(3)} m`);
  // recovered skews within ~25 ppm of truth (N0 skew=0 reference). Observability
  // is weak over the short ~1.8s default schedule, so the bar is loose.
  const skewRms = rms(s.clockSkewsTrue, s.clockSkewsEst);
  assert.ok(skewRms < 25e-6, `skew RMS ${skewRms.toExponential(2)} (want < 25 ppm)`);
});

test('ignoring skew (no estimation) degrades localized geometry', () => {
  // Exaggerated skew (1000 ppm) to make the short-schedule effect unmistakable;
  // real crystals are ~50 ppm but the default sweep is only ~1.8s.
  const cfg = { seed: 77, nodeCount: 6, room: { width: 6, height: 5 }, clockSkew: true, skewMaxPpm: 1000 };
  const estimated = runScenario({ ...cfg });
  const ignored = runScenario({ ...cfg, estimateSkew: false });
  assert.ok(estimated.withSkew && !ignored.withSkew, 'run flags');
  assert.ok(
    ignored.alignErrorM > estimated.alignErrorM + 0.02,
    `ignoring skew should be noticeably worse: est ${estimated.alignErrorM.toFixed(3)} vs ignored ${ignored.alignErrorM.toFixed(3)}`,
  );
});