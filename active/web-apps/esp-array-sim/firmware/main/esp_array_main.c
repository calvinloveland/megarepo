#include "esp_array_backend.h"

// ESP-IDF skeleton only: this is the coordinator-style sequencing scaffold that
// mirrors src/scenario.mjs and the JS firmware backend hooks. Real task creation,
// Wi-Fi init, I2S/PDM capture, and mesh transport will replace these stubs.

typedef enum {
    ESP_ARRAY_BOOT = 0,
    ESP_ARRAY_SYNC_CLOCKS,
    ESP_ARRAY_BUILD_PLAN,
    ESP_ARRAY_CAPTURE_ROWS,
    ESP_ARRAY_GOSSIP_ROWS,
    ESP_ARRAY_SOLVE_LAYOUT,
    ESP_ARRAY_READY_FOR_SURROUND,
} esp_array_state_t;

void app_main(void) {
    esp_array_state_t state = ESP_ARRAY_BOOT;
    esp_array_clock_sync_state_t sync = {0};
    esp_array_calibration_plan_t plan = {0};

    while (1) {
        switch (state) {
            case ESP_ARRAY_BOOT:
                state = ESP_ARRAY_SYNC_CLOCKS;
                break;
            case ESP_ARRAY_SYNC_CLOCKS:
                sync = esp_array_sync_clocks();
                state = sync.assumed_synced ? ESP_ARRAY_BUILD_PLAN : ESP_ARRAY_SYNC_CLOCKS;
                break;
            case ESP_ARRAY_BUILD_PLAN:
                plan = esp_array_make_plan(0 /* TODO: discover node count */);
                state = ESP_ARRAY_CAPTURE_ROWS;
                break;
            case ESP_ARRAY_CAPTURE_ROWS:
                // TODO: allocate and fill local listener-row packet(s)
                state = ESP_ARRAY_GOSSIP_ROWS;
                break;
            case ESP_ARRAY_GOSSIP_ROWS:
                // TODO: send/receive esp_array_listener_row_t packets across the mesh
                state = ESP_ARRAY_SOLVE_LAYOUT;
                break;
            case ESP_ARRAY_SOLVE_LAYOUT:
                // TODO: run local solver or forward the assembled matrix to a coordinator/off-device service
                state = ESP_ARRAY_READY_FOR_SURROUND;
                break;
            case ESP_ARRAY_READY_FOR_SURROUND:
                // TODO: apply speaker compensation + 5.1 panning at runtime
                return;
        }
    }
}
