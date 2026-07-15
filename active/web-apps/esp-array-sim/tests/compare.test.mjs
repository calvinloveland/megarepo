import test from 'node:test';
import assert from 'node:assert/strict';
import { compareModes, formatComparison, summarizeComparison } from '../src/compare.mjs';

test('compareModes returns closed, matched, and distributed rows for the same scenario', () => {
  const rows = compareModes({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.captureMode), ['closed', 'matched', 'distributed']);
  for (const r of rows) {
    assert.ok(r.alignErrorM >= 0);
    assert.ok(r.observations > 0);
    assert.ok(r.iterations > 0);
  }
  assert.equal(rows[2].meshMessages, 6 * 5, 'distributed reports gossip cost');
});

test('distributedMatched changes the distributed label in comparisons', () => {
  const rows = compareModes({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, distributedMatched: true, reflCoef: 0.5, earliestPeak: true });
  assert.equal(rows[2].label, 'distributed+matched');
  assert.equal(rows[2].distributedMatched, true);
});

test('formatComparison renders a header and one line per row', () => {
  const rows = compareModes({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  const txt = formatComparison(rows);
  const lines = txt.split('\n');
  assert.match(lines[0], /mode/);
  assert.equal(lines.length - 1, rows.length);
});

test('summarizeComparison mentions the best mode and distributed message cost', () => {
  const txt = summarizeComparison([
    { label: 'closed', captureMode: 'closed', alignErrorM: 0.01, observations: 36, meshMessages: null, meshLost: 0, converged: true, iterations: 10 },
    { label: 'matched', captureMode: 'matched', alignErrorM: 0.02, observations: 36, meshMessages: null, meshLost: 0, converged: true, iterations: 10 },
    { label: 'distributed', captureMode: 'distributed', alignErrorM: 0.03, observations: 36, meshMessages: 30, meshLost: 2, converged: true, iterations: 10 },
  ]);
  assert.match(txt, /Best accuracy: closed/);
  assert.match(txt, /distributed cost 30 msgs, 2 lost/);
});