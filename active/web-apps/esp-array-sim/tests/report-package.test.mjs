import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReportPackage } from '../src/report-package.mjs';
import { getScanBundle } from '../src/scan-bundles.mjs';

test('formatReportPackage concatenates snapshot, bundle report, and readiness history', () => {
  const txt = formatReportPackage({
    url: 'http://127.0.0.1:5193/#n=8',
    notes: 'hard living-room preset',
    dashboard: {
      badge: { label: 'CAUTION', severity: 'warn' },
      lines: [{ severity: 'warn', text: 'Worst calibration time: 1200 ms.' }],
    },
    bundle: getScanBundle('quick'),
    reports: { compare: 'COMPARE', sizing: 'SIZING', noise: 'NOISE' },
    history: [{
      source: 'Bundle: Quick characterize',
      stamp: '12:00:00',
      note: 'hard living-room preset',
      badge: { label: 'CAUTION', severity: 'warn' },
      lines: ['Worst calibration time: 1200 ms.'],
    }],
  });
  assert.match(txt, /=== ANALYSIS SNAPSHOT ===/);
  assert.match(txt, /ESP Array Simulator — Analysis snapshot/);
  assert.match(txt, /=== BUNDLE REPORT ===/);
  assert.match(txt, /ESP Array Simulator — Quick characterize/);
  assert.match(txt, /=== READINESS HISTORY ===/);
  assert.match(txt, /ESP Array Simulator — Readiness history/);
});

test('formatReportPackage handles missing bundle/history gracefully', () => {
  const txt = formatReportPackage({
    dashboard: { badge: { label: 'PENDING', severity: 'pending' }, lines: [] },
  });
  assert.match(txt, /\(no bundle selected\)/);
  assert.match(txt, /\(no history\)/);
});