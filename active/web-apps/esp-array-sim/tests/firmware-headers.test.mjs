import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFirmwareCalibrationHeader, renderFirmwareProtocolHeader } from '../src/firmware-headers.mjs';

test('generated calibration header contains the canonical sweep constants', () => {
  const txt = renderFirmwareCalibrationHeader();
  assert.match(txt, /ESP_ARRAY_FIRST_EMIT_SEC 0\.1f/);
  assert.match(txt, /ESP_ARRAY_EMIT_GAP_SEC 0\.3f/);
  assert.match(txt, /ESP_ARRAY_CHIRP_DURATION_SEC 0\.002f/);
  assert.match(txt, /ESP_ARRAY_CHIRP_F0_HZ 3000/);
  assert.match(txt, /ESP_ARRAY_CHIRP_F1_HZ 8000/);
  assert.match(txt, /ESP_ARRAY_CHIRP_SAMPLE_RATE_HZ 48000/);
});

test('generated protocol header contains packet kinds and listener-row structs', () => {
  const txt = renderFirmwareProtocolHeader();
  assert.match(txt, /ESP_ARRAY_CALIBRATION_PLAN_KIND \"calibration-plan-v1\"/);
  assert.match(txt, /ESP_ARRAY_LISTENER_ROW_KIND \"listener-row-v1\"/);
  assert.match(txt, /typedef struct \{/);
  assert.match(txt, /esp_array_listener_row_t/);
});