#ifndef ESP_ARRAY_DSP_H
#define ESP_ARRAY_DSP_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Generate a linear-FM (chirp) template. Caller provides the output buffer.
 * Returns the number of samples written.
 */
int esp_array_linear_chirp(double* out, int max_samples,
                           double duration_sec, double f0_hz, double f1_hz,
                           double sample_rate_hz, int apply_window);

/**
 * Normalized matched filter: cross-correlate signal against template.
 * out[j] = sum_k signal[j+k] * template[k] / template_energy.
 * out_length = signal_len - template_len + 1.
 * Returns 0 on success.
 */
int esp_array_matched_filter(const double* signal, int signal_len,
                             const double* templ, int templ_len,
                             double* out, int out_len);

/**
 * TOA estimation modes.
 */
typedef enum {
    ESP_ARRAY_TOA_STRONGEST = 0,
    ESP_ARRAY_TOA_EARLIEST  = 1,
} esp_array_toa_mode_t;

/**
 * Estimated TOA result.
 */
typedef struct {
    double lag_samples;   /**< fractional sample lag */
    double time_sec;      /**< lag / sample_rate_hz */
    double peak;          /**< correlation magnitude at the selected peak */
} esp_array_toa_result_t;

/**
 * Estimate TOA of a template inside a signal using matched-filter + parabolic refine.
 */
esp_array_toa_result_t esp_array_estimate_toa(const double* signal, int signal_len,
                                               const double* templ, int templ_len,
                                               double sample_rate_hz,
                                               esp_array_toa_mode_t mode,
                                               double peak_threshold);

#ifdef __cplusplus
}
#endif

#endif // ESP_ARRAY_DSP_H
