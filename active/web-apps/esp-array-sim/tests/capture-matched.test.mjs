import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateMatchedCaptures, DEFAULT_SAMPLE_RATE } from '../src/capture.mjs';
import { runScenario } from '../src/scenario.mjs';

test('matched-filter capture estimates TOA near the true direct delay in mild reverb', () => {
  const rng = makeRng(5);
  const room = { width: 8, height: 6 };
  const nodes = randomLayout(4, room, rng);
  const sched = makeEmitSchedule(nodes);
  const obs = simulateMatchedCaptures(nodes, sched, {
    room, wallReflections: true, reflCoef: 0.3, noiseSigma: 0.02,
  });
  const SPEED = 343;
  let maxErrSec = 0;
  for (const o of obs) {
    if (o.emitterId === o.listenerId) continue;
    const trueDelay = o.distanceM / SPEED;
    const estDelay = o.arrivalClockSec - o.emitClockSec;
    maxErrSec = Math.max(maxErrSec, Math.abs(estDelay - trueDelay));
  }
  // With sub-sample parabolic refinement on, a single-mic matched filter on a
  // windowed chirp lands the peak within a few samples (~2 cm) — the realistic
  // behaviour we want surfaced, near the sample-quantization floor.
  assert.ok(maxErrSec < 4 / DEFAULT_SAMPLE_RATE,
    `TOA error ${maxErrSec.toExponential(2)} s (${(maxErrSec * SPEED * 100).toFixed(1)} cm)`);
});

test('matched-filter localization recovers truth in a mild-reverb room', () => {
  const s = runScenario({
    seed: 42, nodeCount: 6, room: { width: 8, height: 6 },
    captureMode: 'matched', reflCoef: 0.3, noiseSigma: 0.02,
  });
  assert.ok(s.alignErrorM < 0.08, `mild-reverb localization too coarse: ${s.alignErrorM.toFixed(3)} m`);
});

test('a hard wall (high reflCoef + tight room) still localizes once echoes are quieter than direct', () => {
  // In a free-ish rectangular room the direct path is both earliest and loudest,
  // so even strong wall reflections (reflCoef 0.9) stay quieter than direct and
  // sub-sample-refined matched filtering keeps localization tight.
  const s = runScenario({
    seed: 3, nodeCount: 5, room: { width: 3.5, height: 3 },
    captureMode: 'matched', reflCoef: 0.9, noiseSigma: 0.1,
  });
  assert.ok(s.alignErrorM < 0.1, `hard-wall localization too coarse: ${s.alignErrorM.toFixed(3)} m`);
});

test('earliest-peak mode keeps mild-reverb matched localization accurate (wiring parity)', () => {
  const s = runScenario({
    seed: 42, nodeCount: 6, room: { width: 8, height: 6 },
    captureMode: 'matched', reflCoef: 0.5, noiseSigma: 0.02, earliestPeak: true,
  });
  assert.ok(s.alignErrorM < 0.12, `earliest-peak matched error ${s.alignErrorM.toFixed(3)} m`);
});

test('an occluder dropping the direct path biases the estimated TOA', () => {
  const rng = makeRng(11);
  const room = { width: 8, height: 6 };
  const nodes = randomLayout(4, room, rng);
  const sched = makeEmitSchedule(nodes);
  // wall an occluder between two specific nodes
  const a = nodes[1].pos, b = nodes[2].pos;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const occluders = [{ minX: mx - 1.2, minY: my - 0.3, maxX: mx + 1.2, maxY: my + 0.3 }];
  const obs = simulateMatchedCaptures(nodes, sched, {
    room, wallReflections: true, reflCoef: 0.6, noiseSigma: 0.02, occluders,
  });
  const blocked = obs.find((o) => o.emitterId === 1 && o.listenerId === 2);
  const trueDelay = blocked.distanceM / 343;
  const estDelay = blocked.arrivalClockSec - blocked.emitClockSec;
  // NLO: the direct was dropped, so the estimator returns an *echo* delay -> larger
  assert.ok(estDelay > trueDelay + 1 / DEFAULT_SAMPLE_RATE,
    `expected echo-biased delay > direct, got est ${estDelay.toExponential(3)} vs true ${trueDelay.toExponential(3)}`);
});