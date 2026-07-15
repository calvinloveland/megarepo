import { makeRng, randomLayout } from './world.mjs';
import { makeSimFirmwareBackend, runDistributedWithBackend } from './firmware-backend.mjs';

export function makeFirmwareFixtures() {
  const seed = 7;
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(4, room, makeRng(seed));

  const closedRun = runDistributedWithBackend(nodes, makeSimFirmwareBackend(room, { captureMode: 'closed' }));
  const matchedRun = runDistributedWithBackend(nodes, makeSimFirmwareBackend(room, { captureMode: 'matched', reflCoef: 0.5 }));

  return {
    meta: { seed, room, nodeCount: nodes.length },
    plan: closedRun.plan,
    listenerRowsClosed: closedRun.rowPackets,
    listenerRowsMatched: matchedRun.rowPackets,
  };
}
