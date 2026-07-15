import test from 'node:test';
import assert from 'node:assert/strict';
import { scanNodeCounts, formatNodeScan, summarizeNodeScan } from '../src/node-scan.mjs';

test('scanNodeCounts returns one row per requested node count', () => {
  const rows = scanNodeCounts({ seed: 42, room: { width: 6, height: 5 }, captureMode: 'closed' }, [4, 8, 12]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.nodeCount), [4, 8, 12]);
  for (const r of rows) {
    assert.ok(r.alignErrorM >= 0);
    assert.ok(r.iterations > 0);
    assert.ok(r.observations > 0);
  }
});

test('formatNodeScan renders a header and one line per row', () => {
  const rows = scanNodeCounts({ seed: 42, room: { width: 6, height: 5 }, captureMode: 'closed' }, [4, 6]);
  const txt = formatNodeScan(rows);
  const lines = txt.split('\n');
  assert.match(lines[0], /nodes/);
  assert.equal(lines.length - 1, rows.length);
});

test('summarizeNodeScan mentions node-count and error span', () => {
  const txt = summarizeNodeScan([
    { nodeCount: 4, alignErrorM: 0.02, iterations: 10, meshMessages: null, observations: 16 },
    { nodeCount: 12, alignErrorM: 0.005, iterations: 30, meshMessages: null, observations: 144 },
  ]);
  assert.match(txt, /4→12 nodes/);
  assert.match(txt, /2.00→0.50 cm/);
  assert.match(txt, /16→144/);
});