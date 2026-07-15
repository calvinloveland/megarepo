import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateCaptures } from '../src/capture.mjs';
import {
  distributedCaptures as distCap,
  gossipAndAssemble,
  distributedSweep,
} from '../src/mesh.mjs';
import { runScenario } from '../src/scenario.mjs';

test('each node only holds the arrivals heard by its own microphone', () => {
  const rng = makeRng(4);
  const room = { width: 7, height: 5 };
  const nodes = randomLayout(6, room, rng);
  const { perNode } = distCap(nodes, room, { captureMode: 'closed' });
  assert.equal(perNode.length, nodes.length);
  // every node's row contains exactly one arrival per emission, all listener=self
  for (let i = 0; i < nodes.length; i++) {
    for (const o of perNode[i]) assert.equal(o.listenerId, nodes[i].id, 'row must be listener=keyed to self');
  }
  // total arrivals == n emissions * n listeners
  const total = perNode.reduce((s, r) => s + r.length, 0);
  assert.equal(total, nodes.length * nodes.length);
});

test('the gossiped matrix is exactly the centralized capture matrix', () => {
  const rng = makeRng(4);
  const room = { width: 7, height: 5 };
  const nodes = randomLayout(6, room, rng);
  const sched = makeEmitSchedule(nodes);
  const central = simulateCaptures(nodes, sched);
  const { matrix } = distributedSweep(nodes, room, { captureMode: 'closed' });
  // same multiset of (emitter,listener,arrival) keyed observations
  const key = (o) => `${o.emitterId}-${o.listenerId}`;
  assert.deepEqual(matrix.map(key).sort(), central.map(key).sort());
  // arrival times must match exactly for the closed path
  const byKey = new Map(matrix.map((o) => [key(o), o.arrivalClockSec]));
  for (const o of central) assert.equal(byKey.get(key(o)), o.arrivalClockSec);
});

test('full-broadcast gossip sends n*(n-1) messages', () => {
  const rng = makeRng(2);
  const nodes = randomLayout(5, { width: 6, height: 5 }, rng);
  const { perNode } = distCap(nodes, { width: 6, height: 5 }, { captureMode: 'closed' });
  const { messages } = gossipAndAssemble(perNode);
  assert.equal(messages, 5 * 4);
});

test('packet loss drops some listener rows from the assembled matrix', () => {
  const rng = makeRng(4);
  const room = { width: 7, height: 5 };
  const nodes = randomLayout(6, room, rng);
  const { perNode } = distCap(nodes, room, { captureMode: 'closed' });
  // 50% loss with a deterministic rng: strictly fewer rows survive.
  const { matrix, messages, lost } = gossipAndAssemble(perNode, { loss: 0.5, seedRng: makeRng(1) });
  const fullRows = nodes.length * nodes.length;
  assert.ok(matrix.length < fullRows, `partial matrix should drop rows: ${matrix.length} vs ${fullRows}`);
  assert.ok(lost > 0, 'some messages reported lost');
  assert.equal(messages + lost, nodes.length * (nodes.length - 1));
});

test('zero-loss distributed sweep is exactly the centralized matrix', () => {
  const rng = makeRng(9);
  const room = { width: 7, height: 5 };
  const nodes = randomLayout(6, room, rng);
  const { matrix } = distributedSweep(nodes, room, { captureMode: 'closed', meshLoss: 0 });
  assert.equal(matrix.length, nodes.length * nodes.length);
  // every (emitter,listener) pair present exactly once
  const keys = matrix.map((o) => `${o.emitterId}-${o.listenerId}`).sort();
  assert.equal(new Set(keys).size, nodes.length * nodes.length);
});

test('distributed localizes under modest packet loss thanks to redundancy + robust LM', () => {
  // Each (emitter,listener) arrival is a unique measurement, so a lost listener
  // row removes n observations at once. With ~30% loss on 6 nodes the matrix
  // stays over-determined enough for the LM solver + robust down-weighting to
  // recover the geometry to within the success threshold.
  const s = runScenario({
    seed: 42, nodeCount: 8, room: { width: 8, height: 6 },
    captureMode: 'distributed', meshLoss: 0.3, robust: 5e-5,
  });
  assert.ok(s.distributed, 'flags distributed');
  assert.ok(s.meshLost > 0, 'packet loss occurred');
  // tolerate coarser recovery under partial data
  assert.ok(s.alignErrorM < 0.15,
    `distributed-with-loss localization too coarse: ${s.alignErrorM.toFixed(3)} m (lost ${s.meshLost} msgs)`);
});

test('distributed captureMode localizes as well as closed centralized', () => {
  const dist = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, captureMode: 'distributed' });
  const cent = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, captureMode: 'closed' });
  assert.ok(dist.distributed, 'scenario flags itself distributed');
  assert.equal(dist.meshMessages, 6 * 5, 'full-broadcast gossip cost n*(n-1)');
  // The matrix is the same multiset (tested above); only floating-point summation
  // order differs, so both localizations succeed with sub-5cm accuracy.
  assert.ok(dist.alignErrorM < 0.05, `distributed localization too coarse: ${dist.alignErrorM.toFixed(3)} m`);
  assert.ok(cent.alignErrorM < 0.05, `centralized localization too coarse: ${cent.alignErrorM.toFixed(3)} m`);
});

test('distributedMatched uses realistic matched-filter captures across the mesh', () => {
  const s = runScenario({
    seed: 42,
    nodeCount: 6,
    room: { width: 6, height: 5 },
    captureMode: 'distributed',
    distributedMatched: true,
    reflCoef: 0.5,
    earliestPeak: true,
  });
  assert.ok(s.distributed, 'still distributed');
  assert.equal(s.distributedMatched, true, 'scenario exposes distributedMatched');
  assert.ok(s.observations.some((o) => Array.isArray(o.arrivalPaths) && o.arrivalPaths.length > 0),
    'matched distributed observations should carry path diagnostics from the waveform estimator');
});