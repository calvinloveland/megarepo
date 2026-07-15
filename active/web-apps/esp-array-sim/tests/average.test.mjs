import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/scenario.mjs';
import { averagedCaptures } from '../src/capture.mjs';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';

test('single-shot averaging (avgShots=1) reproduces the single-shot path', () => {
  const single = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  const avg1 = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, avgShots: 1 });
  assert.equal(avg1.alignErrorM, single.alignErrorM);
});

test('median-of-shots averaging reduces localization error under high noise (matched)', () => {
  // average across a few seeds for stability
  let singleErr = 0, medErr = 0;
  for (let s = 50; s < 55; s++) {
    singleErr += runScenario({ seed: s, nodeCount: 6, room: { width: 8, height: 6 }, captureMode: 'matched', reflCoef: 0.3, noiseSigma: 0.5 }).alignErrorM;
    medErr += runScenario({ seed: s, nodeCount: 6, room: { width: 8, height: 6 }, captureMode: 'matched', reflCoef: 0.3, noiseSigma: 0.5, avgShots: 3 }).alignErrorM;
  }
  singleErr /= 5; medErr /= 5;
  assert.ok(medErr < singleErr, `median-of-3 (${(medErr*100).toFixed(2)}cm) should beat single-shot (${(singleErr*100).toFixed(2)}cm) under high noise`);
});

test('averagedCaptures returns one observation per (emitter, listener) with per-shot times', () => {
  const rng = makeRng(3);
  const room = { width: 7, height: 5 };
  const nodes = randomLayout(5, room, rng);
  const obs = averagedCaptures(nodes, room, { shots: 4, captureMode: 'closed' });
  assert.equal(obs.length, 5 * 5);
  for (const o of obs) {
    assert.ok(Array.isArray(o.shots) && o.shots.length === 4, 'every observation carries 4 shot times');
  }
});

test('more shots never increases error on average (diminishing returns is monotonic-ish)', () => {
  // spot check that the median is stable/getting better with more shots
  const cfg = (shots) => runScenario({
    seed: 80, nodeCount: 5, room: { width: 6, height: 5 }, avgShots: shots,
  });
  const e1 = cfg(1).alignErrorM;
  const e9 = cfg(9).alignErrorM;
  // closed path jitter is small; averaging shots drops the floor
  assert.ok(e9 <= e1 + 1e-9, `9-shot (${(e9*100).toFixed(2)}cm) should be <= 1-shot (${(e1*100).toFixed(2)}cm) on the closed path`);
});