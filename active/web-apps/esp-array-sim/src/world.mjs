// World model: the room and the ESP32 mesh nodes.
//
// A MeshNode is one ESP32 with a speaker and a microphone. Each node has a
// true (simulator-only) position, plus a per-node clock model. In hardware
// the nodes first perform a coarse clock-sync over WiFi; we model the *residual*
// clock offset after that sync as a small Gaussian bias that acoustic TDOA must
// tolerate (and that the joint solver estimates as a nuisance variable).

import { SELF_PATH } from './acoustics.mjs';
import { DEFAULT_CALIBRATION_CONFIG } from './calibration-config.mjs';

/**
 * @typedef {Object} Vec2
 * @property {number} x metres
 * @property {number} y metres
 */

/** Deterministic seedable PRNG (mulberry32) so scenarios are reproducible. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @returns {Vec2} */
export function vec(x, y) {
  return { x, y };
}

/**
 * @typedef {Object} MeshNode
 * @property {number} id              0-based index, also its emitter id
 * @property {string} label          short label like "N0"
 * @property {Vec2} pos              true position in metres (simulator only)
 * @property {number} clockOffsetSec  residual offset of this node's clock after WiFi sync
 * @property {number} clockSkew      fractional clock-rate error vs shared time (e.g. 50e-6)
 * @property {number} micJitterSec   per-arrival timing noise (imperfect TOA estimation)
 * @property {number} selfPath       speaker→own-mic path length (m)
 */

/**
 * Random-but-spread layout inside a room. Nodes are placed with a min separation
 * so no two coincide. The layout is "random throughout the room" exactly as a
 * user would scatter the boxes.
 *
 * @param {number} count
 * @param {{width:number,height:number}} room metres
 * @param {function} rng
 * @param {number} [marginM] keep nodes off the walls
 * @param {number} [minSepM] minimum node-to-node separation
 * @param {object} [opts] { skewMaxPpm?: number } per-node clock-skew range
 * @returns {MeshNode[]}
 */
export function randomLayout(count, room, rng, marginM = 0.6, minSepM = 0.8, opts = {}) {
  const nodes = [];
  let attempts = 0;
  while (nodes.length < count && attempts < 10000) {
    attempts++;
    const x = marginM + rng() * (room.width - 2 * marginM);
    const y = marginM + rng() * (room.height - 2 * marginM);
    if (nodes.every((n) => Math.hypot(n.pos.x - x, n.pos.y - y) >= minSepM)) {
      nodes.push(makeNode(nodes.length, x, y, rng, { skewMaxPpm: opts.skewMaxPpm ?? 0 }));
    }
  }
  if (nodes.length < count) {
    throw new Error(
      `Could not place ${count} nodes with minSep ${minSepM}m in this room`,
    );
  }
  return nodes;
}

/** Build a single node. */
export function makeNode(id, x, y, rng, opts = {}) {
  const skewMaxPpm = opts.skewMaxPpm ?? 0;
  const selfPath = opts.selfPath ?? SELF_PATH;
  return {
    id,
    label: `N${id}`,
    pos: { x, y },
    // residual clock offset after WiFi sync: ±0.1 ms ≈ ±3.4 cm equiv.
    clockOffsetSec: (rng() * 2 - 1) * 1e-4,
    // residual clock-rate (skew) error: ±skewMaxPpm ppm of the shared clock.
    // Firmware multi-source this from crystal tolerance; estimating it from the
    // sweep is what this option exercises.
    clockSkew: (rng() * 2 - 1) * skewMaxPpm * 1e-6,
    micJitterSec: 2e-5, // 20µs TOA estimation jitter ≈ 7 mm
    selfPath,
  };
}

/**
 * Round-robin emission schedule: each node emits one chirp in turn, spaced far
 * enough apart that reverberation has died before the next emission.
 *
 * @param {MeshNode[]} nodes
 * @param {number} [gapSec] silence between emissions
 * @returns {{emitterId:number, emitClockSec:number}[]} emit times on the shared clock
 */
export function makeEmitSchedule(nodes, gapSec = DEFAULT_CALIBRATION_CONFIG.gapSec) {
  const sched = [];
  let t = DEFAULT_CALIBRATION_CONFIG.firstEmitSec;
  for (const n of nodes) {
    sched.push({ emitterId: n.id, emitClockSec: t });
    t += gapSec;
  }
  return sched;
}