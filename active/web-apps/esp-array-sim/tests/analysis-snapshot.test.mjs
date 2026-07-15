import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAnalysisSnapshot } from '../src/analysis-snapshot.mjs';
import { getScanBundle } from '../src/scan-bundles.mjs';

test('formatAnalysisSnapshot includes share URL, notes, readiness, and bundle report', () => {
  const txt = formatAnalysisSnapshot({
    url: 'http://127.0.0.1:5193/#n=8&mode=matched',
    notes: 'hard living-room preset',
    dashboard: {
      badge: { label: 'CAUTION', severity: 'warn' },
      lines: [
        { severity: 'good', text: 'Best mode: matched at 1.20 cm.' },
        { severity: 'warn', text: 'Worst calibration time: 1200 ms.' },
      ],
    },
    bundle: getScanBundle('quick'),
    reports: { compare: 'COMPARE', sizing: 'SIZING', noise: 'NOISE' },
  });
  assert.match(txt, /^ESP Array Simulator — Analysis snapshot/m);
  assert.match(txt, /share url: http:\/\/127.0.0.1:5193\/#n=8&mode=matched/);
  assert.match(txt, /scenario notes: hard living-room preset/);
  assert.match(txt, /readiness: CAUTION/);
  assert.match(txt, /- Best mode: matched at 1.20 cm\./);
  assert.match(txt, /ESP Array Simulator — Quick characterize/);
  assert.match(txt, /COMPARE/);
});

test('formatAnalysisSnapshot still works without optional URL or notes', () => {
  const txt = formatAnalysisSnapshot({
    dashboard: { badge: { label: 'PENDING', severity: 'pending' }, lines: [] },
    bundle: getScanBundle('quick'),
    reports: {},
  });
  assert.match(txt, /readiness: PENDING/);
  assert.doesNotMatch(txt, /share url:/);
  assert.doesNotMatch(txt, /scenario notes:/);
});