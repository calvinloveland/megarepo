#include "esp_array_wire_example.h"

// Host-side C consumer stub for the generated wire-format example payload.
// This is not a full parser for JSON transport; the example header is already a
// decoded C representation of the compact wire format. The point is to prove
// that the generated protocol structs are actually consumable from C, not just
// emitted as documentation.

static int esp_array_count_total_arrivals(void) {
    int total = 0;
    for (int i = 0; i < ESP_ARRAY_EXAMPLE_ROW_COUNT; ++i) {
        total += ESP_ARRAY_EXAMPLE_ROWS[i].arrival_count;
    }
    return total;
}

static int esp_array_max_arrival_us(void) {
    int max_us = 0;
    for (int i = 0; i < ESP_ARRAY_EXAMPLE_ROW_COUNT; ++i) {
        const esp_array_listener_row_wire_t* row = &ESP_ARRAY_EXAMPLE_ROWS[i];
        for (int j = 0; j < row->arrival_count; ++j) {
            if (row->arrivals[j].arrival_us > max_us) max_us = row->arrivals[j].arrival_us;
        }
    }
    return max_us;
}

int esp_array_consume_example(void) {
    // Returns non-zero if the generated example payload looks internally sane.
    return esp_array_count_total_arrivals() > 0 && esp_array_max_arrival_us() > 0;
}
