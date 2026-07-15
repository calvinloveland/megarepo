import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UI_STATE,
  PRESETS,
  sanitizeUiState,
  serializeUiState,
  parseUiStateUrl,
  matchingPresetId,
  presetState,
} from '../src/ui-state.mjs';

test('sanitizeUiState clamps numbers and normalizes booleans', () => {
  const s = sanitizeUiState({
    nodeCount: 99,
    roomW: 1,
    roomH: '2.5',
    exponent: 0,
    distanceLaw: -4,
    captureMode: 'bogus',
    reflCoef: 9,
    meshLoss: -2,
    avgShots: 0,
    earliestPeak: 'yes',
    clockSkew: '0',
    robust: 1,
    showTruth: 'false',
    captureSweep: 'off',
  });
  assert.equal(s.nodeCount, 12);
  assert.equal(s.roomW, 3);
  assert.equal(s.roomH, 3);
  assert.equal(s.exponent, 1);
  assert.equal(s.distanceLaw, 0);
  assert.equal(s.captureMode, DEFAULT_UI_STATE.captureMode);
  assert.equal(s.reflCoef, 1);
  assert.equal(s.meshLoss, 0);
  assert.equal(s.avgShots, 1);
  assert.equal(s.earliestPeak, true);
  assert.equal(s.clockSkew, false);
  assert.equal(s.robust, true);
  assert.equal(s.showTruth, false);
  assert.equal(s.captureSweep, false);
});

test('serializeUiState + parseUiStateUrl round-trip a custom state', () => {
  const input = {
    nodeCount: 8,
    seed: 123,
    roomW: 8,
    roomH: 6,
    exponent: 5,
    distanceLaw: 1.5,
    captureMode: 'distributed',
    reflCoef: 0.8,
    meshLoss: 0.3,
    avgShots: 7,
    earliestPeak: true,
    clockSkew: true,
    robust: true,
    showTruth: false,
    captureSweep: false,
  };
  const round = parseUiStateUrl(`#${serializeUiState(input)}`);
  assert.deepEqual(round, sanitizeUiState(input));
});

test('parseUiStateUrl defaults missing flags the same way the UI does', () => {
  const s = parseUiStateUrl('?n=6&mode=matched');
  assert.equal(s.nodeCount, 6);
  assert.equal(s.captureMode, 'matched');
  assert.equal(s.showTruth, true);
  assert.equal(s.captureSweep, true);
  assert.equal(s.robust, false);
});

test('preset ids are unique and resolvable', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.equal(matchingPresetId(presetState(id)), id);
  }
  assert.deepEqual(presetState('missing'), DEFAULT_UI_STATE);
});

test('matchingPresetId returns custom for non-exact states', () => {
  const s = { ...presetState('dry-matched'), seed: 999 };
  assert.equal(matchingPresetId(s), 'custom');
});

test('important presets encode the intended simulator stories', () => {
  const hard = presetState('living-room-hard');
  assert.equal(hard.captureMode, 'matched');
  assert.equal(hard.reflCoef, 0.8);
  assert.equal(hard.earliestPeak, true);
  assert.equal(hard.robust, true);

  const lossy = presetState('distributed-lossy');
  assert.equal(lossy.captureMode, 'distributed');
  assert.equal(lossy.meshLoss, 0.3);

  const averaged = presetState('averaged-skew');
  assert.equal(averaged.avgShots, 5);
  assert.equal(averaged.clockSkew, true);
});