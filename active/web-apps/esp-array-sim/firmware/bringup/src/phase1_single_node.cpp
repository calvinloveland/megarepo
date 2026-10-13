/*
 * ESP32 Phase-1 Single-Node Hardware Test
 *
 * Minimal bring-up pass for the speaker + microphone path:
 *   - very quiet 440 Hz test tone
 *   - microphone capture + clarity diagnostics
 *   - long startup grace period so speaker power can be connected safely
 *
 * Tuned config from on-device mic sweep:
 *   - speaker: 16-bit stereo, I2S Philips (STAND_I2S)
 *   - fixed software gain: 0.001 (extremely quiet)
 */

#include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>
#include <string.h>

#define SPEAKER_PORT I2S_NUM_0
#define MIC_PORT     I2S_NUM_1

#define SPK_BCK_PIN  26
#define SPK_WS_PIN   25
#define SPK_DATA_PIN 22

#define MIC_SCK_PIN  19
#define MIC_WS_PIN   21
#define MIC_DATA_PIN 23

#define SAMPLE_RATE          48000
#define BUFFER_FRAMES        64
#define TONE_CAPTURE_FRAMES  2048
#define MIC_MAX_24BIT        8388607.0

static constexpr float TEST_FREQ_HZ = 440.0f;
static constexpr float FIXED_MASTER_GAIN = 0.001f;
static constexpr float BASE_AMPLITUDE = 1200.0f;
static constexpr float ANALYSIS_LOWPASS_ALPHA = 0.18f;
static constexpr int STARTUP_GRACE_MS = 15000;
static constexpr float NOTE_C4 = 261.63f;
static constexpr float NOTE_E4 = 329.63f;
static constexpr float NOTE_G4 = 392.00f;
static constexpr float NOTE_A4 = 440.00f;
static constexpr float NOTE_C5 = 523.25f;

struct NoteEvent {
  float freqHz;
  int durationMs;
  int pauseAfterMs;
};

struct ChannelStats {
  uint64_t sampleCount = 0;
  double sumSquares = 0.0;
  int32_t peakAbs = 0;
};

struct StereoMicStats {
  ChannelStats left;
  ChannelStats right;
};

struct ClarityResult {
  double totalRms = 0.0;
  double fundRms = 0.0;
  double harm2Rms = 0.0;
  double harm3Rms = 0.0;
  double residualRms = 0.0;
  double fundOverSilenceDb = 0.0;
  double worstHarmonicVsFundDb = 0.0;
  double clarityDb = -999.0;
  float dominantFreqHz = 0.0f;
  double dominantFreqRms = 0.0;
};

static bool gMicReady = false;
static int32_t gToneCapture[TONE_CAPTURE_FRAMES] = {0};
static int32_t gToneCaptureFiltered[TONE_CAPTURE_FRAMES] = {0};

// ---------------------------------------------------------------------------
// Mic helpers
// ---------------------------------------------------------------------------
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
  if (!gMicReady) return;
  int32_t raw[BUFFER_FRAMES * 2];
  while (true) {
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(MIC_PORT, raw, sizeof(raw), &bytesRead, 0);
    if (err != ESP_OK || bytesRead == 0) break;
  }
}

