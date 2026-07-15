// Solver performance benchmark: measure localization wall-clock per node count
// so we can prove the joint LM stays well within a one-time calibration budget
// and catch perf regressions. The eventual ESP32 mesh runs this once per seating
// change, not per audio frame, so the budget is generous (seconds, not ms) — but
// a 10× regression would still flag a real problem here.

import { runScenario } from './scenario.mjs';

/**
 * @typedef {Object} BenchPoint
 * @property {number} nodeCount
 * @property {number} avgMs       mean wall-clock per run (ms)
 * @property {number} worstMs     worst wall-clock per run (ms)
 * @property {number} iterations  mean LM iterations across runs
 * @property {number} alignErrorM mean alignment error (m) — sanity that we still solve
 */

/**
 * @param {object} cfg
 * @param {number[]} [cfg.nodeCounts]   default [4,6,8,10,12]
 * @param {number} [cfg.repeats]        runs per node count (averaged)
 * @param {number} [cfg.roomW]          room width passed to runScenario
 * @param {number} [cfg.roomH]          room height passed to runScenario
 * @param {object} [cfg.scenarioOpts]   passed to runScenario (captureMode, robust, etc.)
 * @returns {BenchPoint[]}
 */
export function runBench(cfg = {}) {
  const nodeCounts = cfg.nodeCounts ?? [4, 6, 8, 10, 12];
  const repeats = cfg.repeats ?? 3;
  const room = { width: cfg.roomW ?? 8, height: cfg.roomH ?? 6 };
  const so = cfg.scenarioOpts ?? {
    captureMode: 'matched', reflCoef: 0.3, noiseSigma: 0.05,
    earliestPeak: true, robust: 5e-5, starts: 8,
  };
  const out = [];
  for (const nodeCount of nodeCounts) {
    const times = [];
    let iters = 0, err = 0;
    for (let r = 0; r < repeats; r++) {
      const t0 = process.hrtime.bigint();
      const s = runScenario({ ...so, nodeCount, seed: 100 + r, room });
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      iters += s.solution.iterations;
      err += s.alignErrorM;
    }
    out.push({
      nodeCount,
      avgMs: times.reduce((a, b) => a + b, 0) / repeats,
      worstMs: Math.max(...times),
      iterations: Math.round(iters / repeats),
      alignErrorM: err / repeats,
    });
  }
  return out;
}

/** Human-readable benchmark report. */
export function formatBench(points) {
  const header = 'nodes   avg ms   worst ms   LM iters   error';
  const lines = points.map((p) =>
    `${String(p.nodeCount).padStart(3)}    ${p.avgMs.toFixed(1).padStart(7)}   ` +
    `${p.worstMs.toFixed(1).padStart(8)}   ${String(p.iterations).padStart(8)}   ` +
    `${(p.alignErrorM * 100).toFixed(2)}cm`,
  );
  return [header, ...lines].join('\n');
}

/** One-line UI takeaway from runBench(). */
export function summarizeBench(points) {
  if (!points.length) return 'No benchmark results.';
  const worst = points.reduce((a, b) => (a.worstMs >= b.worstMs ? a : b));
  const ceiling = Math.max(...points.map((p) => p.worstMs));
  return `Worst calibration solve ${ceiling.toFixed(0)} ms at ${worst.nodeCount} nodes; all tested counts stayed under ${(ceiling / 1000).toFixed(2)} s.`;
}
