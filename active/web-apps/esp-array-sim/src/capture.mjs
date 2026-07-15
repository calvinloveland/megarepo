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
import { makeEmitSchedule } from './world.mjs';
import { linearChirp, estimateTOA, placeTemplate } from './dsp.mjs';
import { DEFAULT_CALIBRATION_CHIRP_OPTIONS } from './calibration-config.mjs';

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
export function simulateCaptures(nodes, schedule, opts = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shotIdx = opts.shotIdx ?? 0;
  const obs = [];
  for (const ev of schedule) {
    const s = byId.get(ev.emitterId);
    for (const li of nodes) {
      // The emitter listens to its own speaker through the self-path; everyone
      // else hears it over the air.
      const d = s.id === li.id ? li.selfPath : distance(s.pos, li.pos);
      const base = ev.emitClockSec + propagationDelay(d);
      const jitter = gaussianNoise(makeLocalRng(ev.emitterId, li.id, shotIdx), li.micJitterSec);
      // Listener clock = offset_i + (1 + skew_i) * true_time, so the recorded
      // arrival is offset + (1+skew)·base. With skew=0 this is the old formula.
      obs.push({
        emitterId: s.id,
        listenerId: li.id,
        distanceM: d,
        arrivalClockSec: li.clockOffsetSec + (1 + li.clockSkew) * base + jitter,
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
function makeLocalRng(a, b, shotIdx = 0) {
  let s = ((a + 1) * 73856093) ^ ((b + 1) * 19349663) ^ 0x9e3779b9 ^ ((shotIdx + 1) * 2654435761);
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
export const DEFAULT_CHIRP = linearChirp({ ...DEFAULT_CALIBRATION_CHIRP_OPTIONS });
export const DEFAULT_SAMPLE_RATE = DEFAULT_CALIBRATION_CHIRP_OPTIONS.sampleRateHz;

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
export function simulateMatchedCaptures(nodes, schedule, opts) {
  const shotIdx = opts.shotIdx ?? 0;
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
      obs.push(buildObservation(s, li, ev, paths, chirp, sr, noiseSigma, c, opts, shotIdx));
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
function buildObservation(s, li, ev, paths, chirp, sr, noiseSigma, c, captureOpts = {}, shotIdx = 0) {
  // waveform spans the latest arrival + chirp tail + a couple samples of slack
  const maxDelay = paths.reduce((m, p) => Math.max(m, p.delaySec), 0);
  const len = Math.ceil((maxDelay + chirp.length / sr) * sr) + 4;
  const sig = new Float64Array(len);
  for (const p of paths) {
    const lag = p.delaySec * sr;
    placeTemplate(sig, chirp, lag, p.amplitude);
  }
  // additive capture noise (deterministic per emitter/listener pair)
  const rng = makeLocalRng(s.id, li.id, shotIdx);
  for (let i = 0; i < sig.length; i++) sig[i] += (rng() * 2 - 1) * noiseSigma;
  const { timeSec } = estimateTOA(sig, chirp, sr, {
    mode: captureOpts.estimatorMode ?? 'strongest',
    peakThreshold: captureOpts.peakThreshold ?? 0.5,
  });
  // Matched mode approximates the skewed listener clock by applying (1+skew)
  // to the (emit + estimated true delay) time base, consistent with the
  // closed-form capture's model.
  const arrival = li.clockOffsetSec + (1 + li.clockSkew) * (ev.emitClockSec + timeSec);
  return {
    emitterId: s.id,
    listenerId: li.id,
    distanceM: s.id === li.id ? li.selfPath : distance(s.pos, li.pos),
    emitClockSec: ev.emitClockSec,
    arrivalClockSec: arrival,
    // diagnostic: the arrivals the estimator had to choose among
    arrivalPaths: paths.map((p) => ({ delaySec: p.delaySec, amplitude: p.amplitude, kind: p.kind })),
    estimatedDirectSec: timeSec,
  };
}

/**
 * @typedef {{minX:number,minY:number,maxX:number,maxY:number}} Rect
 */
/** Median across `shots` numbers (robust to outlier shots). */
function medianArrival(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/**
 * Repeat-emission averaging: run `shots` independent captures of the same sweep
 * (independent jitter+noise per shot) and report the MEDIAN arrival time per
 * (emitter, listener). Median — not mean — rejects occasional shot-level
 * outliers, which is exactly what the firmware's repeated-chirp calibration mode
 * is for: turn single-shot ~few-cm matched-filter jitter into a much tighter
 * estimate. Returns one Observation per (emission × listener) like
 * simulateCaptures/simulateMatchedCaptures, with per-shot times in `shots`.
 *
 * Works for either capture path (closed or matched) by re-running the chosen
 * simulate* function shots times. The schedule/seeding is identical across
 * shots so the emit times line up; only the per-shot noise differs via a
 * per-shot seed perturbation passed through opts.shotSeed.
 *
 * @param {import('./world.mjs').MeshNode[]} nodes
 * @param {{width:number,height:number}} room
 * @param {object} opts { shots, captureMode, ...passthrough }
 * @returns {Observation[]}
 */
export function averagedCaptures(nodes, room, opts = {}) {
  const shots = opts.shots ?? 3;
  const captureMode = opts.captureMode ?? 'closed';
  const schedule = makeEmitSchedule(nodes);
  const perShot = [];
  for (let k = 0; k < shots; k++) {
    // Each shot uses the same schedule but a distinct per-shot noise seed
    // (shotIdx), so the jitter/echo draws differ across shots — the realistic
    // repeated-chirp model. We don't shift the clock.
    const shotSchedule = schedule;
    const obs =
      captureMode === 'matched'
        ? simulateMatchedCaptures(nodes, shotSchedule, { room, ...opts, shotIdx: k })
        : simulateCaptures(nodes, shotSchedule, { shotIdx: k });
    // normalise the emit-clock shift out so medians are comparable
    perShot.push(obs);
  }
  // average across shots per (emitter, listener) slot
  const byKey = new Map();
  for (let k = 0; k < shots; k++) {
    for (const o of perShot[k]) {
      const key = `${o.emitterId}-${o.listenerId}`;
      if (!byKey.has(key)) byKey.set(key, { first: o, times: [], distances: [] });
      const slot = byKey.get(key);
      slot.times.push(o.arrivalClockSec);
      slot.distances.push(o.distanceM);
    }
  }
  const out = [];
  for (const slot of byKey.values()) {
    out.push({
      emitterId: slot.first.emitterId,
      listenerId: slot.first.listenerId,
      distanceM: slot.first.distanceM,
      emitClockSec: slot.first.emitClockSec,
      arrivalClockSec: medianArrival(slot.times),
      shots: slot.times,
    });
  }
  return out;
}
