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

import { distance, propagationDelay, gaussianNoise, SPEED_OF_SOUND } from './acoustics.mjs';
import { arrivalPaths, segmentHitsRect } from './room.mjs';
import { linearChirp, estimateTOA, placeTemplate } from './dsp.mjs';

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

/** Default chirp template shared by every emission in matched-filter mode. */
export const DEFAULT_CHIRP = linearChirp({
  durationSec: 0.002, f0Hz: 3000, f1Hz: 8000, sampleRateHz: 48000, window: true,
});
export const DEFAULT_SAMPLE_RATE = 48000;

/**
 * Build one (emitter → listener) captured waveform and estimate its TOA with the
 * matched filter from dsp.mjs. The arrival the algorithm sees is whatever the
 * estimator returns — the *loud* peak, which is the direct path only when it is
 * both loud *and* present. Occluders can drop the direct so a reflection wins.
 *
 * This is the realistic capture path; `simulateCaptures` is the closed-form
 * "perfect estimator" baseline used to isolate solver behaviour.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{emitterId:number,emitClockSec:number}[]} schedule
 * @param {object} [opts]
 * @param {boolean} [opts.wallReflections] include image-source echoes (default true)
 * @param {number}  [opts.reflCoef] wall reflection coefficient in (0,1] (default 0.5)
 * @param {number}  [opts.maxOrder] image-source reflection order (default 1)
 * @param {{width:number,height:number}} [opts.room] room bbox (required for wall echoes)
 * @param {Rect[]}  [opts.occluders] axis-aligned blocking rectangles that drop the direct path
 * @param {number}  [opts.noiseSigma] additive capture noise amplitude (default 0.05)
 * @param {Float64Array} [opts.chirp]
 * @param {number}  [opts.sampleRateHz]
 * @returns {Observation[]} one per (emission × listener), arrivalClockSec from the estimator
 */
export function simulateMatchedCaptures(nodes, schedule, opts = {}) {
  const room = opts.room ?? { width: 6, height: 5 };
  const wallReflections = opts.wallReflections ?? true;
  const reflCoef = opts.reflCoef ?? 0.5;
  const maxOrder = opts.maxOrder ?? 1;
  const occluders = opts.occluders ?? [];
  const noiseSigma = opts.noiseSigma ?? 0.05;
  const chirp = opts.chirp ?? DEFAULT_CHIRP;
  const sr = opts.sampleRateHz ?? DEFAULT_SAMPLE_RATE;
  const c = SPEED_OF_SOUND;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const obs = [];
  for (const ev of schedule) {
    const s = byId.get(ev.emitterId);
    for (const li of nodes) {
      const self = s.id === li.id;
      let paths, directDistM;
      if (self) {
        // self-listen: tiny fixed self-path, no free-field echoes modelled
        directDistM = li.selfPath;
        paths = [{ delaySec: directDistM / c, amplitude: 1, kind: 'direct', order: 0 }];
      } else {
        directDistM = distance(s.pos, li.pos);
        paths = arrivalPaths(s.pos, li.pos, room, reflCoef, maxOrder, c);
        // drop the direct if an occluder blocks line of sight (NLO)
        const blocked = occluders.some((r) => segmentHitsRect(s.pos, li.pos, r));
        if (blocked) paths = paths.filter((p) => p.kind !== 'direct');
        else if (!wallReflections) paths = paths.filter((p) => p.kind === 'direct');
      }
      obs.push(buildObservation(s, li, ev, paths, chirp, sr, noiseSigma, c, opts));
    }
  }
  return obs;
}

/** Derive a rectangular room bbox from node spread (used when none is supplied). */
function roomFor(nodes) {
  let maxX = 0, maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.pos.x);
    maxY = Math.max(maxY, n.pos.y);
  }
  return { width: maxX + 0.5, height: maxY + 0.5 };
}

/** Build the waveform for one pair, estimate TOA, return an Observation. */
function buildObservation(s, li, ev, paths, chirp, sr, noiseSigma, c, captureOpts = {}) {
  // waveform spans the latest arrival + chirp tail + a couple samples of slack
  const maxDelay = paths.reduce((m, p) => Math.max(m, p.delaySec), 0);
  const len = Math.ceil((maxDelay + chirp.length / sr) * sr) + 4;
  const sig = new Float64Array(len);
  for (const p of paths) {
    const lag = p.delaySec * sr;
    placeTemplate(sig, chirp, lag, p.amplitude);
  }
  // additive capture noise (deterministic per emitter/listener pair)
  const rng = makeLocalRng(s.id, li.id);
  for (let i = 0; i < sig.length; i++) sig[i] += (rng() * 2 - 1) * noiseSigma;
  const { timeSec } = estimateTOA(sig, chirp, sr, {
    mode: captureOpts.estimatorMode ?? 'strongest',
    peakThreshold: captureOpts.peakThreshold ?? 0.5,
  });
  return {
    emitterId: s.id,
    listenerId: li.id,
    distanceM: s.id === li.id ? li.selfPath : distance(s.pos, li.pos),
    emitClockSec: ev.emitClockSec,
    arrivalClockSec: ev.emitClockSec + timeSec + li.clockOffsetSec,
    // diagnostic: the arrivals the estimator had to choose among
    arrivalPaths: paths.map((p) => ({ delaySec: p.delaySec, amplitude: p.amplitude, kind: p.kind })),
    estimatedDirectSec: timeSec,
  };
}

/**
 * @typedef {{minX:number,minY:number,maxX:number,maxY:number}} Rect
 */