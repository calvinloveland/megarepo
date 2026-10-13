/*
 * ESP32 INMP441 Ambient Mic Monitor
 *
 * Mic-only test: captures several 1-second windows from the INMP441 and prints
 * basic level stats plus a coarse dominant-frequency estimate so we can confirm
 * the microphone is hearing real room audio (e.g. a TV).
 */

#include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>
#include <string.h>

#define MIC_PORT     I2S_NUM_1
#define MIC_SCK_PIN  19
#define MIC_WS_PIN   21
#define MIC_DATA_PIN 23

#define SAMPLE_RATE          48000
#define BUFFER_FRAMES        64
#define ANALYSIS_FRAMES      2048
#define WINDOW_MS            1000
#define WINDOW_COUNT         6
#define MIC_MAX_24BIT        8388607.0

struct ChannelStats {
  uint64_t sampleCount = 0;
  double sumSquares = 0.0;
  int32_t peakAbs = 0;
};

struct StereoMicStats {
  ChannelStats left;
  ChannelStats right;
};

static int32_t gCapture[ANALYSIS_FRAMES] = {0};
static int32_t gFiltered[ANALYSIS_FRAMES] = {0};

static inline int32_t mic24From32(int32_t raw) {
  return raw >> 8;
}

static void accumulateChannel(ChannelStats &stats, int32_t raw) {
  int32_t sample = mic24From32(raw);
  int32_t absSample = sample >= 0 ? sample : -sample;
  if (absSample > stats.peakAbs) stats.peakAbs = absSample;
  stats.sumSquares += (double)sample * (double)sample;
  stats.sampleCount++;
}

static double channelRms(const ChannelStats &stats) {
  if (stats.sampleCount == 0) return 0.0;
  return sqrt(stats.sumSquares / (double)stats.sampleCount);
}

static double dbfsFromLinear(double value) {
  double norm = value / MIC_MAX_24BIT;
  if (norm < 1e-12) norm = 1e-12;
  return 20.0 * log10(norm);
}

static bool initMicI2s() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = BUFFER_FRAMES,
    .use_apll = true,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0,
    .mclk_multiple = I2S_MCLK_MULTIPLE_256,
    .bits_per_chan = I2S_BITS_PER_CHAN_32BIT,
  };
  i2s_pin_config_t pins = {
    .bck_io_num = MIC_SCK_PIN,
    .ws_io_num = MIC_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = MIC_DATA_PIN,
  };
  if (i2s_driver_install(MIC_PORT, &cfg, 0, NULL) != ESP_OK) return false;
  if (i2s_set_pin(MIC_PORT, &pins) != ESP_OK) {
    i2s_driver_uninstall(MIC_PORT);
    return false;
  }
  return true;
}

static void micFlush() {
  int32_t raw[BUFFER_FRAMES * 2];
  while (true) {
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(MIC_PORT, raw, sizeof(raw), &bytesRead, 0);
    if (err != ESP_OK || bytesRead == 0) break;
  }
}

static void micCaptureWindow(StereoMicStats *stats, int32_t *leftCapture, int captureCapacity, int *captureFilled) {
  int framesRemaining = (SAMPLE_RATE * WINDOW_MS) / 1000;
  int32_t raw[BUFFER_FRAMES * 2];
  while (framesRemaining > 0) {
    int chunkFrames = framesRemaining < BUFFER_FRAMES ? framesRemaining : BUFFER_FRAMES;
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(MIC_PORT, raw, chunkFrames * 2 * sizeof(int32_t), &bytesRead, pdMS_TO_TICKS(20));
    if (err != ESP_OK || bytesRead == 0) break;
    int stereoSamples = (int)(bytesRead / sizeof(int32_t));
    int gotFrames = stereoSamples / 2;
    for (int i = 0; i < gotFrames; i++) {
      if (stats) {
        accumulateChannel(stats->left, raw[i * 2]);
        accumulateChannel(stats->right, raw[i * 2 + 1]);
      }
      if (leftCapture && captureFilled && *captureFilled < captureCapacity) {
        leftCapture[*captureFilled] = mic24From32(raw[i * 2]);
        (*captureFilled)++;
      }
    }
    framesRemaining -= gotFrames;
  }
}

