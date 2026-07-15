import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/scenario.mjs';
import { SPEED_OF_SOUND } from '../src/acoustics.mjs';

test('scenario localizes a 6-node mesh within a few centimetres', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  // The residual cost should reach the jitter floor (≈cm-scale equiv), and the
  // Procrustes alignment error after mirror resolution should be small.
  assert.ok(s.solution.costs.at(-1) < 1e-6, `residual cost too high: ${s.solution.costs.at(-1)}`);
  assert.ok(s.alignErrorM < 0.05, `align error too large: ${s.alignErrorM.toFixed(3)} m`);
});

test('localized positions match truth on a noise-free small room', () => {
  // 4 nodes in a tight room; with perfect captures we expect mm-level recovery.
  const s = runScenario({ seed: 1, nodeCount: 4, room: { width: 3, height: 3 } });
  assert.ok(s.alignErrorM < 0.01, `expected near-perfect localization, got ${s.alignErrorM.toFixed(4)}`);
});

test('the same seed reproduces the same geometry', () => {
  const a = runScenario({ seed: 7, nodeCount: 5, room: { width: 5, height: 4 } });
  const b = runScenario({ seed: 7, nodeCount: 5, room: { width: 5, height: 4 } });
  assert.deepEqual(a.truth, b.truth);
  assert.equal(a.alignErrorM, b.alignErrorM);
});

test('different seeds give different layouts', () => {
  const a = runScenario({ seed: 3, nodeCount: 5 });
  const b = runScenario({ seed: 99, nodeCount: 5 });
  assert.notDeepEqual(a.truth, b.truth);
});