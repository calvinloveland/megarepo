import test from 'node:test';
import assert from 'node:assert/strict';
import { scanNoiseSensitivity, formatNoiseScan, summarizeNoiseScan } from '../src/noise-scan.mjs';

test('scanNoiseSensitivity returns one row per requested sigma', () => {
  const rows = scanNoiseSensitivity({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, captureMode: 'matched', reflCoef: 0.3 }, [0, 0.05, 0.2]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.noiseSigma), [0, 0.05, 0.2]);
  for (const r of rows) {
    assert.ok(r.alignErrorM >= 0);
    assert.ok(r.observations > 0);
    assert.ok(r.iterations > 0);
  }
});

test('formatNoiseScan renders a header and one line per row', () => {
  const rows = scanNoiseSensitivity({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, captureMode: 'matched' }, [0, 0.05]);
  const txt = formatNoiseScan(rows);
  const lines = txt.split('\n');
  assert.match(lines[0], /noise σ/);
  assert.equal(lines.length - 1, rows.length);
});

test('summarizeNoiseScan mentions the sigma span and error span', () => {
  const txt = summarizeNoiseScan([
    { noiseSigma: 0, alignErrorM: 0.01, observations: 36, converged: true, iterations: 10 },
    { noiseSigma: 0.2, alignErrorM: 0.03, observations: 36, converged: true, iterations: 12 },
  ]);
  assert.match(txt, /0.00→0.20/);
  assert.match(txt, /1.00→3.00 cm/);
});