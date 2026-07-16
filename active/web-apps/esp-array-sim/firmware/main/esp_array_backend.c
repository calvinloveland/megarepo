#include "esp_array_backend.h"

// Stub implementations for the firmware backend hooks.
// These mirror the simulator's JS firmware-backend.mjs and will be replaced
// by real ESP-IDF driver / task code as the hardware phase progresses.

esp_array_clock_sync_state_t esp_array_sync_clocks(void) {
    esp_array_clock_sync_state_t state = { .assumed_synced = true };
    return state;
}

esp_array_calibration_plan_t esp_array_make_plan(int node_count) {
    // TODO: allocate and populate plan.emissions from the canonical sweep config
    esp_array_calibration_plan_t plan = { .emission_count = 0, .emissions = NULL };
    return plan;
}

int esp_array_capture_listener_rows(const esp_array_calibration_plan_t* plan,
                                    esp_array_listener_row_t* out_rows,
                                    int max_rows) {
    // TODO: I2S/PDM mic capture + DSP pipeline
    (void)plan; (void)out_rows; (void)max_rows;
    return 0;
}

int esp_array_gossip_listener_rows(const esp_array_listener_row_t* rows,
                                   int row_count,
                                   esp_array_listener_row_t* out_rows,
                                   int max_rows) {
    // TODO: ESP-MESH / Wi-Fi transport
    (void)rows; (void)row_count; (void)out_rows; (void)max_rows;
    return 0;
}
