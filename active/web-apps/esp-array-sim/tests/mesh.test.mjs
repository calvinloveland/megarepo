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