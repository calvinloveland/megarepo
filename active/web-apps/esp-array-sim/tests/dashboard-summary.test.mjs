import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSummary, dashboardSummaryLines, formatDashboardSummary } from '../src/dashboard-summary.mjs';

test('dashboardSummaryLines reports pending sections explicitly when nothing has run', () => {
  const summary = dashboardSummary({});
  const lines = summary.lines.map((line) => line.text);
  assert.equal(summary.badge.severity, 'pending');
  assert.equal(summary.badge.label, 'PENDING');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Best mode: pending/);
  assert.match(lines[1], /Recommended nodes: pending/);
  assert.match(lines[2], /Worst calibration time: pending/);
  assert.match(lines[3], /Noise sensitivity: pending/);
});

test('dashboardSummaryLines synthesizes best mode, node recommendation, worst time, and noise span', () => {
  const summary = dashboardSummary({
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
  const lines = summary.lines.map((line) => line.text);
  assert.equal(summary.badge.severity, 'good');
  assert.equal(summary.badge.label, 'READY');
  assert.match(lines[0], /Best mode: closed at 1.00 cm/);
  assert.match(lines[1], /Recommended nodes: 6 for ≤5 cm worst-case/);
  assert.match(lines[2], /Worst calibration time: 340 ms/);
  assert.match(lines[3], /σ 0.00→0.20 changes error 1.00→3.00 cm/);
});

test('dashboardSummary escalates to bad when sizing is infeasible or latency is too high', () => {
  const summary = dashboardSummary({
    compare: { rows: [{ label: 'matched', alignErrorM: 0.01 }] },
    sizing: { recs: [{ minNodes: null, atWorstM: 0.2 }], targetM: 0.05 },
    bench: { points: [{ worstMs: 2500 }] },
    noise: { rows: [{ noiseSigma: 0, alignErrorM: 0.01 }, { noiseSigma: 0.2, alignErrorM: 0.25 }] },
  });
  assert.equal(summary.badge.severity, 'bad');
  assert.equal(summary.badge.label, 'RISK');
  assert.equal(summary.lines[1].severity, 'bad');
  assert.equal(summary.lines[2].severity, 'bad');
  assert.equal(summary.lines[3].severity, 'bad');
});

test('formatDashboardSummary joins lines with newlines', () => {
  const txt = formatDashboardSummary({});
  assert.ok(txt.split('\n').length >= 4);
});