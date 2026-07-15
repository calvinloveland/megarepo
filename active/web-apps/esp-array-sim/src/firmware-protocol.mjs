// Firmware-oriented packet shapes for the distributed calibration flow.
// The simulator is NOT an ESP32 hardware emulator, but these contracts make
// the distributed path speak in message shapes that can map directly onto
// future ESP-IDF tasks / mesh packets.

import {
  DEFAULT_CALIBRATION_CHIRP_OPTIONS,
  DEFAULT_CALIBRATION_CONFIG,
} from './calibration-config.mjs';

export const DEFAULT_CHIRP_CONFIG = DEFAULT_CALIBRATION_CHIRP_OPTIONS;

/** Build a firmware-shaped calibration plan from the simulator's emit schedule. */
export function makeCalibrationPlan(schedule, opts = {}) {
  return {
    kind: 'calibration-plan-v1',
    sweepId: opts.sweepId ?? 'sim-sweep',
    gapSec: opts.gapSec ?? DEFAULT_CALIBRATION_CONFIG.gapSec,
    chirp: { ...DEFAULT_CHIRP_CONFIG, ...(opts.chirp ?? {}) },
    emissions: schedule.map((e) => ({ emitterId: e.emitterId, emitClockSec: e.emitClockSec })),
  };
}

/**
 * Convert one listener-row matrix view per node into firmware-shaped row packets.
 * Optional matched-capture diagnostics are preserved when present.
 */
export function rowsToListenerPackets(perNode, opts = {}) {
  const sweepId = opts.sweepId ?? 'sim-sweep';
  return perNode.map((row) => ({
    kind: 'listener-row-v1',
    sweepId,
    listenerId: row[0]?.listenerId ?? null,
    arrivals: row.map((o) => ({
      emitterId: o.emitterId,
      emitClockSec: o.emitClockSec,
      arrivalClockSec: o.arrivalClockSec,
      distanceM: o.distanceM,
      ...(o.estimatedDirectSec != null ? { estimatedDirectSec: o.estimatedDirectSec } : {}),
      ...(o.arrivalPaths ? { arrivalPaths: o.arrivalPaths } : {}),
      ...(o.shots ? { shots: o.shots } : {}),
    })),
  }));
}

/** Reconstruct the observation matrix from listener-row packets. */
export function listenerPacketsToMatrix(packets) {
  const out = [];
  for (const p of packets) {
    for (const a of p.arrivals) {
      out.push({
        emitterId: a.emitterId,
        listenerId: p.listenerId,
        emitClockSec: a.emitClockSec,
        arrivalClockSec: a.arrivalClockSec,
        distanceM: a.distanceM,
        ...(a.estimatedDirectSec != null ? { estimatedDirectSec: a.estimatedDirectSec } : {}),
        ...(a.arrivalPaths ? { arrivalPaths: a.arrivalPaths } : {}),
        ...(a.shots ? { shots: a.shots } : {}),
      });
    }
  }
  return out;
}

/** Full-broadcast cost for one packet per node. */
export function broadcastCostForPackets(packets) {
  const n = packets.length;
  return n * (n - 1);
}

/**
 * Simulate one gossip round at the PACKET level: each node broadcasts its
 * listener-row packet, some may be lost, and the assembler rebuilds the matrix
 * from the surviving packets.
 */
export function gossipPacketsAndAssemble(packets, opts = {}) {
  const total = broadcastCostForPackets(packets);
  const loss = opts.loss ?? 0;
  const seedRng = opts.seedRng ?? (() => Math.random());
  const delivered = [];
  let lostPackets = 0;
  for (const p of packets) {
    if (loss > 0 && seedRng() < loss) lostPackets++;
    else delivered.push(p);
  }
  const lostMessages = lostPackets * Math.max(0, packets.length - 1);
  return {
    packets: delivered,
    matrix: listenerPacketsToMatrix(delivered),
    messages: total - lostMessages,
    lost: lostMessages,
  };
}
