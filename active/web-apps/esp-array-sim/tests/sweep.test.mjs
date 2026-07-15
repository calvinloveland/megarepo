import test from 'node:test';
import assert from 'node:assert/strict';
import { runSweep, formatSweep } from '../src/sweep.mjs';

const SMALL = {
  nodeCounts: [4, 6],
  captureModes: ['closed', 'matched'],
  reflCoefs: [0.0, 0.5],
  trials: 4,
  seedBase: 500,
  roomW: 7, roomH: 5,
};

test('runSweep produces one cell per (node × mode × reflCoef) combination', () => {
  const cells = runSweep(SMALL);
  assert.equal(cells.length, 2 * 2 * 2);
  const keys = new Set(cells.map((c) => `${c.nodeCount}-${c.captureMode}-${c.reflCoef}`));
  assert.equal(keys.size, 8);
  for (const c of cells) assert.equal(c.trials, 4);
});

test('closed-mode localization stays within the mic-jitter floor across reverb (reverb is inert in the closed path)', () => {
  const cells = runSweep(SMALL);
  for (const c of cells) {
    if (c.captureMode !== 'closed') continue;
    // closed-form TOA only adds ~20 µs mic jitter ≈ 0.7 cm; sub-cm solver on top.
    assert.ok(c.medianErrM < 0.05,
      `closed median ${(c.medianErrM*100).toFixed(2)}cm too large at reflCoef ${c.reflCoef}`);
  }
});

test('matched-mode accuracy does not improve when reverb increases (reverb hurts the estimator)', () => {
  const cells = runSweep(SMALL);
  for (const c of cells) {
    if (c.captureMode !== 'matched' || c.reflCoef !== 0.0) continue;
    const louder = cells.find(
      (m) => m.nodeCount === c.nodeCount && m.captureMode === 'matched' && m.reflCoef === 0.5,
    );
    assert.ok(louder, 'higher-reverb matched counterpart exists');
    assert.ok(c.medianErrM <= louder.medianErrM + 1e-9,
      `free-field matched median ${(c.medianErrM*100).toFixed(2)}cm should be <= reverberant ${(louder.medianErrM*100).toFixed(2)}cm`);
  }
});

test('free-field (reflCoef 0) localization succeeds well within the success threshold', () => {
  const cells = runSweep({ ...SMALL, reflCoefs: [0.0], captureModes: ['closed'] });
  for (const c of cells) {
    assert.ok(c.successRate >= 0.75, `free-field success too low at ${c.nodeCount} nodes: ${(c.successRate*100)}%`);
  }
});

test('worsening reverb never improves median accuracy in closed mode', () => {
  // closed mode ignores reverb (no echoes in the closed-form path), so all
  // reflCoef cells should be identical (a sanity check on determinism).
  const cells = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0, 0.3, 0.9], trials: 5, roomW: 7, roomH: 5 });
  const errs = cells.map((c) => c.medianErrM);
  const spread = Math.max(...errs) - Math.min(...errs);
  assert.ok(spread < 1e-9, `closed-mode reverb should be inert; median spread ${spread.toExponential(2)}`);
});

test('formatSweep produces a readable table header and one row per cell', () => {
  const cells = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const out = formatSweep(cells);
  const lines = out.split('\n');
  assert.ok(lines[0].includes('median'));
  assert.equal(lines.length - 1, cells.length);
  assert.ok(lines[1].includes('cm'));
});

test('runSweep is deterministic for a fixed seedBase', () => {
  const a = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3, seedBase: 7 });
  const b = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3, seedBase: 7 });
  assert.deepEqual(a, b);
});