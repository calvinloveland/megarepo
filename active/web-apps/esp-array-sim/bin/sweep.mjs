#!/usr/bin/env node
// CLI: run the localization accuracy sweep and print the report.
// Usage: node bin/sweep.mjs [--trials N] [--nodes 4,6,8] [--refl 0,0.3,0.6]
import { runSweep, formatSweep } from '../src/sweep.mjs';

function parseList(arg, fallback) {
  if (!arg) return fallback;
  return arg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

const cells = runSweep({
  nodeCounts: parseList(opt('--nodes'), [4, 6, 8, 10]),
  captureModes: opt('--modes') ? opt('--modes').split(',').map((s) => s.trim()) : ['closed', 'matched'],
  reflCoefs: parseList(opt('--refl'), [0.0, 0.3, 0.6]),
  trials: Number(opt('--trials') ?? 10),
  roomW: Number(opt('--width') ?? 8),
  roomH: Number(opt('--height') ?? 6),
  seedBase: Number(opt('--seed') ?? 1000),
  successM: Number(opt('--success-m') ?? 0.10),
});
console.log(formatSweep(cells));