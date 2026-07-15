import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFirmwareBackend,
  makeSimFirmwareBackend,
  runDistributedWithBackend,
} from '../src/firmware-backend.mjs';
import { distributedSweep } from '../src/mesh.mjs';
import { makeRng, randomLayout } from '../src/world.mjs';

test('assertFirmwareBackend rejects incomplete implementations', () => {
  assert.throws(() => assertFirmwareBackend({}), /missing syncClocks/);
});

test('sim firmware backend runs one full distributed calibration pass', () => {
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(5, room, makeRng(1));
  const backend = makeSimFirmwareBackend(room, { captureMode: 'closed' });
  const run = runDistributedWithBackend(nodes, backend);
  assert.equal(run.plan.kind, 'calibration-plan-v1');
  assert.equal(run.perNode.length, nodes.length);
  assert.equal(run.matrix.length, nodes.length * nodes.length);
  assert.equal(run.messages, 5 * 4);
});

test('distributedSweep can run through an explicit backend object', () => {
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(5, room, makeRng(2));
  const base = makeSimFirmwareBackend(room, { captureMode: 'closed', meshLoss: 0 });
  const calls = [];
  const backend = {
    syncClocks(nodesArg) { calls.push('syncClocks'); return base.syncClocks(nodesArg); },
    makeCalibrationPlan(nodesArg) { calls.push('makeCalibrationPlan'); return base.makeCalibrationPlan(nodesArg); },
    captureListenerRows(nodesArg, planArg) { calls.push('captureListenerRows'); return base.captureListenerRows(nodesArg, planArg); },
    gossipListenerRows(rowsArg) { calls.push('gossipListenerRows'); return base.gossipListenerRows(rowsArg); },
  };
  const run = distributedSweep(nodes, room, { backend });
  assert.deepEqual(calls, ['syncClocks', 'makeCalibrationPlan', 'captureListenerRows', 'gossipListenerRows']);
  assert.equal(run.matrix.length, nodes.length * nodes.length);
  assert.equal(run.messages, 5 * 4);
});

test('sim backend preserves matched distributed diagnostics', () => {
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(4, room, makeRng(3));
  const backend = makeSimFirmwareBackend(room, { captureMode: 'matched', reflCoef: 0.5 });
  const run = runDistributedWithBackend(nodes, backend);
  const sample = run.matrix.find((o) => o.listenerId !== o.emitterId);
  assert.ok(sample.arrivalPaths?.length > 0);
});