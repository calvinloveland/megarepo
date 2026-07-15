// Heuristic warnings derived from regimes the simulator has already proved are
// risky. Keep these conservative: only flag conditions we can justify from the
// tested physics/solver behavior, and phrase them as explanations/suggestions
// rather than magical 'AI' conclusions.

/**
 * @typedef {{id:string,label:string}} AdvisoryAction
 * @typedef {{id:string,severity:'info'|'warn'|'bad',message:string,actions?:AdvisoryAction[]}} Advisory
 */

/**
 * @param {object} cfg readConfig()-style scenario config
 * @returns {Advisory[]}
 */
export function assessAdvisories(cfg = {}) {
  const out = [];
  const mode = cfg.captureMode ?? 'closed';
  const refl = Number(cfg.reflCoef ?? 0.5);
  const loss = Number(cfg.meshLoss ?? 0);
  const nodes = Number(cfg.nodeCount ?? 6);
  const shots = Number(cfg.avgShots ?? 1);
  const earliestPeak = !!cfg.earliestPeak;
  const robust = !!cfg.robust;

  if (mode === 'matched' && refl >= 0.7) {
    if (!earliestPeak && !robust) {
      out.push({
        id: 'matched-hard-reverb-plain',
        severity: 'bad',
        message: 'Heavy reverb + plain matched TOA is a known failure mode: loud later echoes can outrank the direct arrival and grossly mis-localize. Enable earliest-peak TOA and robust LM.',
        actions: [
          { id: 'enable-earliest-peak', label: 'Enable earliest-peak' },
          { id: 'enable-robust', label: 'Enable robust LM' },
          { id: 'use-hardened-preset', label: 'Use hardened preset' },
        ],
      });
    } else if (!earliestPeak) {
      out.push({
        id: 'matched-hard-reverb-no-earliest',
        severity: 'bad',
        message: 'Heavy reverb with strongest-peak TOA is risky: a loud later echo can hijack the estimate. Enable earliest-peak TOA.',
        actions: [{ id: 'enable-earliest-peak', label: 'Enable earliest-peak' }],
      });
    } else if (!robust) {
      out.push({
        id: 'matched-hard-reverb-no-robust',
        severity: 'warn',
        message: 'Heavy reverb is survivable, but without robust LM any surviving bad TOAs can still drag the solve. Enable robust LM for living-room conditions.',
        actions: [{ id: 'enable-robust', label: 'Enable robust LM' }],
      });
    }
  }

  if (mode === 'distributed' && loss >= 0.5) {
    out.push({
      id: 'distributed-very-high-loss',
      severity: 'bad',
      message: 'Very high mesh packet loss means too many listener rows never arrive. Expect an underdetermined or fragile solve unless you add more nodes or reduce loss.',
    });
  } else if (mode === 'distributed' && loss >= 0.3) {
    out.push({
      id: 'distributed-high-loss',
      severity: 'warn',
      message: '30%+ mesh packet loss is recoverable in the simulator, but only because the problem is still overdetermined. Expect degraded worst-case accuracy.',
    });
  }

  if (nodes <= 4) {
    out.push({
      id: 'few-nodes-minimal-geometry',
      severity: 'warn',
      message: '4 nodes is the bare minimum geometry. Localization still works, but the solve is less redundant and surround mapping is less graceful than with 6–8 nodes.',
    });
  } else if (nodes === 5) {
    out.push({
      id: 'few-nodes-borderline',
      severity: 'info',
      message: '5 nodes is workable, but 6–8 nodes gives noticeably better redundancy for localization and 5.1 panning.',
    });
  }

  if (mode === 'matched' && refl >= 0.3 && shots === 1) {
    out.push({
      id: 'single-shot-jitter',
      severity: 'info',
      message: 'Single-shot matched capture leaves all TOA jitter on the floor. Multi-shot median averaging can tighten the solve without changing the solver.',
      actions: [{ id: 'increase-avg-shots', label: 'Use 3-shot median' }],
    });
  }

  return out;
}
