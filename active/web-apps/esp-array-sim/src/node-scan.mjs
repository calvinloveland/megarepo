// Sweep node count for one fixed scenario to show how accuracy and calibration
// cost scale together. Complements the separate sizing and latency panels by
// putting both metrics in one report.

import { runScenario } from './scenario.mjs';

/**
 * @typedef {{nodeCount:number,alignErrorM:number,iterations:number,meshMessages:number|null,observations:number}} NodeScanRow
 */

/**
 * @param {object} baseCfg runScenario-style config
 * @param {number[]} [nodeCounts] tested node counts
 * @returns {NodeScanRow[]}
 */
export function scanNodeCounts(baseCfg = {}, nodeCounts = [4, 6, 8, 10, 12]) {
  return nodeCounts.map((nodeCount) => {
    const s = runScenario({ ...baseCfg, nodeCount });
    return {
      nodeCount,
      alignErrorM: s.alignErrorM,
      iterations: s.solution.iterations,
      meshMessages: s.meshMessages,
      observations: s.observations.length,
    };
  });
}

export function formatNodeScan(rows) {
  const header = 'nodes   error    obs   msgs   LM iters';
  const lines = rows.map((r) =>
    `${String(r.nodeCount).padStart(3)}   ${(r.alignErrorM * 100).toFixed(2).padStart(6)}cm   ` +
    `${String(r.observations).padStart(3)}   ${String(r.meshMessages ?? '-').padStart(4)}   ${String(r.iterations).padStart(8)}`,
  );
  return [header, ...lines].join('\n');
}

export function summarizeNodeScan(rows) {
  if (!rows.length) return 'No node-count scan results.';
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `${first.nodeCount}→${last.nodeCount} nodes changes alignment error ${(first.alignErrorM * 100).toFixed(2)}→${(last.alignErrorM * 100).toFixed(2)} cm and observations ${first.observations}→${last.observations}.`;
}
