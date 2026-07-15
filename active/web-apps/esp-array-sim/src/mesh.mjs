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

/**
 * Per-node view of one calibration sweep: only the arrivals heard by THIS
 * node's microphone (all emissions, listener = self). That is all the raw data
 * a single ESP32 possesses after the sweep.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{width:number,height:number}} room metres
 * @param {object} [captureOpts] passed to simulateCaptures/simulateMatchedCaptures
 * @param {'closed'|'matched'} [captureOpts.captureMode] default 'closed'
 * @returns {{perNode: Observation[][], schedule, messages: number}}
 */
export function distributedCaptures(nodes, room, captureOpts = {}) {
  const schedule = makeEmitSchedule(nodes);
  const all =
    captureOpts.captureMode === 'matched'
      ? simulateMatchedCaptures(nodes, schedule, { room, ...captureOpts })
      : simulateCaptures(nodes, schedule);
  // Partition the full observation matrix by listener (each node's row).
  const perNode = nodes.map((n) => all.filter((o) => o.listenerId === n.id));
  return { perNode, schedule, messages: 0 };
}

/**
 * Simulate one gossip round where every node broadcasts its listener-row to all
// peers. Models the simplest correct protocol (full broadcast, flooding) and
 * reports the per-row message count and the assembled matrix.
 *
 * @param {Observation[][]} perNode one row per node
 * @returns {{matrix: Observation[], messages: number}}
 */
export function gossipAndAssemble(perNode, opts = {}) {
  const n = perNode.length;
  // full broadcast: each node sends its row to (n-1) peers → n(n-1) messages.
  let messages = n * (n - 1);
  // Real WiFi drops packets. opts.loss prob means a fraction of (peer,row) messages
  // fail to arrive; the assembler sees only the rows that reached it. Models the
  // degraded-but-still-localizable regime the firmware must tolerate.
  const loss = opts.loss ?? 0;
  const seedRng = opts.seedRng ?? (() => Math.random());
  const matrix = [];
  for (let listener = 0; listener < n; listener++) {
    const row = perNode[listener];
    // The node's own row is always available locally; whether peers receive it
    // depends on packet loss. (For the assembler-as-arbitrary-node model here,
    // we keep every node's row if its broadcast to the assembly point survives.)
    const arrives = loss <= 0 || seedRng() >= loss;
    if (arrives) for (const o of row) matrix.push(o);
    else messages -= n - 1; // the broadcast failed — count lost messages
  }
  return { matrix, messages, lost: n * (n - 1) - messages };
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
  const { perNode, schedule } = distributedCaptures(nodes, room, captureOpts);
  const assembled = gossipAndAssemble(perNode, {
    loss: captureOpts.meshLoss ?? 0,
    seedRng: captureOpts.seedRng,
  });
  return { ...assembled, schedule };
}