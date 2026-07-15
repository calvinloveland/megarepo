// Statistical evaluation harness: run the localization pipeline across a
// parameter grid (node counts, wall-reflection coefficients, capture modes)
// and summarize accuracy so we can decide when the algorithm is "ready for
// hardware" without running on hardware. Deterministic — every cell uses a
// fixed seed and repeats to estimate a worst-case/error percentile.

import { runScenario } from './scenario.mjs';

/**
 * @typedef {Object} SweepCell
 * @property {number} nodeCount
 * @property {string} captureMode
 * @property {number} reflCoef
 * @property {number} trials       number of runs aggregated
 * @property {number} medianErrM  median alignment error (m)
 * @property {number} p90ErrM     90th-percentile alignment error (m)
 * @property {number} worstErrM   worst alignment error (m)
 * @property {number} successRate  fraction of trials within `successM`
 */

const DEFAULT_SUCCESS_M = 0.10;

/**
 * @param {object} cfg
 * @param {number[]} [cfg.nodeCounts]      e.g. [4,6,8,10]
 * @param {string[]} [cfg.captureModes]   e.g. ['closed','matched']
 * @param {number[]} [cfg.reflCoefs]       e.g. [0.0, 0.3, 0.6]
 * @param {number} [cfg.trials]           runs per cell (distinct seeds)
 * @param {number} [cfg.roomW]
 * @param {number} [cfg.roomH]
 * @param {number} [cfg.seedBase]         first seed; increment per trial
 * @param {number} [cfg.successM]         threshold for successRate
 * @param {object} [cfg.extra]            passed to runScenario (e.g. {robust, earliestPeak})
 * @returns {SweepCell[]}
 */
export function runSweep(cfg = {}) {
  const nodeCounts = cfg.nodeCounts ?? [4, 6, 8];
  const captureModes = cfg.captureModes ?? ['closed', 'matched'];
  const reflCoefs = cfg.reflCoefs ?? [0.0, 0.3, 0.6];
  const trials = cfg.trials ?? 10;
  const room = { width: cfg.roomW ?? 8, height: cfg.roomH ?? 6 };
  const seedBase = cfg.seedBase ?? 1000;
  const successM = cfg.successM ?? DEFAULT_SUCCESS_M;

  const cells = [];
  for (const nodeCount of nodeCounts) {
    for (const captureMode of captureModes) {
      for (const reflCoef of reflCoefs) {
        const errs = [];
        let successes = 0;
        for (let t = 0; t < trials; t++) {
          const s = runScenario({
            nodeCount,
            captureMode,
            reflCoef,
            room,
            seed: seedBase + t,
            noiseSigma: captureMode === 'matched' ? 0.05 : undefined,
            ...cfg.extra,
          });
          errs.push(s.alignErrorM);
          if (s.alignErrorM <= successM) successes++;
        }
        errs.sort((a, b) => a - b);
        cells.push({
          nodeCount,
          captureMode,
          reflCoef,
          trials,
          medianErrM: percentile(errs, 0.5),
          p90ErrM: percentile(errs, 0.9),
          worstErrM: errs[errs.length - 1],
          successRate: successes / trials,
        });
      }
    }
  }
  return cells;
}

/** Linear-interpolated percentile of a sorted-ascending array. */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** One-line printable report from runSweep cells (for a CLI / the UI summary). */
export function formatSweep(cells) {
  const header = 'nodes  mode      refl    median   p90      worst   success';
  const lines = cells.map((c) =>
    `${String(c.nodeCount).padStart(3)}   ${c.captureMode.padEnd(7)}   ` +
    `${c.reflCoef.toFixed(2)}    ${(c.medianErrM * 100).toFixed(1)}cm   ` +
    `${(c.p90ErrM * 100).toFixed(1)}cm   ${(c.worstErrM * 100).toFixed(1)}cm   ` +
    `${(c.successRate * 100).toFixed(0)}%`,
  );
  return [header, ...lines].join('\n');
}