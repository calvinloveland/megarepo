import { makeRng, randomLayout } from './world.mjs';
import { makeSimFirmwareBackend, runDistributedWithBackend } from './firmware-backend.mjs';
import { encodeCalibrationPlanWire, encodeListenerRowWire } from './firmware-wire-format.mjs';

export function makeFirmwareFixtures() {
  const seed = 7;
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(4, room, makeRng(seed));

  const closedRun = runDistributedWithBackend(nodes, makeSimFirmwareBackend(room, { captureMode: 'closed' }));
  const matchedRun = runDistributedWithBackend(nodes, makeSimFirmwareBackend(room, { captureMode: 'matched', reflCoef: 0.5 }));

  return {
    meta: { seed, room, nodeCount: nodes.length },
    plan: closedRun.plan,
    planWire: encodeCalibrationPlanWire(closedRun.plan),
    listenerRowsClosed: closedRun.rowPackets,
    listenerRowsClosedWire: closedRun.rowPackets.map((p) => encodeListenerRowWire(p)),
    listenerRowsMatched: matchedRun.rowPackets,
    listenerRowsMatchedWire: matchedRun.rowPackets.map((p) => encodeListenerRowWire(p)),
  };
}
