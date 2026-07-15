import test from 'node:test';
import assert from 'node:assert/strict';
import { runBench, formatBench } from '../src/bench.mjs';

test('runBench returns one point per node count with timing fields', () => {
  const pts = runBench({ nodeCounts: [4, 6], repeats: 2 });
  assert.equal(pts.length, 2);
  const seen = new Set(pts.map((p) => p.nodeCount));
  assert.ok(seen.has(4) && seen.has(6), 'both requested node counts present');
  for (const p of pts) {
    assert.ok(p.avgMs > 0, 'avgMs is a positive wall-clock');
    assert.ok(p.worstMs >= p.avgMs, 'worst >= avg');
    assert.ok(p.iterations > 0, 'LM ran');
    assert.ok(p.alignErrorM < 0.05, 'still solves within 5cm');
  }
});

test('per-node solver cost stays within the one-time calibration budget', () => {
  // A seating change happens a few times a session; a generous budget is 2 s
  // per node count even at 12 nodes with robust IRLS + 8 multistarts.
  const pts = runBench({ nodeCounts: [8, 12], repeats: 2 });
  for (const p of pts) {
    assert.ok(p.worstMs < 2000,
      `n=${p.nodeCount} worst ${p.worstMs.toFixed(0)}ms must stay under 2s calibration budget`);
  }
});

test('per-node cost scales roughly quadratically-ish (matches O(n^2) observations × multistart)', () => {
  // The joint solver cost is dominated by the O(n^2)-observation Jacobian ×
  // multistart × IRLS-iterations, so a 6->12-node doubling should cost ~4× plus
  // some constant overhead — empirically ~8-12× on this hardware. We assert the
  // scaling stays within the quadratic-with-overhead envelope (<15×) so a real
  // algorithmic regression (e.g. accidental O(n^3) or O(n^4) inner loop) is
  // caught without flapping on a noisy box.
  const pts = runBench({ nodeCounts: [6, 12], repeats: 2 });
  const r6 = pts.find((p) => p.nodeCount === 6).avgMs;
  const r12 = pts.find((p) => p.nodeCount === 12).avgMs;
  assert.ok(r12 / r6 < 15, `12-node shouldn't be >15× the 6-node cost (got ${(r12 / r6).toFixed(1)}×)`);
});

test('formatBench renders a header and one line per point', () => {
  const pts = runBench({ nodeCounts: [4], repeats: 1 });
  const txt = formatBench(pts);
  const lines = txt.split('\n');
  assert.ok(lines[0].includes('nodes'), 'header present');
  assert.equal(lines.length - 1, pts.length);
});