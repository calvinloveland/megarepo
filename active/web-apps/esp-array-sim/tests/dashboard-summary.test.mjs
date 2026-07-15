import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSummaryLines, formatDashboardSummary } from '../src/dashboard-summary.mjs';

test('dashboardSummaryLines reports pending sections explicitly when nothing has run', () => {
  const lines = dashboardSummaryLines({});
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Best mode: pending/);
  assert.match(lines[1], /Recommended nodes: pending/);
  assert.match(lines[2], /Worst calibration time: pending/);
  assert.match(lines[3], /Noise sensitivity: pending/);
});

test('dashboardSummaryLines synthesizes best mode, node recommendation, worst time, and noise span', () => {
  const lines = dashboardSummaryLines({
    compare: { rows: [
      { label: 'matched', alignErrorM: 0.02 },
      { label: 'closed', alignErrorM: 0.01 },
    ] },
    sizing: { recs: [{ minNodes: 6, atWorstM: 0.04 }], targetM: 0.05 },
    bench: { points: [{ worstMs: 120 }, { worstMs: 340 }] },
    noise: { rows: [
      { noiseSigma: 0, alignErrorM: 0.01 },
      { noiseSigma: 0.2, alignErrorM: 0.03 },
    ] },
  });
  assert.match(lines[0], /Best mode: closed at 1.00 cm/);
  assert.match(lines[1], /Recommended nodes: 6 for ≤5 cm worst-case/);
  assert.match(lines[2], /Worst calibration time: 340 ms/);
  assert.match(lines[3], /σ 0.00→0.20 changes error 1.00→3.00 cm/);
});

test('formatDashboardSummary joins lines with newlines', () => {
  const txt = formatDashboardSummary({});
  assert.ok(txt.split('\n').length >= 4);
});