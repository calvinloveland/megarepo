// Sweep matched-capture noise sigma over a fixed scenario so the UI can show
// how localization degrades as the mic captures get noisier.

import { runScenario } from './scenario.mjs';

/**
 * @typedef {{noiseSigma:number,alignErrorM:number,observations:number,converged:boolean,iterations:number}} NoiseScanRow
 */

/**
 * @param {object} baseCfg runScenario-style config
 * @param {number[]} [sigmas] noise σ values to test
 * @returns {NoiseScanRow[]}
 */
export function scanNoiseSensitivity(baseCfg = {}, sigmas = [0, 0.02, 0.05, 0.1, 0.2]) {
  return sigmas.map((noiseSigma) => {
    const s = runScenario({ ...baseCfg, noiseSigma });
    return {
      noiseSigma,
      alignErrorM: s.alignErrorM,
      observations: s.observations.length,
      converged: s.solution.converged,
      iterations: s.solution.iterations,
    };
  });
}

export function formatNoiseScan(rows) {
  const header = 'noise σ   error    obs   solver';
  const lines = rows.map((r) =>
    `${r.noiseSigma.toFixed(2).padStart(7)}   ${(r.alignErrorM * 100).toFixed(2).padStart(6)}cm   ` +
    `${String(r.observations).padStart(3)}   ${r.converged ? 'ok' : 'cap'}:${String(r.iterations).padStart(2)}`,
  );
  return [header, ...lines].join('\n');
}

export function summarizeNoiseScan(rows) {
  if (!rows.length) return 'No noise-sensitivity results.';
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `Noise σ ${(first.noiseSigma).toFixed(2)}→${(last.noiseSigma).toFixed(2)} changes alignment error ${(first.alignErrorM * 100).toFixed(2)}→${(last.alignErrorM * 100).toFixed(2)} cm.`;
}
