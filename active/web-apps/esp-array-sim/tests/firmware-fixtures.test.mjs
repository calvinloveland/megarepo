import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFirmwareFixtures } from '../src/firmware-fixtures.mjs';

test('firmware fixtures contain a calibration plan and both closed/matched listener rows', () => {
  const fx = makeFirmwareFixtures();
  assert.equal(fx.plan.kind, 'calibration-plan-v1');
  assert.equal(fx.listenerRowsClosed.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsMatched.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsClosed[0].kind, 'listener-row-v1');
});

test('matched fixture preserves richer diagnostics than the closed fixture', () => {
  const fx = makeFirmwareFixtures();
  const closedArrival = fx.listenerRowsClosed[0].arrivals.find((a) => a.emitterId !== fx.listenerRowsClosed[0].listenerId);
  const matchedArrival = fx.listenerRowsMatched[0].arrivals.find((a) => a.emitterId !== fx.listenerRowsMatched[0].listenerId);
  assert.equal(closedArrival.arrivalPaths, undefined);
  assert.ok(Array.isArray(matchedArrival.arrivalPaths), 'matched fixture includes waveform-path diagnostics');
});