static void micCaptureFrames(int frames,
                             StereoMicStats *stats,
                             int32_t *leftCapture = nullptr,
                             int captureCapacity = 0,
                             int *captureFilled = nullptr) {
  if (!gMicReady) return;
  int32_t raw[BUFFER_FRAMES * 2];
  int remaining = frames;
  while (remaining > 0) {
    int chunkFrames = remaining < BUFFER_FRAMES ? remaining : BUFFER_FRAMES;
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
    remaining -= gotFrames;
  }
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

static void printStereoStats(const char *label, const StereoMicStats &stats) {
  auto printChannel = [](const char *name, const ChannelStats &st) {
    double rms = channelRms(st);
    Serial.printf("  %s rms: %.1f (%.1f dBFS), peak=%ld\n",
                  name, rms, dbfsFromLinear(rms), (long)st.peakAbs);
  };
  Serial.println(label);
  printChannel("left ", stats.left);
  printChannel("right", stats.right);
}

// ---------------------------------------------------------------------------
// Tone clarity analysis
// ---------------------------------------------------------------------------
static double bufferRms(const int32_t *samples, int count) {
  if (count <= 0) return 0.0;
  double sumSquares = 0.0;
  for (int i = 0; i < count; i++) {
    double x = (double)samples[i];
    sumSquares += x * x;
    if ((i & 255) == 255) yield();
  }
  return sqrt(sumSquares / (double)count);
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

static void lowPassFilter(const int32_t *samples, int count, int32_t *out, float alpha) {
  if (count <= 0 || !out) return;
  double y = (double)samples[0];
  out[0] = samples[0];
  for (int i = 1; i < count; i++) {
    y += ((double)samples[i] - y) * (double)alpha;
    out[i] = (int32_t)y;
    if ((i & 255) == 255) yield();
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

static ClarityResult analyzeTone(const int32_t *samples, int count, double silenceRms) {
  ClarityResult r;
  if (count <= 0) return r;
  r.totalRms = bufferRms(samples, count);
  r.fundRms = sineComponentRms(samples, count, TEST_FREQ_HZ);
  r.harm2Rms = sineComponentRms(samples, count, TEST_FREQ_HZ * 2.0f);
  r.harm3Rms = sineComponentRms(samples, count, TEST_FREQ_HZ * 3.0f);
  estimateDominantFreq(samples, count, 50.0f, 3000.0f, 5.0f, &r.dominantFreqHz, &r.dominantFreqRms);
  double residualSq = r.totalRms * r.totalRms - r.fundRms * r.fundRms;
  if (residualSq < 0.0) residualSq = 0.0;
  r.residualRms = sqrt(residualSq);
  double worstHarm = r.harm2Rms > r.harm3Rms ? r.harm2Rms : r.harm3Rms;
  r.fundOverSilenceDb = dbfsFromLinear(r.fundRms > 1.0 ? r.fundRms : 1.0) - dbfsFromLinear(silenceRms > 1.0 ? silenceRms : 1.0);
  r.worstHarmonicVsFundDb = dbfsFromLinear(worstHarm > 1.0 ? worstHarm : 1.0) - dbfsFromLinear(r.fundRms > 1.0 ? r.fundRms : 1.0);
  r.clarityDb = dbfsFromLinear(r.fundRms > 1.0 ? r.fundRms : 1.0) - dbfsFromLinear(r.residualRms > 1.0 ? r.residualRms : 1.0);
  return r;
}

static void printClarity(const ClarityResult &r, int capturedFrames) {
  Serial.println("Tone-clarity analysis (left mic channel):");
  Serial.printf("  captured frames:       %d\n", capturedFrames);
  Serial.printf("  total rms:             %.1f (%.1f dBFS)\n", r.totalRms, dbfsFromLinear(r.totalRms > 1.0 ? r.totalRms : 1.0));
  Serial.printf("  fundamental 440Hz:     %.1f (%.1f dBFS)\n", r.fundRms, dbfsFromLinear(r.fundRms > 1.0 ? r.fundRms : 1.0));
  Serial.printf("  2nd harmonic 880Hz:    %.1f (%.1f dBFS)\n", r.harm2Rms, dbfsFromLinear(r.harm2Rms > 1.0 ? r.harm2Rms : 1.0));
  Serial.printf("  3rd harmonic 1320Hz:   %.1f (%.1f dBFS)\n", r.harm3Rms, dbfsFromLinear(r.harm3Rms > 1.0 ? r.harm3Rms : 1.0));
  Serial.printf("  residual rms:          %.1f (%.1f dBFS)\n", r.residualRms, dbfsFromLinear(r.residualRms > 1.0 ? r.residualRms : 1.0));
  Serial.printf("  dominant frequency:    %.1f Hz (%.1f dBFS)\n", r.dominantFreqHz, dbfsFromLinear(r.dominantFreqRms > 1.0 ? r.dominantFreqRms : 1.0));
  Serial.printf("  fund over silence:     %.1f dB\n", r.fundOverSilenceDb);
  Serial.printf("  worst harmonic vs fund %.1f dB\n", r.worstHarmonicVsFundDb);
  Serial.printf("  clarity score:         %.1f dB\n", r.clarityDb);
}

// ---------------------------------------------------------------------------
// Speaker helpers
// ---------------------------------------------------------------------------
static bool initSpeakerI2s() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = BUFFER_FRAMES,
    .use_apll = true,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0,
    .mclk_multiple = I2S_MCLK_MULTIPLE_256,
    .bits_per_chan = I2S_BITS_PER_CHAN_16BIT,
  };
  i2s_pin_config_t pins = {
    .bck_io_num = SPK_BCK_PIN,
    .ws_io_num = SPK_WS_PIN,
    .data_out_num = SPK_DATA_PIN,
    .data_in_num = I2S_PIN_NO_CHANGE,
  };
  if (i2s_driver_install(SPEAKER_PORT, &cfg, 0, NULL) != ESP_OK) return false;
  if (i2s_set_pin(SPEAKER_PORT, &pins) != ESP_OK) {
    i2s_driver_uninstall(SPEAKER_PORT);
    return false;
  }
  return true;
}

static void streamSilence(int durationMs, StereoMicStats *micStats = nullptr) {
  int totalFrames = (SAMPLE_RATE * durationMs) / 1000;
  int16_t buf[BUFFER_FRAMES * 2];
  int pos = 0;
  while (pos < totalFrames) {
    int chunk = (totalFrames - pos < BUFFER_FRAMES) ? (totalFrames - pos) : BUFFER_FRAMES;
    memset(buf, 0, chunk * 2 * sizeof(int16_t));
    size_t written = 0;
    i2s_write(SPEAKER_PORT, buf, chunk * 2 * sizeof(int16_t), &written, portMAX_DELAY);
    micCaptureFrames(chunk, micStats);
    pos += chunk;
  }
}

static void streamNote(float freqHz,
                       int durationMs,
                       float amplitude,
                       StereoMicStats *micStats = nullptr,
                       int32_t *leftCapture = nullptr,
                       int captureCapacity = 0,
                       int *captureFilled = nullptr) {
  int totalFrames = (SAMPLE_RATE * durationMs) / 1000;
  int16_t buf[BUFFER_FRAMES * 2];
  int pos = 0;
  while (pos < totalFrames) {
    int chunk = (totalFrames - pos < BUFFER_FRAMES) ? (totalFrames - pos) : BUFFER_FRAMES;
    for (int i = 0; i < chunk; i++) {
      int frameIndex = pos + i;
      float t = (float)frameIndex / (float)SAMPLE_RATE;
      float sample = sinf(2.0f * (float)M_PI * freqHz * t) * amplitude * FIXED_MASTER_GAIN;
      int16_t v = (int16_t)sample;
      buf[i * 2] = v;
      buf[i * 2 + 1] = v;
    }
    size_t written = 0;
    i2s_write(SPEAKER_PORT, buf, chunk * 2 * sizeof(int16_t), &written, portMAX_DELAY);
    micCaptureFrames(chunk, micStats, leftCapture, captureCapacity, captureFilled);
    pos += chunk;
  }
}

static void streamChord(float f1, float f2, float f3, int durationMs, StereoMicStats *micStats = nullptr) {
  int totalFrames = (SAMPLE_RATE * durationMs) / 1000;
  int16_t buf[BUFFER_FRAMES * 2];
  int pos = 0;
  while (pos < totalFrames) {
    int chunk = (totalFrames - pos < BUFFER_FRAMES) ? (totalFrames - pos) : BUFFER_FRAMES;
    for (int i = 0; i < chunk; i++) {
      int frameIndex = pos + i;
      float t = (float)frameIndex / (float)SAMPLE_RATE;
      float sample = (
        sinf(2.0f * (float)M_PI * f1 * t) +
        sinf(2.0f * (float)M_PI * f2 * t) +
        sinf(2.0f * (float)M_PI * f3 * t)
      ) * 350.0f * FIXED_MASTER_GAIN;
      int16_t v = (int16_t)sample;
      buf[i * 2] = v;
      buf[i * 2 + 1] = v;
    }
    size_t written = 0;
    i2s_write(SPEAKER_PORT, buf, chunk * 2 * sizeof(int16_t), &written, portMAX_DELAY);
    micCaptureFrames(chunk, micStats);
    pos += chunk;
  }
}

static void playMelody(StereoMicStats *micStats = nullptr) {
  const NoteEvent melody[] = {
    { NOTE_C4, 260, 40 },
    { NOTE_E4, 260, 40 },
    { NOTE_G4, 260, 40 },
    { NOTE_A4, 320, 60 },
    { NOTE_G4, 260, 40 },
    { NOTE_E4, 260, 40 },
    { NOTE_C4, 420, 120 },
  };

  streamChord(NOTE_C4, NOTE_E4, NOTE_G4, 700, micStats);
  streamSilence(100, micStats);
  for (const NoteEvent &note : melody) {
    streamNote(note.freqHz, note.durationMs, BASE_AMPLITUDE, micStats);
    if (note.pauseAfterMs > 0) streamSilence(note.pauseAfterMs, micStats);
  }
  streamChord(NOTE_C4, NOTE_E4, NOTE_C5, 900, micStats);
  streamSilence(200, micStats);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n========== ESP32 Phase-1 Single-Node Hardware Test ==========");
  Serial.println("Speaker config: 16-bit stereo / STAND_I2S (best measured config)");
  Serial.printf("Fixed gain: %.3f | measured tone: %.0f Hz\n", FIXED_MASTER_GAIN, TEST_FREQ_HZ);
  Serial.printf("Startup grace: %d ms (connect speaker power now)\n", STARTUP_GRACE_MS);
  delay(STARTUP_GRACE_MS);

  if (!initSpeakerI2s()) {
    Serial.println("*** Speaker init FAILED ***");
    return;
  }
  Serial.println("Speaker initialized.");

  gMicReady = initMicI2s();
  if (!gMicReady) {
    Serial.println("*** Microphone init FAILED ***");
    return;
  }
  Serial.println("Microphone initialized.");

  StereoMicStats silenceStats;
  StereoMicStats toneStats;

  micFlush();
  memset(gToneCapture, 0, sizeof(gToneCapture));
  int toneCaptureFilled = 0;

  Serial.println("Silence section (1 s)...");
  streamSilence(1000, &silenceStats);
  printStereoStats("Silence mic stats:", silenceStats);
  double silenceBest = max(channelRms(silenceStats.left), channelRms(silenceStats.right));
  micFlush();

  Serial.println("Measured 440 Hz tone section (1.0 s)...");
  streamNote(TEST_FREQ_HZ, 1000, BASE_AMPLITUDE, &toneStats, gToneCapture, TONE_CAPTURE_FRAMES, &toneCaptureFilled);
  printStereoStats("Measured-tone mic stats:", toneStats);
  memset(gToneCaptureFiltered, 0, sizeof(gToneCaptureFiltered));
  lowPassFilter(gToneCapture, toneCaptureFilled, gToneCaptureFiltered, ANALYSIS_LOWPASS_ALPHA);
  Serial.printf("Applying low-pass filter to mic capture for analysis (alpha=%.2f).\n", ANALYSIS_LOWPASS_ALPHA);
  ClarityResult clarity = analyzeTone(gToneCaptureFiltered, toneCaptureFilled, silenceBest);
  printClarity(clarity, toneCaptureFilled);
  micFlush();

  Serial.println("Phase-1 hardware test complete.");

  i2s_driver_uninstall(MIC_PORT);
  i2s_driver_uninstall(SPEAKER_PORT);
  Serial.println("Done. Deep sleep in 5 s...");
  delay(5000);
  esp_deep_sleep_start();
}

void loop() {}
