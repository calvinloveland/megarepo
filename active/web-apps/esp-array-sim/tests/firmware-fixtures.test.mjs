import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFirmwareFixtures } from '../src/firmware-fixtures.mjs';

test('firmware fixtures contain calibration plans plus closed/matched rows in both rich and wire forms', () => {
  const fx = makeFirmwareFixtures();
  assert.equal(fx.plan.kind, 'calibration-plan-v1');
  assert.equal(fx.planWire.kind, 'calibration-plan-v1/int-us');
  assert.equal(fx.listenerRowsClosed.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsClosedWire.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsMatched.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsMatchedWire.length, fx.meta.nodeCount);
  assert.equal(fx.listenerRowsClosed[0].kind, 'listener-row-v1');
  assert.equal(fx.listenerRowsClosedWire[0].kind, 'listener-row-v1/int-us');
});

test('matched fixture preserves richer diagnostics than the closed fixture', () => {
  const fx = makeFirmwareFixtures();
  const closedArrival = fx.listenerRowsClosed[0].arrivals.find((a) => a.emitterId !== fx.listenerRowsClosed[0].listenerId);
  const matchedArrival = fx.listenerRowsMatched[0].arrivals.find((a) => a.emitterId !== fx.listenerRowsMatched[0].listenerId);
  assert.equal(closedArrival.arrivalPaths, undefined);
  assert.ok(Array.isArray(matchedArrival.arrivalPaths), 'matched fixture includes waveform-path diagnostics');
});