static double sineComponentRms(const int32_t *samples, int count, float freqHz) {
  if (count <= 0) return 0.0;
  double sumSin = 0.0;
  double sumCos = 0.0;
  const double w = 2.0 * M_PI * (double)freqHz / (double)SAMPLE_RATE;
  for (int n = 0; n < count; n++) {
    double x = (double)samples[n];
    double phase = w * (double)n;
    sumSin += x * sin(phase);
    sumCos += x * cos(phase);
    if ((n & 255) == 255) yield();
  }
  double amplitude = (2.0 / (double)count) * sqrt(sumSin * sumSin + sumCos * sumCos);
  return amplitude / sqrt(2.0);
}

static void dcBlock(const int32_t *samples, int count, int32_t *out) {
  if (count <= 0 || !out) return;
  double mean = 0.0;
  for (int i = 0; i < count; i++) {
    mean += (double)samples[i];
  }
  mean /= (double)count;
  for (int i = 0; i < count; i++) {
    out[i] = (int32_t)((double)samples[i] - mean);
  }
}

static void estimateDominantFreq(const int32_t *samples,
                                 int count,
                                 float minHz,
                                 float maxHz,
                                 float stepHz,
                                 float *outFreqHz,
                                 double *outRms) {
  float bestFreq = 0.0f;
  double bestRms = 0.0;
  for (float freq = minHz; freq <= maxHz; freq += stepHz) {
    double rms = sineComponentRms(samples, count, freq);
    if (rms > bestRms) {
      bestRms = rms;
      bestFreq = freq;
    }
    yield();
  }
  if (outFreqHz) *outFreqHz = bestFreq;
  if (outRms) *outRms = bestRms;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n========== ESP32 INMP441 Ambient Mic Monitor ==========");
  Serial.printf("Mic pins: SCK=%d WS=%d SD=%d | sample rate=%d\n", MIC_SCK_PIN, MIC_WS_PIN, MIC_DATA_PIN, SAMPLE_RATE);

  if (!initMicI2s()) {
    Serial.println("*** Microphone init FAILED ***");
    return;
  }
  Serial.println("Microphone initialized.");
  micFlush();

  for (int window = 0; window < WINDOW_COUNT; window++) {
    StereoMicStats stats;
    memset(gCapture, 0, sizeof(gCapture));
    memset(gFiltered, 0, sizeof(gFiltered));
    int captureFilled = 0;

    micCaptureWindow(&stats, gCapture, ANALYSIS_FRAMES, &captureFilled);
    dcBlock(gCapture, captureFilled, gFiltered);

    float humFreqHz = 0.0f;
    double humBandRms = 0.0;
    estimateDominantFreq(gFiltered, captureFilled, 40.0f, 80.0f, 1.0f, &humFreqHz, &humBandRms);
    double rms50 = sineComponentRms(gFiltered, captureFilled, 50.0f);
    double rms60 = sineComponentRms(gFiltered, captureFilled, 60.0f);
    double rms120 = sineComponentRms(gFiltered, captureFilled, 120.0f);

    double leftRms = channelRms(stats.left);
    double rightRms = channelRms(stats.right);
    Serial.printf("Window %02d/%02d | left rms=%.1f (%.1f dBFS) peak=%ld | right rms=%.1f (%.1f dBFS) peak=%ld\n",
                  window + 1, WINDOW_COUNT,
                  leftRms, dbfsFromLinear(leftRms), (long)stats.left.peakAbs,
                  rightRms, dbfsFromLinear(rightRms), (long)stats.right.peakAbs);
    Serial.printf("  DC-blocked hum scan: dominant %.1f Hz (%.1f dBFS) | 50 Hz %.1f dBFS | 60 Hz %.1f dBFS | 120 Hz %.1f dBFS\n",
                  humFreqHz,
                  dbfsFromLinear(humBandRms > 1.0 ? humBandRms : 1.0),
                  dbfsFromLinear(rms50 > 1.0 ? rms50 : 1.0),
                  dbfsFromLinear(rms60 > 1.0 ? rms60 : 1.0),
                  dbfsFromLinear(rms120 > 1.0 ? rms120 : 1.0));
  }

  i2s_driver_uninstall(MIC_PORT);
  Serial.println("Ambient mic monitor complete. Deep sleep in 5 s...");
  delay(5000);
  esp_deep_sleep_start();
}

void loop() {}
