import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomLayout } from '../src/world.mjs';
import { makeSimFirmwareBackend } from '../src/firmware-backend.mjs';
import { FIRMWARE_STATES, runFirmwareSession } from '../src/firmware-session.mjs';
import { runScenario } from '../src/scenario.mjs';

test('runFirmwareSession follows the explicit firmware lifecycle and returns solved surround state', () => {
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(5, room, makeRng(1));
  const truth = nodes.map((n) => ({ x: n.pos.x, y: n.pos.y }));
  const session = runFirmwareSession({
    nodes,
    room,
    backend: makeSimFirmwareBackend(room, { captureMode: 'closed' }),
    seedRng: makeRng(2),
    truth,
  });
  assert.deepEqual(session.trace, FIRMWARE_STATES);
  assert.equal(session.plan.kind, 'calibration-plan-v1');
  assert.equal(session.rowPackets.length, nodes.length);
  assert.ok(session.alignErrorM < 0.05);
  assert.equal(session.surround.length, 6);
});

test('distributed scenarios now run through the firmware session path', () => {
  const s = runScenario({ seed: 42, nodeCount: 6, room: { width: 6, height: 5 }, captureMode: 'distributed' });
  assert.equal(s.distributed, true);
  assert.deepEqual(s.firmwareTrace, FIRMWARE_STATES);
  assert.equal(s.firmwarePlan.kind, 'calibration-plan-v1');
  assert.equal(s.firmwareRowPackets.length, 6);
  assert.ok(s.alignErrorM < 0.05);
});

test('distributed matched scenarios expose the firmware session metadata too', () => {
  const s = runScenario({
    seed: 42,
    nodeCount: 6,
    room: { width: 6, height: 5 },
    captureMode: 'distributed',
    distributedMatched: true,
    earliestPeak: true,
    reflCoef: 0.5,
  });
  assert.equal(s.distributedMatched, true);
  assert.deepEqual(s.firmwareTrace, FIRMWARE_STATES);
  assert.ok(s.firmwareRowPackets.some((p) => p.arrivals.some((a) => Array.isArray(a.arrivalPaths))));
});