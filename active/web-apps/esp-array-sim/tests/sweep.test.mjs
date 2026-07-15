import test from 'node:test';
import assert from 'node:assert/strict';
import { runSweep, formatSweep, sweepToCsv, minNodesFor, formatMinNodes, summarizeMinNodes } from '../src/sweep.mjs';

const SMALL = {
  nodeCounts: [4, 6],
  captureModes: ['closed', 'matched'],
  reflCoefs: [0.0, 0.5],
  trials: 4,
  seedBase: 500,
  roomW: 7, roomH: 5,
};

test('runSweep produces one cell per (node × mode × reflCoef) combination', () => {
  const cells = runSweep(SMALL);
  assert.equal(cells.length, 2 * 2 * 2);
  const keys = new Set(cells.map((c) => `${c.nodeCount}-${c.captureMode}-${c.reflCoef}`));
  assert.equal(keys.size, 8);
  for (const c of cells) assert.equal(c.trials, 4);
});

test('closed-mode localization stays within the mic-jitter floor across reverb (reverb is inert in the closed path)', () => {
  const cells = runSweep(SMALL);
  for (const c of cells) {
    if (c.captureMode !== 'closed') continue;
    // closed-form TOA only adds ~20 µs mic jitter ≈ 0.7 cm; sub-cm solver on top.
    assert.ok(c.medianErrM < 0.05,
      `closed median ${(c.medianErrM*100).toFixed(2)}cm too large at reflCoef ${c.reflCoef}`);
  }
});

test('matched-mode accuracy does not improve when reverb increases (reverb hurts the estimator)', () => {
  const cells = runSweep(SMALL);
  for (const c of cells) {
    if (c.captureMode !== 'matched' || c.reflCoef !== 0.0) continue;
    const louder = cells.find(
      (m) => m.nodeCount === c.nodeCount && m.captureMode === 'matched' && m.reflCoef === 0.5,
    );
    assert.ok(louder, 'higher-reverb matched counterpart exists');
    assert.ok(c.medianErrM <= louder.medianErrM + 1e-9,
      `free-field matched median ${(c.medianErrM*100).toFixed(2)}cm should be <= reverberant ${(louder.medianErrM*100).toFixed(2)}cm`);
  }
});

test('free-field (reflCoef 0) localization succeeds well within the success threshold', () => {
  const cells = runSweep({ ...SMALL, reflCoefs: [0.0], captureModes: ['closed'] });
  for (const c of cells) {
    assert.ok(c.successRate >= 0.75, `free-field success too low at ${c.nodeCount} nodes: ${(c.successRate*100)}%`);
  }
});

test('worsening reverb never improves median accuracy in closed mode', () => {
  // closed mode ignores reverb (no echoes in the closed-form path), so all
  // reflCoef cells should be identical (a sanity check on determinism).
  const cells = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0, 0.3, 0.9], trials: 5, roomW: 7, roomH: 5 });
  const errs = cells.map((c) => c.medianErrM);
  const spread = Math.max(...errs) - Math.min(...errs);
  assert.ok(spread < 1e-9, `closed-mode reverb should be inert; median spread ${spread.toExponential(2)}`);
});

test('formatSweep produces a readable table header and one row per cell', () => {
  const cells = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const out = formatSweep(cells);
  const lines = out.split('\n');
  assert.ok(lines[0].includes('median'));
  assert.equal(lines.length - 1, cells.length);
  assert.ok(lines[1].includes('cm'));
});

test('runSweep is deterministic for a fixed seedBase', () => {
  const a = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3, seedBase: 7 });
  const b = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3, seedBase: 7 });
  assert.deepEqual(a, b);
});

test('sweepToCsv emits a header + one CSV row per cell with the right columns', () => {
  const cells = runSweep({ nodeCounts: [6, 8], captureModes: ['closed'], reflCoefs: [0.0, 0.5], trials: 3 });
  const csv = sweepToCsv(cells);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'nodeCount,captureMode,reflCoef,trials,medianErrM,p90ErrM,worstErrM,successRate');
  assert.equal(lines.length - 1, cells.length);
  // each data row has 8 fields and round-trips the underlying numbers
  for (let i = 0; i < cells.length; i++) {
    const fields = lines[i + 1].split(',');
    assert.equal(fields.length, 8);
    assert.equal(Number(fields[0]), cells[i].nodeCount);
    assert.equal(fields[1], 'closed');
    assert.ok(Math.abs(Number(fields[4]) - cells[i].medianErrM) < 1e-6, 'median round-trips');
  }
});

test('sweepToCsv output ends with a newline so sweeps concatenate cleanly', () => {
  const cells = runSweep({ nodeCounts: [6], captureModes: ['closed'], reflCoefs: [0.0], trials: 2 });
  assert.ok(sweepToCsv(cells).endsWith('\n'), 'CSV must end with newline');
});
test('minNodesFor returns one entry per (mode, refl) group, min-aware', () => {
  const cells = runSweep({ nodeCounts: [3, 5, 7], captureModes: ['closed', 'matched'], reflCoefs: [0.0, 0.5], trials: 4 });
  const recs = minNodesFor(cells, 0.05);
  // 2 modes x 2 refls = 4 groups, sorted (closed before matched, refl asc)
  assert.equal(recs.length, 4);
  assert.equal(recs[0].captureMode, 'closed');
  assert.equal(recs[0].reflCoef, 0.0);
  // entries sort within mode by refl
  assert.ok(recs[0].reflCoef <= recs[1].reflCoef);
});

