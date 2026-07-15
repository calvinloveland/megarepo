import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAdvisories } from '../src/advisories.mjs';

test('heavy reverb + plain matched TOA is flagged as a known bad regime', () => {
  const adv = assessAdvisories({ captureMode: 'matched', reflCoef: 0.8, earliestPeak: false, robust: 0, nodeCount: 8 });
  const bad = adv.find((a) => a.id === 'matched-hard-reverb-plain');
  assert.ok(bad, 'must flag the known heavy-reverb matched failure mode');
  assert.equal(bad.severity, 'bad');
  assert.match(bad.message, /earliest-peak/i);
  assert.match(bad.message, /robust/i);
});

test('hardened matched reverb case clears the heavy-reverb hard warning', () => {
  const adv = assessAdvisories({ captureMode: 'matched', reflCoef: 0.8, earliestPeak: true, robust: 5e-5, nodeCount: 8 });
  assert.equal(adv.some((a) => a.id.startsWith('matched-hard-reverb')), false);
});

test('distributed high packet loss escalates from warn to bad', () => {
  const warn = assessAdvisories({ captureMode: 'distributed', meshLoss: 0.3, nodeCount: 8 });
  assert.equal(warn.find((a) => a.id === 'distributed-high-loss')?.severity, 'warn');
  const bad = assessAdvisories({ captureMode: 'distributed', meshLoss: 0.6, nodeCount: 8 });
  assert.equal(bad.find((a) => a.id === 'distributed-very-high-loss')?.severity, 'bad');
});

test('few-node regimes are called out', () => {
  assert.equal(assessAdvisories({ nodeCount: 4 }).find((a) => a.id === 'few-nodes-minimal-geometry')?.severity, 'warn');
  assert.equal(assessAdvisories({ nodeCount: 5 }).find((a) => a.id === 'few-nodes-borderline')?.severity, 'info');
});

test('matched mode with reverb suggests multi-shot averaging when still single-shot', () => {
  const adv = assessAdvisories({ captureMode: 'matched', reflCoef: 0.5, avgShots: 1, nodeCount: 6 });
  const info = adv.find((a) => a.id === 'single-shot-jitter');
  assert.ok(info);
  assert.equal(info.severity, 'info');
});

test('benign closed-form case can return no advisories', () => {
  assert.deepEqual(assessAdvisories({ captureMode: 'closed', nodeCount: 6, reflCoef: 0.2 }), []);
});