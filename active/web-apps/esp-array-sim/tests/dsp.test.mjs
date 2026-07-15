import test from 'node:test';
import assert from 'node:assert/strict';
import { linearChirp, matchedFilter, estimateTOA, placeTemplate } from '../src/dsp.mjs';

const SR = 48000;
const TPL = linearChirp({ durationSec: 0.005, f0Hz: 2000, f1Hz: 8000, sampleRateHz: SR });
const approxLag = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b} (±${eps})`);

test('chirp length matches duration × sample rate', () => {
  assert.equal(TPL.length, 0.005 * SR);
});

test('matched filter of a delayed chirp recovers the delay', () => {
  const lag = 137; // samples
  const signal = new Float64Array(TPL.length + lag + 16);
  placeTemplate(signal, TPL, lag, 1);
  const est = estimateTOA(signal, TPL, SR);
  approxLag(est.lagSamples, lag);
  assert.ok(Math.abs(est.timeSec - lag / SR) < 1 / SR);
});

test('sub-sample parabolic refinement recovers a fractional lag', () => {
  const lag = 137.3;
  const signal = new Float64Array(TPL.length + Math.ceil(lag) + 16);
  placeTemplate(signal, TPL, lag, 1);
  const est = estimateTOA(signal, TPL, SR); // refine defaults on
  assert.ok(Math.abs(est.lagSamples - lag) < 0.15,
    `expected sub-sample recovery, got ${est.lagSamples} vs ${lag}`);
  // and disabling refine snaps back to the integer sample (large error)
  const raw = estimateTOA(signal, TPL, SR, { refine: false });
  assert.equal(raw.lagSamples, Math.round(lag));
});

test('a quieter, later echo does not hijack the estimated TOA', () => {
  const lag = 137;
  const echoLag = 320;
  const signal = new Float64Array(Math.max(lag, echoLag) + TPL.length + 8);
  placeTemplate(signal, TPL, lag, 1.0);     // direct
  placeTemplate(signal, TPL, echoLag, 0.4); // quieter echo
  const est = estimateTOA(signal, TPL, SR);
  approxLag(est.lagSamples, lag, 0.5);
  assert.ok(Math.abs(est.lagSamples - lag) < 0.5, 'direct peak should dominate the quieter echo');
});

test('a louder echo than the direct biases the strongest-peak estimator (documented limitation)', () => {
  const lag = 137;
  const echoLag = 320;
  const signal = new Float64Array(Math.max(lag, echoLag) + TPL.length + 8);
  placeTemplate(signal, TPL, lag, 0.4);    // weak direct
  placeTemplate(signal, TPL, echoLag, 1.0); // loud echo
  const est = estimateTOA(signal, TPL, SR); // default 'strongest'
  // argmax picks the loudest peak, which here is the echo — the failure mode the
  // firmware must guard against (earliest-peak detection / NLO echo rejection).
  approxLag(est.lagSamples, echoLag, 0.5);
});

test('earliest-peak selection rejects a loud later echo when the direct is strong enough', () => {
  const lag = 137;
  // keep direct + echo more than one chirp apart so they are resolvable arrivals
  const echoLag = lag + TPL.length + 80;
  const signal = new Float64Array(echoLag + TPL.length + 8);
  placeTemplate(signal, TPL, lag, 0.6);    // detectable direct
  placeTemplate(signal, TPL, echoLag, 1.0); // loud later echo
  const strongest = estimateTOA(signal, TPL, SR);              // returns the echo
  const earliest = estimateTOA(signal, TPL, SR, { mode: 'earliest', peakThreshold: 0.5 });
  approxLag(strongest.lagSamples, echoLag, 0.5);
  approxLag(earliest.lagSamples, lag, 0.5);
});

test('earliest-peak falls back to strongest when nothing clears the threshold', () => {
  const lag = 100;
  const signal = new Float64Array(TPL.length + lag + 8);
  placeTemplate(signal, TPL, lag, 1);
  const est = estimateTOA(signal, TPL, SR, { mode: 'earliest', peakThreshold: 0.99 });
  approxLag(est.lagSamples, lag, 0.5);
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