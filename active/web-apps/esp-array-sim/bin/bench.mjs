#!/usr/bin/env node
// CLI: solver performance benchmark — prove the joint LM stays within the
// one-time calibration budget and catch perf regressions.
// Usage: node bin/bench.mjs [--nodes 4,6,8,10,12] [--repeats 3]
import { runBench, formatBench } from '../src/bench.mjs';

const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
function parseList(arg, fallback) {
  if (!arg) return fallback;
  return arg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

const points = runBench({
  nodeCounts: parseList(opt('--nodes'), [4, 6, 8, 10, 12]),
  repeats: Number(opt('--repeats') ?? 3),
});
console.log(formatBench(points));