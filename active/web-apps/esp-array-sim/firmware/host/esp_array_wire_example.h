// Generated from src/firmware-fixtures.mjs — do not hand-edit.
#ifndef ESP_ARRAY_WIRE_EXAMPLE_H
#define ESP_ARRAY_WIRE_EXAMPLE_H

#include "../include/esp_array_protocol.h"

static const esp_array_arrival_wire_t ESP_ARRAY_EXAMPLE_ROW_0_ARRIVALS[] = {
  { .emitter_id = 0, .emit_us = 100000, .arrival_us = 100186, .distance_mm = 20 },
  { .emitter_id = 1, .emit_us = 400000, .arrival_us = 408183, .distance_mm = 2773 },
  { .emitter_id = 2, .emit_us = 700000, .arrival_us = 710665, .distance_mm = 3633 },
  { .emitter_id = 3, .emit_us = 1000000, .arrival_us = 1011788, .distance_mm = 4006 },
};

static const esp_array_arrival_wire_t ESP_ARRAY_EXAMPLE_ROW_1_ARRIVALS[] = {
  { .emitter_id = 0, .emit_us = 100000, .arrival_us = 108045, .distance_mm = 2773 },
  { .emitter_id = 1, .emit_us = 400000, .arrival_us = 400032, .distance_mm = 20 },
  { .emitter_id = 2, .emit_us = 700000, .arrival_us = 703604, .distance_mm = 1242 },
  { .emitter_id = 3, .emit_us = 1000000, .arrival_us = 1003574, .distance_mm = 1241 },
};

static const esp_array_arrival_wire_t ESP_ARRAY_EXAMPLE_ROW_2_ARRIVALS[] = {
  { .emitter_id = 0, .emit_us = 100000, .arrival_us = 110550, .distance_mm = 3633 },
  { .emitter_id = 1, .emit_us = 400000, .arrival_us = 403609, .distance_mm = 1242 },
  { .emitter_id = 2, .emit_us = 700000, .arrival_us = 699968, .distance_mm = 20 },
  { .emitter_id = 3, .emit_us = 1000000, .arrival_us = 1003694, .distance_mm = 1292 },
};

static const esp_array_arrival_wire_t ESP_ARRAY_EXAMPLE_ROW_3_ARRIVALS[] = {
  { .emitter_id = 0, .emit_us = 100000, .arrival_us = 111662, .distance_mm = 4006 },
  { .emitter_id = 1, .emit_us = 400000, .arrival_us = 403557, .distance_mm = 1241 },
  { .emitter_id = 2, .emit_us = 700000, .arrival_us = 703696, .distance_mm = 1292 },
  { .emitter_id = 3, .emit_us = 1000000, .arrival_us = 999991, .distance_mm = 20 },
};

static const esp_array_listener_row_wire_t ESP_ARRAY_EXAMPLE_ROWS[] = {
  { .listener_id = 0, .arrival_count = 4, .arrivals = ESP_ARRAY_EXAMPLE_ROW_0_ARRIVALS },
  { .listener_id = 1, .arrival_count = 4, .arrivals = ESP_ARRAY_EXAMPLE_ROW_1_ARRIVALS },
  { .listener_id = 2, .arrival_count = 4, .arrivals = ESP_ARRAY_EXAMPLE_ROW_2_ARRIVALS },
  { .listener_id = 3, .arrival_count = 4, .arrivals = ESP_ARRAY_EXAMPLE_ROW_3_ARRIVALS },
};

#define ESP_ARRAY_EXAMPLE_ROW_COUNT 4

#endif // ESP_ARRAY_WIRE_EXAMPLE_H
