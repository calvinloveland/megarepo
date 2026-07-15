import test from 'node:test';
import assert from 'node:assert/strict';
import { linearChirp, matchedFilter, estimateTOA, placeTemplate } from '../src/dsp.mjs';

const SR = 48000;
const TPL = linearChirp({ durationSec: 0.005, f0Hz: 2000, f1Hz: 8000, sampleRateHz: SR });

test('chirp length matches duration × sample rate', () => {
  assert.equal(TPL.length, 0.005 * SR);
});

test('matched filter of a delayed chirp recovers the delay', () => {
  const lag = 137; // samples
  const signal = new Float64Array(TPL.length + lag + 16);
  placeTemplate(signal, TPL, lag, 1);
  const est = estimateTOA(signal, TPL, SR);
  assert.equal(est.lagSamples, lag);
  const approx = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
  approx(est.timeSec, lag / SR, 1 / SR);
});

test('a quieter, later echo does not hijack the estimated TOA', () => {
  const lag = 137;
  const echoLag = 320;
  const signal = new Float64Array(Math.max(lag, echoLag) + TPL.length + 8);
  placeTemplate(signal, TPL, lag, 1.0);     // direct
  placeTemplate(signal, TPL, echoLag, 0.4); // quieter echo
  const est = estimateTOA(signal, TPL, SR);
  assert.equal(est.lagSamples, lag, 'direct peak should dominate the quieter echo');
});

test('a louder echo than the direct biases the estimator (documented limitation)', () => {
  const lag = 137;
  const echoLag = 320;
  const signal = new Float64Array(Math.max(lag, echoLag) + TPL.length + 8);
  placeTemplate(signal, TPL, lag, 0.4);    // weak direct
  placeTemplate(signal, TPL, echoLag, 1.0); // loud echo
  const est = estimateTOA(signal, TPL, SR);
  // argmax picks the loudest peak, which here is the echo — the real failure mode
  // the firmware must guard against (earliest-peak detection / NLO echo rejection).
  assert.equal(est.lagSamples, echoLag);
});

test('TOA estimate is robust to broadband noise', () => {
  const lag = 200;
  const signal = new Float64Array(TPL.length + lag + 24);
  placeTemplate(signal, TPL, lag, 1);
  // add modest gaussian-ish noise
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < signal.length; i++) signal[i] += (rng() * 2 - 1) * 0.15;
  const est = estimateTOA(signal, TPL, SR);
  assert.ok(Math.abs(est.lagSamples - lag) <= 2, `noisy TOA drifted to ${est.lagSamples}`);
});