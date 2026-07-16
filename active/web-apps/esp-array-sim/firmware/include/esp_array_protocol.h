// Generated from src/firmware-protocol.mjs — do not hand-edit.
#ifndef ESP_ARRAY_PROTOCOL_H
#define ESP_ARRAY_PROTOCOL_H

#define ESP_ARRAY_CALIBRATION_PLAN_KIND "calibration-plan-v1"
#define ESP_ARRAY_LISTENER_ROW_KIND "listener-row-v1"
#define ESP_ARRAY_CHIRP_SAMPLE_RATE_HZ 48000

// Rich float-domain arrival used by host-side tools and simulator-oriented integrations.
typedef struct {
  int emitter_id;
  float emit_clock_sec;
  float arrival_clock_sec;
  float distance_m; // optional diagnostic in simulator, can be omitted in real packets
} esp_array_arrival_t;

typedef struct {
  int listener_id;
  int arrival_count;
  esp_array_arrival_t* arrivals;
} esp_array_listener_row_t;

// Compact wire-domain arrival used by firmware transport (integer microseconds/mm).
typedef struct {
  int emitter_id;
  int emit_us;
  int arrival_us;
  int distance_mm;
} esp_array_arrival_wire_t;

typedef struct {
  int listener_id;
  int arrival_count;
  const esp_array_arrival_wire_t* arrivals;
} esp_array_listener_row_wire_t;

#endif // ESP_ARRAY_PROTOCOL_H
