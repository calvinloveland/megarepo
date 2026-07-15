// High-level scenario orchestration: build a random mesh, run the calibration
// sweep, self-localize, evaluate against truth, and map 5.1 onto the solved
// speakers. Both the UI and the tests drive the simulator through this object so
// the pipeline is defined exactly once (DRY).

import { makeRng, randomLayout, makeEmitSchedule } from './world.mjs';
import { simulateCaptures, simulateMatchedCaptures } from './capture.mjs';
import { distributedSweep } from './mesh.mjs';
import { localizeBest, procrustesAlign } from './localize.mjs';
import { mapSurround, speakerCompensation, CHANNELS_5_1 } from './surround.mjs';

/**
 * Build and run a complete localization scenario.
 *
 * @param {object} cfg
 * @param {number} [cfg.seed]         reproducibility seed (omit for "now")
 * @param {number} [cfg.nodeCount]    number of ESP32 nodes (default 6)
 * @param {{width:number,height:number}} [cfg.room] metres
 * @param {{x:number,y:number}} [cfg.sweetSpot] listener; default = room centre
 * @param {number} [cfg.exponent]     surround cosine-power exponent
 * @param {number} [cfg.distanceLaw]  surround distance compensation
 * @returns {object} scenario bundle
 */
export function runScenario(cfg = {}) {
  const seed = cfg.seed ?? (Math.random() * 1e9) | 0;
  const rng = makeRng(seed);
  const room = cfg.room ?? { width: 6, height: 5 };
  const nodeCount = cfg.nodeCount ?? 6;
  const skewMaxPpm = cfg.clockSkew ? (cfg.skewMaxPpm ?? 50) : 0;
  // Skewed nodes can be present (clockSkew) while the solver ignores skew
  // (estimateSkew:false) — used to show the degradation skew estimation fixes.
  const withSkew = cfg.estimateSkew ?? (!!cfg.clockSkew);

  const nodes = randomLayout(nodeCount, room, rng, undefined, undefined, { skewMaxPpm });
  const schedule = makeEmitSchedule(nodes);
  // 'distributed' runs the same capture+estimator but models the mesh data flow:
  // each node only sees its own microphone arrivals, gossips them, the assembler
  // reconstitutes the full observation matrix. The resulting matrix is identical
  // to the centralized one; the cost is tracked as meshMessages.
  const dist = cfg.captureMode === 'distributed'
    ? distributedSweep(nodes, room, {
        captureMode: 'closed',
        ...cfg.distributedMatched ? { captureMode: 'matched', room, wallReflections: cfg.wallReflections ?? true, reflCoef: cfg.reflCoef ?? 0.5, noiseSigma: cfg.noiseSigma ?? 0.05, estimatorMode: cfg.estimatorMode ?? (cfg.earliestPeak ? 'earliest' : 'strongest') } : {},
      })
    : null;
  const observations =
    dist ? dist.matrix
    : cfg.captureMode === 'matched'
      ? simulateMatchedCaptures(nodes, schedule, {
          room,
          wallReflections: cfg.wallReflections ?? true,
          reflCoef: cfg.reflCoef ?? 0.5,
          maxOrder: cfg.maxOrder ?? 1,
          occluders: cfg.occluders ?? [],
          noiseSigma: cfg.noiseSigma ?? 0.05,
          estimatorMode: cfg.estimatorMode ?? (cfg.earliestPeak ? 'earliest' : 'strongest'),
          peakThreshold: cfg.peakThreshold ?? 0.5,
        })
      : simulateCaptures(nodes, schedule);
  const meshMessages = dist ? dist.messages : null;

  const sol = localizeBest(observations, nodes.length, room, {
    starts: cfg.starts ?? 8,
    seedRng: rng, // deterministic restarts -> reproducible scenarios
    withSkew,
    robust: cfg.robust ?? 0,
  });
  const truth = nodes.map((n) => ({ x: n.pos.x, y: n.pos.y }));

  // Pure acoustic TDOA can't distinguish a layout from its mirror image across
  // the anchor axis (N0–N1), so the solver may land on either chirality. We
  // Procrustes-align both candidates to the truth and keep the lower-error one
  // for evaluation. Real firmware resolves handedness from a known cue (a
  // designated "front" anchor / the wall the TV is on); the simulator gets that
  // cue from ground truth. This is the only place truth is used to pick the
  // solution — it does NOT inform the positions themselves.
  const mirrored = sol.pos.map((p) => ({ x: p.x, y: -p.y }));
  const a1 = procrustesAlign(sol.pos, truth);
  const a2 = procrustesAlign(mirrored, truth);
  const { aligned, errorM, R, t, mirror } =
    a2.errorM < a1.errorM
      ? { ...a2, mirror: true }
      : { ...a1, mirror: false };

  const sweetSpot = cfg.sweetSpot ?? { x: room.width / 2, y: room.height / 2 };
  const realSpeakers = aligned.map((p, i) => ({ id: nodes[i].label, pos: { x: p.x, y: p.y } }));
  const surround = mapSurround(realSpeakers, sweetSpot, {
    exponent: cfg.exponent,
    distanceLaw: cfg.distanceLaw,
  });
  const compensation = speakerCompensation(realSpeakers, sweetSpot);

  return {
    seed,
    room,
    captureMode: cfg.captureMode ?? 'closed',
    reflCoef: cfg.reflCoef ?? 0.5,
    nodes,
    schedule,
    observations,
    solution: sol,
    truth,
    aligned,
    transform: { R, t, mirror },
    alignErrorM: errorM,
    sweetSpot,
    realSpeakers,
    surround,
    compensation,
    channels: CHANNELS_5_1,
    clockOffsetsTrue: nodes.map((n) => n.clockOffsetSec),
    clockOffsetsEst: sol.off,
    clockSkewsTrue: nodes.map((n) => n.clockSkew),
    clockSkewsEst: sol.skew ?? nodes.map(() => 0),
    withSkew,
    distributed: cfg.captureMode === 'distributed',
    meshMessages,
  };
}