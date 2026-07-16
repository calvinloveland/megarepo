import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRMWARE_FRAME_SPEC, renderFirmwareFrameHeader } from '../src/firmware-frame.mjs';

test('firmware frame spec exposes stable magic/version/kind ids', () => {
  assert.equal(FIRMWARE_FRAME_SPEC.magic, 'ESPA');
  assert.equal(FIRMWARE_FRAME_SPEC.version, 1);
  assert.equal(FIRMWARE_FRAME_SPEC.kinds.calibrationPlan, 1);
  assert.equal(FIRMWARE_FRAME_SPEC.kinds.listenerRow, 2);
});

test('generated frame header contains the magic, version, kind ids, and header struct', () => {
  const txt = renderFirmwareFrameHeader();
  assert.match(txt, /ESP_ARRAY_FRAME_MAGIC \"ESPA\"/);
  assert.match(txt, /ESP_ARRAY_FRAME_VERSION 1/);
  assert.match(txt, /ESP_ARRAY_FRAME_KIND_CALIBRATION_PLAN 1/);
  assert.match(txt, /ESP_ARRAY_FRAME_KIND_LISTENER_ROW 2/);
  assert.match(txt, /esp_array_frame_header_t/);
});