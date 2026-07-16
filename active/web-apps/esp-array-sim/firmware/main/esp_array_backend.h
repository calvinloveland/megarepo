#ifndef ESP_ARRAY_BACKEND_H
#define ESP_ARRAY_BACKEND_H

#include "esp_array_protocol.h"
#include "esp_array_calibration.h"
#include "esp_array_frame.h"

// Mirrors src/firmware-backend.mjs. These hooks are the seam where the simulator's
// in-process implementation will later be replaced by real ESP-IDF tasks/drivers.

typedef struct {
    int emitter_id;
    float emit_clock_sec;
} esp_array_emission_t;

typedef struct {
    int emission_count;
    esp_array_emission_t* emissions;
} esp_array_calibration_plan_t;

typedef struct {
    int assumed_synced;
} esp_array_clock_sync_state_t;

esp_array_clock_sync_state_t esp_array_sync_clocks(void);
esp_array_calibration_plan_t esp_array_make_plan(int node_count);
int esp_array_capture_listener_rows(const esp_array_calibration_plan_t* plan,
                                    esp_array_listener_row_t* out_rows,
                                    int max_rows);
int esp_array_gossip_listener_rows(const esp_array_listener_row_t* rows,
                                   int row_count,
                                   esp_array_listener_row_t* out_rows,
                                   int max_rows);

// Hardware init / deinit — calls I2S driver init from Kconfig settings.
int esp_array_init_speaker(void);
int esp_array_init_microphone(void);
void esp_array_deinit_speaker(void);
void esp_array_deinit_microphone(void);

// Transport init.
int esp_array_init_transport(void);

#endif // ESP_ARRAY_BACKEND_H
