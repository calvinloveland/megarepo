#include <stdio.h>
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
            case ESP_ARRAY_BOOT: {
                printf("ESP Array node boot\n");
                esp_array_init_speaker();
                esp_array_init_microphone();
                esp_array_init_transport();
                state = ESP_ARRAY_SYNC_CLOCKS;
                break;
            }
            case ESP_ARRAY_SYNC_CLOCKS:
                sync = esp_array_sync_clocks();
                state = sync.assumed_synced ? ESP_ARRAY_BUILD_PLAN : ESP_ARRAY_SYNC_CLOCKS;
                break;
            case ESP_ARRAY_BUILD_PLAN: {
                printf("Building calibration plan\n");
                plan = esp_array_make_plan(0 /* TODO: discover node count */);
                state = ESP_ARRAY_CAPTURE_ROWS;
                break;
            }
            case ESP_ARRAY_CAPTURE_ROWS:
                // TODO: allocate mic buffer, run chirp schedule + DSP TOA on each capture
                state = ESP_ARRAY_GOSSIP_ROWS;
                break;
            case ESP_ARRAY_GOSSIP_ROWS:
                // TODO: send/receive esp_array_listener_row_t packets across the mesh
                state = ESP_ARRAY_SOLVE_LAYOUT;
                break;
            case ESP_ARRAY_SOLVE_LAYOUT:
                // TODO: run local solver or forward matrix to coordinator
                state = ESP_ARRAY_READY_FOR_SURROUND;
                break;
            case ESP_ARRAY_READY_FOR_SURROUND:
                printf("Calibration complete — ready for 5.1 playback\n");
                return;
        }
    }
}
