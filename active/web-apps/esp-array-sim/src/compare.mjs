// Side-by-side mode comparison for one fixed room/seed/config.
// Useful in the browser when you want to compare closed vs matched vs
// distributed without hand-flipping controls and losing context.

import { runScenario } from './scenario.mjs';

/**
 * @typedef {{label:string,captureMode:string,distributedMatched:boolean,alignErrorM:number,observations:number,meshMessages:number|null,meshLost:number,converged:boolean,iterations:number}} CompareRow
 */

/**
 * Compare the current scenario settings across the three main top-level modes:
 * closed, matched, and distributed (optionally distributedMatched if enabled in
 * the base config).
 *
 * @param {object} baseCfg runScenario-style config (room, seed, nodeCount, etc.)
 * @returns {CompareRow[]}
 */
export function compareModes(baseCfg = {}) {
  const variants = [
    { label: 'closed', captureMode: 'closed', distributedMatched: false },
    { label: 'matched', captureMode: 'matched', distributedMatched: false },
    {
      label: baseCfg.distributedMatched ? 'distributed+matched' : 'distributed',
      captureMode: 'distributed',
      distributedMatched: !!baseCfg.distributedMatched,
    },
  ];
  return variants.map((v) => {
    const s = runScenario({ ...baseCfg, captureMode: v.captureMode, distributedMatched: v.distributedMatched });
    return {
      label: v.label,
      captureMode: v.captureMode,
      distributedMatched: v.distributedMatched,
      alignErrorM: s.alignErrorM,
      observations: s.observations.length,
      meshMessages: s.meshMessages,
      meshLost: s.meshLost,
      converged: s.solution.converged,
      iterations: s.solution.iterations,
    };
  });
}

/** Human-readable comparison table. */
export function formatComparison(rows) {
  const header = 'mode                 error    obs   msgs   lost   solver';
  const lines = rows.map((r) =>
    `${r.label.padEnd(20)} ${(r.alignErrorM * 100).toFixed(2).padStart(6)}cm   ` +
    `${String(r.observations).padStart(3)}   ${String(r.meshMessages ?? '-').padStart(4)}   ` +
    `${String(r.meshLost ?? '-').padStart(4)}   ` +
    `${r.converged ? 'ok' : 'cap'}:${String(r.iterations).padStart(2)}`,
  );
  return [header, ...lines].join('\n');
}

/** One-line takeaway for the browser UI. */
export function summarizeComparison(rows) {
  if (!rows.length) return 'No comparison results.';
  const best = rows.reduce((a, b) => (a.alignErrorM <= b.alignErrorM ? a : b));
  const dist = rows.find((r) => r.captureMode === 'distributed');
  const distCost = dist ? `; distributed cost ${dist.meshMessages} msgs${dist.meshLost ? `, ${dist.meshLost} lost` : ''}` : '';
  return `Best accuracy: ${best.label} at ${(best.alignErrorM * 100).toFixed(2)} cm${distCost}.`;
}
