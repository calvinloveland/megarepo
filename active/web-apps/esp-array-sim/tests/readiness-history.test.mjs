import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReadinessHistoryEntry, pushReadinessHistory } from '../src/readiness-history.mjs';

test('makeReadinessHistoryEntry copies badge and line texts from a dashboard summary', () => {
  const entry = makeReadinessHistoryEntry('bundle: full', {
    badge: { severity: 'warn', label: 'CAUTION' },
    lines: [
      { severity: 'good', text: 'Best mode: matched at 1.00 cm.' },
      { severity: 'warn', text: 'Worst calibration time: 1200 ms.' },
    ],
  }, '12:00:00');
  assert.equal(entry.source, 'bundle: full');
  assert.equal(entry.stamp, '12:00:00');
  assert.equal(entry.badge.label, 'CAUTION');
  assert.deepEqual(entry.lines, [
    'Best mode: matched at 1.00 cm.',
    'Worst calibration time: 1200 ms.',
  ]);
});

test('pushReadinessHistory keeps newest entries first and trims to the limit', () => {
  let history = [];
  history = pushReadinessHistory(history, { source: 'a' }, 2);
  history = pushReadinessHistory(history, { source: 'b' }, 2);
  history = pushReadinessHistory(history, { source: 'c' }, 2);
  assert.deepEqual(history.map((h) => h.source), ['c', 'b']);
});