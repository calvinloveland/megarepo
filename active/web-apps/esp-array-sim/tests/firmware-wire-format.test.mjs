import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCalibrationPlanWire,
  decodeCalibrationPlanWire,
  encodeListenerRowWire,
  decodeListenerRowWire,
} from '../src/firmware-wire-format.mjs';
import { makeCalibrationPlan, rowsToListenerPackets } from '../src/firmware-protocol.mjs';

test('calibration plan round-trips through the integer wire format', () => {
  const plan = makeCalibrationPlan([{ emitterId: 0, emitClockSec: 0.1 }, { emitterId: 1, emitClockSec: 0.4 }]);
  const wire = encodeCalibrationPlanWire(plan);
  const round = decodeCalibrationPlanWire(wire);
  assert.equal(wire.kind, 'calibration-plan-v1/int-us');
  assert.equal(round.kind, 'calibration-plan-v1');
  assert.ok(Math.abs(round.gapSec - plan.gapSec) < 1e-9);
  assert.deepEqual(round.emissions, plan.emissions);
});

test('listener row round-trips through the integer wire format within quantization error', () => {
  const [packet] = rowsToListenerPackets([[
    {
      emitterId: 1,
      listenerId: 0,
      emitClockSec: 0.4,
      arrivalClockSec: 0.40388096470926454,
      distanceM: 1.3449698778545012,
      estimatedDirectSec: 0.00388096470926454,
      arrivalPaths: [{ delaySec: 0.003881, amplitude: 0.8123, kind: 'echo' }],
      shots: [0.40388, 0.40389, 0.40387],
    },
  ]], { sweepId: 't1' });
  const wire = encodeListenerRowWire(packet);
  const round = decodeListenerRowWire(wire);
  const a = round.arrivals[0];
  assert.equal(wire.kind, 'listener-row-v1/int-us');
  assert.equal(round.listenerId, packet.listenerId);
  assert.ok(Math.abs(a.arrivalClockSec - packet.arrivals[0].arrivalClockSec) < 2e-6);
  assert.ok(Math.abs(a.distanceM - packet.arrivals[0].distanceM) < 1e-3);
  assert.equal(a.arrivalPaths[0].kind, 'echo');
  assert.ok(Math.abs(a.arrivalPaths[0].amplitude - packet.arrivals[0].arrivalPaths[0].amplitude) < 2e-3);
  assert.equal(a.shots.length, 3);
});