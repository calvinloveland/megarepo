import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBundleReport } from '../src/bundle-report.mjs';
import { getScanBundle } from '../src/scan-bundles.mjs';

test('formatBundleReport emits bundle header and sections in bundle order', () => {
  const txt = formatBundleReport(getScanBundle('quick'), {
    compare: 'COMPARE',
    sizing: 'SIZING',
    noise: 'NOISE',
  }, 'hard living-room preset');
  assert.match(txt, /^ESP Array Simulator — Quick characterize/m);
  assert.match(txt, /scenario notes: hard living-room preset/);
  const compare = txt.indexOf('## Mode comparison');
  const sizing = txt.indexOf('## Hardware sizing');
  const noise = txt.indexOf('## Noise sensitivity');
  assert.ok(compare < sizing && sizing < noise, 'sections must follow bundle order');
  assert.match(txt, /COMPARE/);
  assert.match(txt, /SIZING/);
  assert.match(txt, /NOISE/);
});

test('formatBundleReport notes missing sections explicitly', () => {
  const txt = formatBundleReport(getScanBundle('full'), {
    compare: 'ok',
    sizing: 'ok',
  });
  assert.match(txt, /## Calibration latency\n\(not run\)/);
  assert.match(txt, /## Node-count sensitivity\n\(not run\)/);
});

test('formatBundleReport ends with a trailing newline', () => {
  const txt = formatBundleReport(getScanBundle('quick'), {});
  assert.ok(txt.endsWith('\n'));
});