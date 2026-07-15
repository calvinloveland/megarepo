// Distributed/mesh localization protocol *simulation*: models what the ESP32s
// will actually do, not just the centralized oracle.
//
// In the real system each node only ever sees the arrivals at ITS OWN microphone
// (the "listener row" of the observation matrix). To localize, the mesh runs a
// gossip round in which every node broadcasts its row to its peers over WiFi,
// any one node (or all) assemble the full observation matrix, and the joint
// solver runs on it. This module simulates that data flow and the message cost,
// and proves the gossiped matrix is identical to what a centralized capture
// would have produced — so the distributed protocol is a drop-in for the
// simulator's centralized path.

import { simulateCaptures, simulateMatchedCaptures } from './capture.mjs';
import { makeEmitSchedule } from './world.mjs';
import {
  makeCalibrationPlan,
  rowsToListenerPackets,
  gossipPacketsAndAssemble,
} from './firmware-protocol.mjs';

/**
 * Per-node view of one calibration sweep: only the arrivals heard by THIS
 * node's microphone (all emissions, listener = self). That is all the raw data
 * a single ESP32 possesses after the sweep.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{width:number,height:number}} room metres
 * @param {object} [captureOpts] passed to simulateCaptures/simulateMatchedCaptures
 * @param {'closed'|'matched'} [captureOpts.captureMode] default 'closed'
 * @returns {{perNode: Observation[][], rowPackets: object[], schedule, plan: object, messages: number}}
 */
export function distributedCaptures(nodes, room, captureOpts = {}) {
  const schedule = makeEmitSchedule(nodes);
  const all =
    captureOpts.captureMode === 'matched'
      ? simulateMatchedCaptures(nodes, schedule, { room, ...captureOpts })
      : simulateCaptures(nodes, schedule);
  // Partition the full observation matrix by listener (each node's row).
  const perNode = nodes.map((n) => all.filter((o) => o.listenerId === n.id));
  const plan = makeCalibrationPlan(schedule, { gapSec: captureOpts.gapSec });
  const rowPackets = rowsToListenerPackets(perNode, { sweepId: plan.sweepId });
  return { perNode, rowPackets, schedule, plan, messages: 0 };
}

/**
 * Simulate one gossip round where every node broadcasts its listener-row to all
// peers. Models the simplest correct protocol (full broadcast, flooding) and
 * reports the per-row message count and the assembled matrix.
 *
 * @param {Observation[][]} perNode one row per node
 * @returns {{matrix: Observation[], messages: number, lost:number, packets: object[]}}
 */
export function gossipAndAssemble(perNode, opts = {}) {
  const packets = rowsToListenerPackets(perNode, { sweepId: opts.sweepId ?? 'sim-sweep' });
  return gossipPacketsAndAssemble(packets, opts);
}

/**
 * Full distributed pipeline: each node hears only its own mic, gossips, assembles
 * centrally, and we return the resulting observation set plus the message cost —
 * ready to hand to the joint solver exactly like the centralized capture path.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{width:number,height:number}} room
 * @param {object} [captureOpts]
 * @returns {{matrix: Observation[], messages: number, schedule}}
 */
export function distributedSweep(nodes, room, captureOpts = {}) {
  const { perNode, rowPackets, schedule, plan } = distributedCaptures(nodes, room, captureOpts);
  const assembled = gossipPacketsAndAssemble(rowPackets, {
    loss: captureOpts.meshLoss ?? 0,
    seedRng: captureOpts.seedRng,
  });
  return { ...assembled, schedule, plan, rowPackets: assembled.packets, allRowPackets: rowPackets };
}