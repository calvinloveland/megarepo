import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/scenario.mjs';
import {
  renderChannelAtSweetSpot,
  renderPeakAmplitude,
  renderPeakConcentration,
} from '../src/render.mjs';
import { linearChirp } from '../src/dsp.mjs';

const SR = 48000;
// A short impulse is the cleanest alignment probe: each speaker's copy is a
// single delta, so the rendered signal is a forest of impulses whose timing
// reveals alignment exactly.
const IMPULSE = Float64Array.from({ length: 1 }, () => 1);
// A short windowed tone burst exercises the cross-correlation coherence path.
const TONE = linearChirp({ durationSec: 0.003, f0Hz: 1000, f1Hz: 3000, sampleRateHz: SR });

function replay(scenario, channelId, content, opts) {
  const chMap = scenario.surround.find((c) => c.channel === channelId);
  return renderChannelAtSweetSpot(content, chMap, scenario.compensation, scenario.sweetSpot, SR, opts);
}

test('compensated impulse replay aligns every speaker to one instant', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  const { signal, arrivals } = replay(s, 'C', IMPULSE, { applyCompensation: true });
  // All compensated arrivals must land at the same time (maxDist/c).
  const times = arrivals.map((a) => a.tSec);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 1e-9, `compensated arrivals should align, spread ${spread.toExponential(2)} s`);
  // The rendered signal is effectively one coherent impulse at that instant.
  const peak = renderPeakAmplitude(signal);
  const coherentSum = arrivals.reduce((sum, a) => sum + a.amplitude, 0);
  assert.ok(Math.abs(peak - coherentSum) < 1e-6,
    `compensated peak ${peak} should equal Σ amplitudes ${coherentSum.toExponential(3)}`);
});

test('uncompensated impulse replay spreads arrivals across the distance range', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  const { signal, arrivals } = replay(s, 'C', IMPULSE, { applyCompensation: false });
  // Uncompensated: arrivals differ by (maxDist - minDist)/c.
  const times = arrivals.map((a) => a.tSec);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread > 1e-4, `uncompensated arrivals should spread, got ${spread.toExponential(2)} s`);
  // The right invariant is *concentration*: compensation collapses the copies to
  // one instant (concentration -> 1); without it they smear (concentration < 1).
  const compensated = replay(s, 'C', IMPULSE, { applyCompensation: true });
  const concComp = renderPeakConcentration(compensated.signal);
  const concUncomp = renderPeakConcentration(signal);
  assert.ok(concComp > concUncomp + 0.05,
    `compensated concentration ${concComp.toFixed(3)} should beat uncompensated ${concUncomp.toFixed(3)}`);
  assert.ok(Math.abs(concComp - 1) < 1e-6, `compensated impulse should concentrate to ~1, got ${concComp}`);
});

test('compensated tone burst is more coherent than the uncompensated one', () => {
  const s = runScenario({ seed: 7, nodeCount: 8, room: { width: 7, height: 6 } });
  const comp = replay(s, 'L', TONE, { applyCompensation: true });
  const uncmp = replay(s, 'L', TONE, { applyCompensation: false });
  // Peak concentration (amplitude-invariant sharpness) is the right cross-
  // correlation invariant: compensation collapses copies onto one wavefront.
  const conc = renderPeakConcentration(comp.signal);
  const uconc = renderPeakConcentration(uncmp.signal);
  assert.ok(conc > uconc,
    `compensated concentration ${conc.toFixed(3)} should beat uncompensated ${uconc.toFixed(3)}`);
});

test('a channel lined up with a single speaker still renders a clean copy', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  const { signal } = replay(s, 'C', TONE, { applyCompensation: true });
  assert.ok(renderPeakAmplitude(signal) > 0, 'centre render should not be silent');
  assert.ok(renderPeakConcentration(signal) > 0, 'concentration should be positive');
});

test('render works for every 5.1 channel', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  for (const ch of ['L', 'R', 'C', 'Ls', 'Rs', 'LFE']) {
    const { signal } = replay(s, ch, TONE, { applyCompensation: true });
    assert.ok(signal.length > TONE.length, `${ch} produced too-short signal`);
    assert.ok(renderPeakAmplitude(signal) > 0, `${ch} produced silent render`);
  }
});