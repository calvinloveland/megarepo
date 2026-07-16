#include "esp_array_dsp.h"
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

// Verify that the C DSP produces a TOA matching the known true delay.
// Generate a chirp, shift it by known_delay, run matched-filter, check result.

#define SR 48000.0
#define DUR 0.002
#define F0  3000.0
#define F1  8000.0
#define MAX_S 2000

int main(void) {
    double chirp[MAX_S];
    int N = esp_array_linear_chirp(chirp, MAX_S, DUR, F0, F1, SR, 1);
    if (N < 2) { fprintf(stderr, "chirp too short\n"); return 1; }

    int known_delay = 37; // samples
    int sig_len = N + known_delay + 100;
    double* signal = (double*)calloc((size_t)sig_len, sizeof(double));
    for (int i = 0; i < N; i++) signal[known_delay + i] = chirp[i];

    esp_array_toa_result_t toa = esp_array_estimate_toa(
        signal, sig_len, chirp, N, SR,
        ESP_ARRAY_TOA_STRONGEST, 0.5
    );

    double err = fabs(toa.lag_samples - (double)known_delay);
    printf("C DSP: known_delay=%d  est_lag=%.4f samples  err=%.4f\n",
           known_delay, toa.lag_samples, err);

    free(signal);

    if (err > 1.0) {
        fprintf(stderr, "TOA error too large: %.4f samples\n", err);
        return 1;
    }
    printf("OK: TOA within threshold\n");
    return 0;
}
