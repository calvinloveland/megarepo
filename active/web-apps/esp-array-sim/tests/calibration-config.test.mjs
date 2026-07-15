import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CALIBRATION_CONFIG,
  DEFAULT_CALIBRATION_CHIRP_OPTIONS,
} from '../src/calibration-config.mjs';
import { makeEmitSchedule } from '../src/world.mjs';
import { makeCalibrationPlan, DEFAULT_CHIRP_CONFIG } from '../src/firmware-protocol.mjs';
import { DEFAULT_CHIRP, DEFAULT_SAMPLE_RATE } from '../src/capture.mjs';

test('world emit schedule uses the canonical calibration timing defaults', () => {
  const sched = makeEmitSchedule([{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.equal(sched[0].emitClockSec, DEFAULT_CALIBRATION_CONFIG.firstEmitSec);
  assert.ok(Math.abs((sched[1].emitClockSec - sched[0].emitClockSec) - DEFAULT_CALIBRATION_CONFIG.gapSec) < 1e-12);
  assert.ok(Math.abs((sched[2].emitClockSec - sched[1].emitClockSec) - DEFAULT_CALIBRATION_CONFIG.gapSec) < 1e-12);
});

test('firmware protocol chirp config matches the canonical calibration chirp', () => {
  const plan = makeCalibrationPlan([{ emitterId: 0, emitClockSec: 0.1 }]);
  assert.deepEqual(DEFAULT_CHIRP_CONFIG, DEFAULT_CALIBRATION_CHIRP_OPTIONS);
  assert.deepEqual(plan.chirp, DEFAULT_CALIBRATION_CHIRP_OPTIONS);
  assert.equal(plan.gapSec, DEFAULT_CALIBRATION_CONFIG.gapSec);
});

test('matched capture default chirp uses the same canonical chirp settings', () => {
  assert.equal(DEFAULT_SAMPLE_RATE, DEFAULT_CALIBRATION_CHIRP_OPTIONS.sampleRateHz);
  assert.equal(DEFAULT_CHIRP.length, Math.round(DEFAULT_SAMPLE_RATE * DEFAULT_CALIBRATION_CHIRP_OPTIONS.durationSec));
});