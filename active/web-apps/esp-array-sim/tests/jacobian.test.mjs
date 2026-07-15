import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateCaptures } from '../src/capture.mjs';
import {
  localize,
  localizeBest,
  initialGuess,
  analyticJacobian,
  numericalJacobian,
  residuals,
  freeDim,
} from '../src/localize.mjs';
import { runScenario } from '../src/scenario.mjs';

function approxMatrix(A, B, tol = 1e-5) {
  assert.equal(A.length, B.length, 'row count');
  assert.equal(A[0].length, B[0].length, 'col count');
  let max = 0;
  for (let i = 0; i < A.length; i++)
    for (let j = 0; j < A[0].length; j++) max = Math.max(max, Math.abs(A[i][j] - B[i][j]));
  assert.ok(max < tol, `analytic vs numeric Jacobian differ by ${max.toExponential(3)}`);
}

test('analytic Jacobian matches the numerical one', () => {
  const rng = makeRng(123);
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(6, room, rng);
  const obs = simulateCaptures(nodes, makeEmitSchedule(nodes));
  const p0 = initialGuess(6, room);
  // perturb away from the init so the Jacobian has full structure
  const p = p0.map((v, i) => v + (i % 3) * 0.17 - 0.05);
  const Ja = analyticJacobian(p, obs, 6);
  const Jn = numericalJacobian(p, obs, 6);
  approxMatrix(Ja, Jn, 1e-5);
});

test('analytic-driven localize still recovers truth within centimetres', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 } });
  assert.ok(s.alignErrorM < 0.05, `align error too large: ${s.alignErrorM.toFixed(4)}`);
});

test('numeric fallback path (analytic=false) still produces a full solution', () => {
  const rng = makeRng(9);
  const room = { width: 5, height: 4 };
  const nodes = randomLayout(5, room, rng);
  const obs = simulateCaptures(nodes, makeEmitSchedule(nodes));
  const sol = localizeBest(obs, nodes.length, room, { starts: 4, analytic: false });
  assert.equal(sol.pos.length, nodes.length);
  assert.equal(freeDim(5), 11); // (2n-3) positions + (n-1) offsets = 7 + 4
});