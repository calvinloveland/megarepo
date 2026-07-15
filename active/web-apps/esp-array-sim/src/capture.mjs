// Capture simulation: emulates what each node microphone records during the
// calibration sweep, *before* any localization has run.
//
// Model (the thing the algorithm must invert):
//   for emission e from source node s at shared-clock time T_e,
//   arrival at listener i on the shared clock is
//       a_{e,i} = T_e + dist(s,i) / c  +  offset_i  +  jitter
//
// `offset_i` is the node's residual clock bias after WiFi sync — the same for
// every emission, so it acts as a per-listener nuisance the solver estimates.
// `jitter` is independent per arrival (TOA estimation error in the chirp
// cross-correlation, multipath, etc.). `s` itself records its own speaker via a
// tiny fixed self-path, anchoring each emission's source to a node position.

import { distance, propagationDelay, gaussianNoise } from './acoustics.mjs';

/**
 * An observation = one emission heard by one listener.
 * @typedef {Object} Observation
 * @property {number} emitterId
 * @property {number} listenerId
 * @property {number} distanceM       true emitter→listener distance (debug)
 * @property {number} arrivalClockSec  measured arrival on the shared clock (what the algorithm sees)
 */

/**
 * Simulate the full capture set for a schedule.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{emitterId:number,emitClockSec:number}[]} schedule
 * @returns {Observation[]} one entry per (emission × listener) pair
 */
export function simulateCaptures(nodes, schedule) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const obs = [];
  for (const ev of schedule) {
    const s = byId.get(ev.emitterId);
    for (const li of nodes) {
      // The emitter listens to its own speaker through the self-path; everyone
      // else hears it over the air.
      const d = s.id === li.id ? li.selfPath : distance(s.pos, li.pos);
      const base = ev.emitClockSec + propagationDelay(d);
      const jitter = gaussianNoise(makeLocalRng(ev.emitterId, li.id), li.micJitterSec);
      obs.push({
        emitterId: s.id,
        listenerId: li.id,
        distanceM: d,
        arrivalClockSec: base + li.clockOffsetSec + jitter,
        emitClockSec: ev.emitClockSec,
      });
    }
  }
  return obs;
}

/**
 * A cheap deterministic per-pair noise source so captures are reproducible
 * across runs with the same layout. Uses part of the emitter/listener ids as
 * seed — far from cryptographic, just stable for tests.
 */
function makeLocalRng(a, b) {
  let s = ((a + 1) * 73856093) ^ ((b + 1) * 19349663) ^ 0x9e3779b9;
  s = s >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}