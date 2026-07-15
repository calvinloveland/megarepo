// Generated from src/firmware-protocol.mjs — do not hand-edit.
#ifndef ESP_ARRAY_PROTOCOL_H
#define ESP_ARRAY_PROTOCOL_H

#define ESP_ARRAY_CALIBRATION_PLAN_KIND "calibration-plan-v1"
#define ESP_ARRAY_LISTENER_ROW_KIND "listener-row-v1"
#define ESP_ARRAY_CHIRP_SAMPLE_RATE_HZ 48000

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
