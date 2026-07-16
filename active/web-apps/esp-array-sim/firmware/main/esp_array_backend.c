#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include "esp_array_backend.h"
#include "esp_array_dsp.h"
#include "esp_array_calibration.h"

// Maximum chirp sample buffer size (samples).
#define ESP_ARRAY_DSP_BUF_MAX 2048

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

int esp_array_play_chirp(double sample_rate_hz)
{
    double chirp_buf[ESP_ARRAY_DSP_BUF_MAX];
    int N = esp_array_linear_chirp(chirp_buf, ESP_ARRAY_DSP_BUF_MAX,
                                    ESP_ARRAY_CHIRP_DURATION_SEC,
                                    ESP_ARRAY_CHIRP_F0_HZ,
                                    ESP_ARRAY_CHIRP_F1_HZ,
                                    sample_rate_hz, 1);
    if (N < 2) return -1;
    printf("Calibration chirp: %d samples @ %.0f Hz (%d ms)\n",
           N, sample_rate_hz, (int)(ESP_ARRAY_CHIRP_DURATION_SEC * 1000));
    // TODO: i2s_write() the chirp buffer to the speaker DAC
    return 0;
}

int esp_array_capture_and_estimate(double sample_rate_hz,
                                   esp_array_arrival_wire_t* out_arrival)
{
    double chirp_buf[ESP_ARRAY_DSP_BUF_MAX];
    int N = esp_array_linear_chirp(chirp_buf, ESP_ARRAY_DSP_BUF_MAX,
                                    ESP_ARRAY_CHIRP_DURATION_SEC,
                                    ESP_ARRAY_CHIRP_F0_HZ,
                                    ESP_ARRAY_CHIRP_F1_HZ,
                                    sample_rate_hz, 1);
    if (N < 2) return -1;

    // Signal buffer: chirp length + margin for propagation delay
    int margin = (int)(0.1 * sample_rate_hz); // 100ms max propagation margin
    int sig_len = N + margin;
    double signal[ESP_ARRAY_DSP_BUF_MAX * 2];
    if (sig_len > ESP_ARRAY_DSP_BUF_MAX * 2) sig_len = ESP_ARRAY_DSP_BUF_MAX * 2;
    memset(signal, 0, sizeof(double) * (size_t)sig_len);

    // TODO: i2s_read() actual mic samples into signal buffer
    // For now, signal stays zero -> TOA noise

    esp_array_toa_result_t toa = esp_array_estimate_toa(
        signal, sig_len, chirp_buf, N, sample_rate_hz,
        ESP_ARRAY_TOA_STRONGEST, 0.5);

    if (out_arrival) {
        out_arrival->emitter_id = 0;
        out_arrival->emit_us = 0;
        out_arrival->arrival_us = (int)(toa.time_sec * 1e6);
        out_arrival->distance_mm = (int)(toa.time_sec * 343000); // sound speed mm/s
    }

    return 0;
}

// Stub implementations for the firmware backend hooks.
// These mirror the simulator's JS firmware-backend.mjs and will be replaced
// by real ESP-IDF driver / task code as the hardware phase progresses.

esp_array_clock_sync_state_t esp_array_sync_clocks(void) {
    esp_array_clock_sync_state_t state = { .assumed_synced = true };
    return state;
}

esp_array_calibration_plan_t esp_array_make_plan(int node_count) {
    if (node_count <= 0) node_count = CONFIG_ESP_ARRAY_MAX_NODES;
    static esp_array_emission_t emissions_buf[32];
    int count = node_count;
    if (count > 32) count = 32;
    for (int i = 0; i < count; i++) {
        emissions_buf[i].emitter_id = i;
        emissions_buf[i].emit_clock_sec = ESP_ARRAY_FIRST_EMIT_SEC + (float)i * ESP_ARRAY_EMIT_GAP_SEC;
    }
    esp_array_calibration_plan_t plan = {
        .emission_count = count,
        .emissions = emissions_buf,
    };
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
