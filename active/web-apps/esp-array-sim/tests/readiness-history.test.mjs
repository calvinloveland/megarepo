import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReadinessHistoryEntry, pushReadinessHistory, formatReadinessHistory } from '../src/readiness-history.mjs';

test('makeReadinessHistoryEntry copies badge and line texts from a dashboard summary', () => {
  const entry = makeReadinessHistoryEntry('bundle: full', {
    badge: { severity: 'warn', label: 'CAUTION' },
    lines: [
      { severity: 'good', text: 'Best mode: matched at 1.00 cm.' },
      { severity: 'warn', text: 'Worst calibration time: 1200 ms.' },
    ],
  }, '12:00:00', 'hard living-room preset');
  assert.equal(entry.source, 'bundle: full');
  assert.equal(entry.stamp, '12:00:00');
  assert.equal(entry.badge.label, 'CAUTION');
  assert.equal(entry.note, 'hard living-room preset');
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

test('formatReadinessHistory emits a readable newest-first text export', () => {
  const txt = formatReadinessHistory([
    {
      source: 'Mode comparison',
      stamp: '12:00:02',
      note: 'distributed matched rows with 30% loss',
      badge: { label: 'CAUTION', severity: 'warn' },
      lines: ['Best mode: matched at 1.20 cm.', 'Worst calibration time: 1200 ms.'],
    },
    {
      source: 'Hardware sizing',
      stamp: '12:00:01',
      badge: { label: 'READY', severity: 'good' },
      lines: ['Recommended nodes: 6 for ≤5 cm worst-case.'],
    },
  ]);
  assert.match(txt, /^ESP Array Simulator — Readiness history/m);
  assert.match(txt, /\[12:00:02\] CAUTION — Mode comparison/);
  assert.match(txt, /notes: distributed matched rows with 30% loss/);
  assert.match(txt, /- Best mode: matched at 1.20 cm\./);
  assert.ok(txt.indexOf('12:00:02') < txt.indexOf('12:00:01'), 'newest entries first');
});

test('formatReadinessHistory handles the empty case explicitly', () => {
  assert.match(formatReadinessHistory([]), /\(no history\)/);
});