import { DEFAULT_CALIBRATION_CONFIG, DEFAULT_CALIBRATION_CHIRP_OPTIONS } from './calibration-config.mjs';
import { DEFAULT_CHIRP_CONFIG } from './firmware-protocol.mjs';

export function renderFirmwareCalibrationHeader() {
  return `// Generated from src/calibration-config.mjs — do not hand-edit.
#ifndef ESP_ARRAY_CALIBRATION_H
#define ESP_ARRAY_CALIBRATION_H

#define ESP_ARRAY_FIRST_EMIT_SEC ${DEFAULT_CALIBRATION_CONFIG.firstEmitSec}f
#define ESP_ARRAY_EMIT_GAP_SEC ${DEFAULT_CALIBRATION_CONFIG.gapSec}f
#define ESP_ARRAY_CHIRP_DURATION_SEC ${DEFAULT_CALIBRATION_CHIRP_OPTIONS.durationSec}f
#define ESP_ARRAY_CHIRP_F0_HZ ${DEFAULT_CALIBRATION_CHIRP_OPTIONS.f0Hz}
#define ESP_ARRAY_CHIRP_F1_HZ ${DEFAULT_CALIBRATION_CHIRP_OPTIONS.f1Hz}
#define ESP_ARRAY_CHIRP_SAMPLE_RATE_HZ ${DEFAULT_CALIBRATION_CHIRP_OPTIONS.sampleRateHz}
#define ESP_ARRAY_CHIRP_WINDOW ${DEFAULT_CALIBRATION_CHIRP_OPTIONS.window ? 1 : 0}

#endif // ESP_ARRAY_CALIBRATION_H
`;
}

export function renderFirmwareProtocolHeader() {
  return `// Generated from src/firmware-protocol.mjs — do not hand-edit.
#ifndef ESP_ARRAY_PROTOCOL_H
#define ESP_ARRAY_PROTOCOL_H

#define ESP_ARRAY_CALIBRATION_PLAN_KIND \"calibration-plan-v1\"
#define ESP_ARRAY_LISTENER_ROW_KIND \"listener-row-v1\"
#define ESP_ARRAY_CHIRP_SAMPLE_RATE_HZ ${DEFAULT_CHIRP_CONFIG.sampleRateHz}

// One arrival observed at THIS node's microphone for one emitter.
typedef struct {
  int emitter_id;
  float emit_clock_sec;
  float arrival_clock_sec;
  float distance_m; // optional diagnostic in simulator, can be omitted in real packets
} esp_array_arrival_t;

// One node's complete listener-row broadcast after a calibration sweep.
typedef struct {
  int listener_id;
  int arrival_count;
  esp_array_arrival_t* arrivals;
} esp_array_listener_row_t;

#endif // ESP_ARRAY_PROTOCOL_H
`;
}