test('minNodesFor picks the smallest node count whose worst error meets the target', () => {
  // matched at refl 0 with these node counts is ~sub-cm everywhere, so 3 nodes suffices
  const cells = runSweep({ nodeCounts: [3, 5], captureModes: ['matched'], reflCoefs: [0.0], trials: 4 });
  const recs = minNodesFor(cells, 0.05);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].minNodes, 3, '3 matched nodes already beats 5cm worst');
  assert.ok(recs[0].atWorstM <= 0.05);
});

test('minNodesFor reports infeasible (null) when no tested node count meets the target', () => {
  // demand an absurdly tight target no realistic draw meets
  const cells = runSweep({ nodeCounts: [3, 4], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const recs = minNodesFor(cells, 1e-6);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].minNodes, null, '1e-6 target is infeasible -> null');
  assert.ok(recs[0].atWorstM > 1e-6, 'atWorstM reports the best-available worst at the largest node count');
});

test('hardware-sizing report surfaces the dry-vs-reverberant gap', () => {
  // Reverberation (refl 0.8) is strictly harder than dry (refl 0.0). At a 5cm
  // worst-case target the matched path meets dry easily but can fail the
  // reverberant room entirely within a small node range (echo mis-IDs blow up
  // the worst case at low node counts). The sizing report must reflect that: the
  // reverberant minNodes is either larger than dry, or infeasible (null) — never
  // *smaller*. This is the actionable hardware insight: 'matched alone cannot
  // handle a hard reverb room; go closed, or robust + earliest-peak'.
  const cells = runSweep({ nodeCounts: [4, 6, 8, 10], captureModes: ['matched'], reflCoefs: [0.0, 0.8], trials: 6 });
  const recs = minNodesFor(cells, 0.05);
  const dry = recs.find((r) => r.reflCoef === 0.0);
  const rev = recs.find((r) => r.reflCoef === 0.8);
  assert.ok(dry.minNodes !== null, 'dry is always feasible in this range');
  assert.ok(rev.minNodes === null || rev.minNodes >= dry.minNodes,
    `reverberant (${rev.minNodes}) must be null or >= dry (${dry.minNodes}) — never smaller`);
  // and specifically: the reverberant best-available worst error is worse than dry
  assert.ok(rev.atWorstM > dry.atWorstM, 'reverberant room is harder than dry at the same node count');
});

test('robust LM + earliest-peak make a hard-reverb room feasible where plain matched fails', () => {
  // plain matched blows up the worst case in a heavy-reverb room; enabling
  // earliestPeak (reject loud NLOS echoes) + robust (downweight survivors)
  // restores feasibility at modest node counts — the actionable hardware insight
  // that the firmware MUST ship earliest-peak + robust to survive a living room.
  const base = { nodeCounts: [6, 8, 10], captureModes: ['matched'], reflCoefs: [0.8], trials: 6 };
  const plain = runSweep(base);
  const hardened = runSweep({ ...base, extra: { earliestPeak: true, robust: 5e-5 } });
  const plainRec = minNodesFor(plain, 0.05)[0];
  const hardRec = minNodesFor(hardened, 0.05)[0];
  // plain is infeasible (or needs more nodes) in this range; hardened is feasible at <=8
  assert.ok(plainRec.minNodes === null || plainRec.minNodes > 8, 'plain matched struggles in heavy reverb');
  assert.equal(hardRec.minNodes !== null && hardRec.minNodes <= 8, true,
    `hardened (earliest-peak + robust, $
{hardRec.minNodes} nodes) must be feasible at <=8 nodes in a 0.8-reverb room`);
});

test('formatMinNodes renders a header and one line per recommendation', () => {
  const cells = runSweep({ nodeCounts: [4, 6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const recs = minNodesFor(cells, 0.05);
  const txt = formatMinNodes(recs, 0.05);
  const lines = txt.split('\n');
  assert.ok(lines[0].includes('min nodes'), 'header present');
  assert.equal(lines.length - 1, recs.length);
});

test('summarizeMinNodes reports the minimum feasible node count', () => {
  const cells = runSweep({ nodeCounts: [4, 6], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const recs = minNodesFor(cells, 0.05);
  const txt = summarizeMinNodes(recs, 0.05);
  assert.match(txt, /Need at least/);
  assert.match(txt, /worst-case/);
});

test('summarizeMinNodes reports infeasible ranges clearly', () => {
  const cells = runSweep({ nodeCounts: [3, 4], captureModes: ['closed'], reflCoefs: [0.0], trials: 3 });
  const recs = minNodesFor(cells, 1e-6);
  const txt = summarizeMinNodes(recs, 1e-6);
  assert.match(txt, /Infeasible/);
  assert.match(txt, /best worst/);
});
