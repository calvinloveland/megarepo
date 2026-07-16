#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>
#include "esp_array_backend.h"

// I2S driver initialization using Kconfig settings where available.
int esp_array_init_speaker(void)
{
#if CONFIG_ESP_ARRAY_I2S_SPEAKER_ENABLED
    printf("I2S speaker: initializing BCK=%d WS=%d DATA=%d SR=%d\n",
           CONFIG_ESP_ARRAY_I2S_SPEAKER_BCK_PIN,
           CONFIG_ESP_ARRAY_I2S_SPEAKER_WS_PIN,
           CONFIG_ESP_ARRAY_I2S_SPEAKER_DATA_PIN,
           CONFIG_ESP_ARRAY_I2S_SPEAKER_SAMPLE_RATE);
    // TODO: real i2s_std_config / i2s_driver_install call
    return 0;
#else
    return -1;
#endif
}

int esp_array_init_microphone(void)
{
#if CONFIG_ESP_ARRAY_MIC_I2S_ENABLED
    printf("I2S mic: initializing SCK=%d WS=%d DATA=%d SR=%d\n",
           CONFIG_ESP_ARRAY_MIC_I2S_SCK_PIN,
           CONFIG_ESP_ARRAY_MIC_I2S_WS_PIN,
           CONFIG_ESP_ARRAY_MIC_I2S_DATA_PIN,
           CONFIG_ESP_ARRAY_MIC_SAMPLE_RATE);
    // TODO: real i2s_std_config / i2s_driver_install call
    return 0;
#else
    return -1;
#endif
}

void esp_array_deinit_speaker(void)
{
#if CONFIG_ESP_ARRAY_I2S_SPEAKER_ENABLED
    // TODO: i2s_driver_uninstall
#endif
}

void esp_array_deinit_microphone(void)
{
#if CONFIG_ESP_ARRAY_MIC_I2S_ENABLED
    // TODO: i2s_driver_uninstall
#endif
}

int esp_array_init_transport(void)
{
#if CONFIG_ESP_ARRAY_TRANSPORT_WIFI
    printf("Wi-Fi mesh transport: initializing (max nodes %d)\n", CONFIG_ESP_ARRAY_MAX_NODES);
    // TODO: esp_netif_init, esp_event_loop_create, wifi_init_sta, esp_now_init
    return 0;
#else
    return -1;
#endif
}

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
