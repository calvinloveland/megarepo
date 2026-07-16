#include "esp_array_dsp.h"
#include <math.h>
#include <float.h>
#include <string.h>
#include <stdlib.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Linear-FM chirp generation (mirrors src/dsp.mjs linearChirp).
int esp_array_linear_chirp(double* out, int max_samples,
                           double duration_sec, double f0_hz, double f1_hz,
                           double sample_rate_hz, int apply_window)
{
    int N = (int)(duration_sec * sample_rate_hz + 0.5);
    if (N < 2) N = 2;
    if (N > max_samples) N = max_samples;
    double T = duration_sec;
    double k = (f1_hz - f0_hz) / T; // sweep rate Hz/s
    for (int i = 0; i < N; i++) {
        double t = (double)i / sample_rate_hz;
        double phase = 2.0 * M_PI * (f0_hz * t + 0.5 * k * t * t);
        double v = cos(phase);
        if (apply_window) {
            double w = 0.5 - 0.5 * cos(2.0 * M_PI * (double)i / (double)(N - 1));
            v *= w;
        }
        out[i] = v;
    }
    return N;
}

// Normalized matched filter (mirrors src/dsp.mjs matchedFilter).
int esp_array_matched_filter(const double* signal, int signal_len,
                             const double* templ, int templ_len,
                             double* out, int out_len)
{
    int L = signal_len - templ_len + 1;
    if (L < 1) return -1;
    if (L > out_len) return -2;
    // Template energy
    double tmpl_energy = 0.0;
    for (int k = 0; k < templ_len; k++) tmpl_energy += templ[k] * templ[k];
    if (tmpl_energy < 1e-30) tmpl_energy = 1.0;
    for (int j = 0; j < L; j++) {
        double s = 0.0;
        for (int k = 0; k < templ_len; k++) s += signal[j + k] * templ[k];
        out[j] = s / tmpl_energy;
    }
    return L;
}

// Parabolic refinement around integer peak (mirrors src/dsp.mjs refinePeak).
static double refine_peak(const double* corr, int idx, int len)
{
    if (idx <= 0 || idx >= len - 1) return (double)idx;
    double ym = fabs(corr[idx - 1]);
    double y0 = fabs(corr[idx]);
    double yp = fabs(corr[idx + 1]);
    double denom = ym - 2.0 * y0 + yp;
    if (fabs(denom) < 1e-12) return (double)idx;
    double delta = 0.5 * (ym - yp) / denom;
    if (delta < -1.0 || delta > 1.0) return (double)idx;
    return (double)idx + delta;
}

static int argmax_abs(const double* corr, int len)
{
    int best = 0;
    double best_val = -DBL_MAX;
    for (int j = 0; j < len; j++) {
        double a = fabs(corr[j]);
        if (a > best_val) {
            best_val = a;
            best = j;
        }
    }
    return best;
}

// TOA estimation with strongest or earliest-peak mode (mirrors src/dsp.mjs estimateTOA).
esp_array_toa_result_t esp_array_estimate_toa(const double* signal, int signal_len,
                                               const double* templ, int templ_len,
                                               double sample_rate_hz,
                                               esp_array_toa_mode_t mode,
                                               double peak_threshold)
{
    esp_array_toa_result_t result = { 0.0, 0.0, 0.0 };
    if (signal_len < templ_len || templ_len < 2) return result;
    int L = signal_len - templ_len + 1;
    // Allocate correlation buffer on heap if large, else stack placeholder.
    double corr_buf[4096];
    double* corr = corr_buf;
    int corr_free = 4096;
    int needs_free = 0;
    if (L > 4096) {
        corr = (double*)malloc((size_t)L * sizeof(double));
        if (!corr) return result;
        needs_free = 1;
        corr_free = L;
    }
    int ret = esp_array_matched_filter(signal, signal_len, templ, templ_len, corr, corr_free);
    if (ret < 0) {
        if (needs_free) free(corr);
        return result;
    }

    if (mode == ESP_ARRAY_TOA_EARLIEST) {
        double global_max = 0.0;
        for (int j = 0; j < L; j++) {
            double a = fabs(corr[j]);
            if (a > global_max) global_max = a;
        }
        double thr = peak_threshold * global_max;
        // Local maxima above threshold
        int maxima[4096];
        int nmax = 0;
        for (int j = 1; j < L - 1; j++) {
            double a = fabs(corr[j]);
            if (a >= thr && a >= fabs(corr[j - 1]) && a >= fabs(corr[j + 1])) {
                if (nmax < 4096) maxima[nmax++] = j;
            }
        }
        // Cluster within one template length
        int min_sep = templ_len;
        int clusters[4096];
        int nclust = 0;
        for (int ci = 0; ci < nmax; ci++) {
            int j = maxima[ci];
            if (nclust > 0 && j - clusters[nclust - 1] <= min_sep) {
                if (fabs(corr[j]) > fabs(corr[clusters[nclust - 1]]))
                    clusters[nclust - 1] = j;
            } else {
                if (nclust < 4096) clusters[nclust++] = j;
            }
        }
        int idx = (nclust > 0) ? clusters[0] : argmax_abs(corr, L);
        double lag = refine_peak(corr, idx, L);
        double peak = corr[idx];
        if (needs_free) free(corr);
        result.lag_samples = lag;
        result.time_sec = lag / sample_rate_hz;
        result.peak = peak;
        return result;
    }

    // Strongest peak
    int idx = argmax_abs(corr, L);
    double lag = refine_peak(corr, idx, L);
    double peak = corr[idx];
    if (needs_free) free(corr);
    result.lag_samples = lag;
    result.time_sec = lag / sample_rate_hz;
    result.peak = peak;
    return result;
}
