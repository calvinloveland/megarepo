// Simulator-side firmware backend boundary.
// This is NOT hardware emulation. It is an interface shaped like the eventual
// ESP-IDF responsibilities so the current scenario/mesh flow can run against
// explicit backend hooks now, and real firmware implementations later.

import { simulateCaptures, simulateMatchedCaptures } from './capture.mjs';
import { makeEmitSchedule } from './world.mjs';
import {
  makeCalibrationPlan as makeProtocolCalibrationPlan,
  rowsToListenerPackets,
  gossipPacketsAndAssemble,
} from './firmware-protocol.mjs';
import { DEFAULT_CALIBRATION_CONFIG } from './calibration-config.mjs';

export function assertFirmwareBackend(backend) {
  for (const name of ['syncClocks', 'makeCalibrationPlan', 'captureListenerRows', 'gossipListenerRows']) {
    if (typeof backend?.[name] !== 'function') throw new Error(`invalid firmware backend: missing ${name}()`);
  }
  return backend;
}

/**
 * Default simulator implementation of the firmware backend hooks.
 *
 * Responsibilities mirror a future ESP-IDF node coordinator:
 * - coarse clock sync
 * - calibration chirp plan generation
 * - per-node listener-row capture
 * - row gossip / packet loss
 */
export function makeSimFirmwareBackend(room, opts = {}) {
  return {
    kind: 'sim-firmware-backend-v1',
    syncClocks(nodes) {
      return {
        assumedSynced: true,
        nodeIds: nodes.map((n) => n.id),
        // residual offset/skew are still modeled inside world.mjs / localizer;
        // this hook exists so firmware can later replace the assumption.
        residualModel: 'world.mjs',
      };
    },
    makeCalibrationPlan(nodes) {
      const schedule = makeEmitSchedule(nodes, opts.gapSec ?? DEFAULT_CALIBRATION_CONFIG.gapSec);
      return {
        schedule,
        plan: makeProtocolCalibrationPlan(schedule, {
          sweepId: opts.sweepId,
          gapSec: opts.gapSec,
          chirp: opts.chirp,
        }),
      };
    },
    captureListenerRows(nodes, planBundle) {
      const schedule = planBundle.schedule ?? planBundle.plan?.emissions ?? [];
      const all =
        opts.captureMode === 'matched'
          ? simulateMatchedCaptures(nodes, schedule, { room, ...opts })
          : simulateCaptures(nodes, schedule);
      const perNode = nodes.map((n) => all.filter((o) => o.listenerId === n.id));
      const rowPackets = rowsToListenerPackets(perNode, {
        sweepId: planBundle.plan?.sweepId ?? opts.sweepId ?? 'sim-sweep',
      });
      return { perNode, rowPackets };
    },
    gossipListenerRows(rowPackets) {
      return gossipPacketsAndAssemble(rowPackets, {
        loss: opts.meshLoss ?? 0,
        seedRng: opts.seedRng,
      });
    },
  };
}

/** Run one full distributed calibration pass through a backend implementation. */
export function runDistributedWithBackend(nodes, backend) {
  assertFirmwareBackend(backend);
  const sync = backend.syncClocks(nodes);
  const { schedule, plan } = backend.makeCalibrationPlan(nodes);
  const { perNode, rowPackets } = backend.captureListenerRows(nodes, { schedule, plan });
  const assembled = backend.gossipListenerRows(rowPackets);
  return {
    sync,
    schedule,
    plan,
    perNode,
    rowPackets,
    ...assembled,
  };
}
