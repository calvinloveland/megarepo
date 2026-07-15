/**
 * Build an at-a-glance readiness snapshot from the latest browser analysis
 * outputs. Missing sections are explicit so the dashboard is honest about what
 * has and hasn't been run.
 */
const ORDER = ['good', 'pending', 'warn', 'bad'];

function worse(a, b) {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

function badgeFor(severity) {
  return severity === 'bad'
    ? 'RISK'
    : severity === 'warn'
      ? 'CAUTION'
      : severity === 'pending'
        ? 'PENDING'
        : 'READY';
}

export function dashboardSummary(data = {}) {
  const lines = [];

  if (data.compare?.rows?.length) {
    const best = data.compare.rows.reduce((a, b) => (a.alignErrorM <= b.alignErrorM ? a : b));
    const errCm = best.alignErrorM * 100;
    lines.push({
      severity: errCm <= 5 ? 'good' : errCm <= 10 ? 'warn' : 'bad',
      text: `Best mode: ${best.label} at ${errCm.toFixed(2)} cm.`,
    });
  } else {
    lines.push({ severity: 'pending', text: 'Best mode: pending — run Mode comparison.' });
  }

  if (data.sizing?.recs?.length) {
    const feasible = data.sizing.recs.find((r) => r.minNodes != null);
    lines.push(feasible
      ? {
          severity: feasible.minNodes <= 8 ? 'good' : 'warn',
          text: `Recommended nodes: ${feasible.minNodes} for ≤${(data.sizing.targetM * 100).toFixed(0)} cm worst-case.`,
        }
      : {
          severity: 'bad',
          text: `Recommended nodes: infeasible for ≤${(data.sizing.targetM * 100).toFixed(0)} cm worst-case in 4–12 nodes.`,
        });
  } else {
    lines.push({ severity: 'pending', text: 'Recommended nodes: pending — run Hardware sizing.' });
  }

  if (data.bench?.points?.length) {
    const worstMs = Math.max(...data.bench.points.map((p) => p.worstMs));
    lines.push({
      severity: worstMs < 1000 ? 'good' : worstMs < 2000 ? 'warn' : 'bad',
      text: `Worst calibration time: ${worstMs.toFixed(0)} ms.`,
    });
  } else {
    lines.push({ severity: 'pending', text: 'Worst calibration time: pending — run Calibration latency.' });
  }

  if (data.noise?.rows?.length) {
    const first = data.noise.rows[0];
    const last = data.noise.rows[data.noise.rows.length - 1];
    const firstCm = first.alignErrorM * 100;
    const lastCm = last.alignErrorM * 100;
    const deltaCm = Math.max(0, lastCm - firstCm);
    lines.push({
      severity: lastCm <= 5 && deltaCm <= 2 ? 'good' : lastCm <= 15 && deltaCm <= 10 ? 'warn' : 'bad',
      text: `Noise sensitivity: σ ${first.noiseSigma.toFixed(2)}→${last.noiseSigma.toFixed(2)} changes error ${firstCm.toFixed(2)}→${lastCm.toFixed(2)} cm.`,
    });
  } else {
    lines.push({ severity: 'pending', text: 'Noise sensitivity: pending — run Noise sensitivity.' });
  }

  const severity = lines.reduce((acc, line) => worse(acc, line.severity), 'good');
  return {
    severity,
    badge: { severity, label: badgeFor(severity) },
    lines,
  };
}

export function dashboardSummaryLines(data = {}) {
  return dashboardSummary(data).lines.map((line) => line.text);
}

export function formatDashboardSummary(data = {}) {
  return dashboardSummaryLines(data).join('\n');
}
