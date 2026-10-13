/*
 * ESP32 Speaker↔Mic Sync Test — Single Full-Duplex I2S Port
 *
 * GPIO 22 → MAX98357A DIN   (TX data)
 * GPIO 23 ← INMP441 SD       (RX data)
 * GPIO 26 → BCLK (both MAX98357A + INMP441)
 * GPIO 25 → WS   (both MAX98357A + INMP441)
 */

#include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>
#include <string.h>

#define I2S_PORT       I2S_NUM_0
#define PIN_BCK        26
#define PIN_WS         25
#define PIN_DATA_OUT   22
#define PIN_DATA_IN    23

#define SAMPLE_RATE       48000
#define BUF_FRAMES        64
#define CLICK_FREQ        2000.0f
#define CLICK_CYCLES      4
#define CLICK_SAMPLES     (int)(CLICK_CYCLES * SAMPLE_RATE / CLICK_FREQ)
#define CAPTURE_SAMPLES   1024
#define RUNS              20

static int16_t gClick[CLICK_SAMPLES];
static float   gClickF[CLICK_SAMPLES];
static int16_t gMic[CAPTURE_SAMPLES];
static int     gOffsets[RUNS];
static int32_t gRawBuf[BUF_FRAMES * 2];
static int16_t gSpkBuf[BUF_FRAMES * 2];

static inline int32_t m24(int32_t r) { return r >> 8; }

static bool i2sInit() {
  i2s_config_t c = {};
  c.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX | I2S_MODE_RX);
  c.sample_rate = SAMPLE_RATE;
  c.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  c.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  c.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  c.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  c.dma_buf_count = 8; c.dma_buf_len = BUF_FRAMES;
  c.use_apll = true; c.tx_desc_auto_clear = true;
  c.fixed_mclk = 0; c.mclk_multiple = I2S_MCLK_MULTIPLE_256;
  c.bits_per_chan = I2S_BITS_PER_CHAN_16BIT;

  i2s_pin_config_t p = {
    .bck_io_num = PIN_BCK,
    .ws_io_num = PIN_WS,
    .data_out_num = PIN_DATA_OUT,
    .data_in_num = PIN_DATA_IN,
  };
  if (i2s_driver_install(I2S_PORT, &c, 0, NULL) != ESP_OK) return false;
  if (i2s_set_pin(I2S_PORT, &p) != ESP_OK) { i2s_driver_uninstall(I2S_PORT); return false; }
  return true;
}

static void buildClick() {
  for (int i = 0; i < CLICK_SAMPLES; i++) {
    float t = (float)i / SAMPLE_RATE;
    float v = sinf(2.0f * M_PI * CLICK_FREQ * t) * 3000.0f * 0.05f;
    int f = CLICK_SAMPLES / 8; if (f < 1) f = 1;
    float env = 1.0f;
    if (i < f) env = (float)i / f;
    else if (i >= CLICK_SAMPLES - f) env = (float)(CLICK_SAMPLES - 1 - i) / f;
    gClick[i] = (int16_t)(v * env);
    gClickF[i] = gClick[i];
  }
}

static void writeSilence() {
  memset(gSpkBuf, 0, sizeof(gSpkBuf));
  size_t w; i2s_write(I2S_PORT, gSpkBuf, sizeof(gSpkBuf), &w, portMAX_DELAY);
}

static void writeClick() {
  for (int i = 0; i < BUF_FRAMES; i++) {
    int16_t v = (i < CLICK_SAMPLES) ? gClick[i] : (int16_t)0;
    gSpkBuf[i*2] = v; gSpkBuf[i*2+1] = v;
  }
  size_t w; i2s_write(I2S_PORT, gSpkBuf, sizeof(gSpkBuf), &w, portMAX_DELAY);
}

static int findArrival() {
  float best = -1e30f; int bi = 0;
  int end = CAPTURE_SAMPLES - CLICK_SAMPLES;
  if (end > 768) end = 768;
  for (int o = 0; o < end; o++) {
    float s = 0;
    for (int k = 0; k < CLICK_SAMPLES; k++) s += (float)gMic[o+k] * gClickF[k];
    if (s > best) { best = s; bi = o; }
    if ((o & 127) == 127) yield();
  }
  return bi;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n========== ESP32 Sync Test (Full-Duplex I2S) ==========");
  Serial.printf("Pins: BCK=%d WS=%d DO=%d DI=%d | %d Hz | %d runs\n",
                PIN_BCK, PIN_WS, PIN_DATA_OUT, PIN_DATA_IN, SAMPLE_RATE, RUNS);

  if (!i2sInit()) { Serial.println("I2S INIT FAIL"); return; }
  Serial.println("Full-duplex I2S ready.");
  buildClick();

  // Prime the I2S pipeline with silence so BCLK/WS is running for the mic
  for (int i = 0; i < 4; i++) writeSilence();

  for (int r = 0; r < RUNS; r++) {
    Serial.printf("Run %02d...\n", r+1);
    memset(gMic, 0, sizeof(gMic));
    int micPos = 0;

    // Pre-click silence — write speaker + read mic together
    for (int c = 0; c < 4; c++) {
      writeSilence();
      size_t br = 0;
      i2s_read(I2S_PORT, gRawBuf, sizeof(gRawBuf), &br, pdMS_TO_TICKS(20));
      int got = (int)(br / sizeof(int32_t)) / 2;
      for (int s = 0; s < got && micPos < CAPTURE_SAMPLES; s++)
        gMic[micPos++] = (int16_t)(m24(gRawBuf[s*2]) >> 8);
    }

    // Click
    writeClick();
    {
      size_t br = 0;
      i2s_read(I2S_PORT, gRawBuf, sizeof(gRawBuf), &br, pdMS_TO_TICKS(20));
      int got = (int)(br / sizeof(int32_t)) / 2;
      for (int s = 0; s < got && micPos < CAPTURE_SAMPLES; s++)
        gMic[micPos++] = (int16_t)(m24(gRawBuf[s*2]) >> 8);
    }

    // Post-click silence until buffer full
    while (micPos < CAPTURE_SAMPLES) {
      writeSilence();
      size_t br = 0;
      i2s_read(I2S_PORT, gRawBuf, sizeof(gRawBuf), &br, pdMS_TO_TICKS(20));
      int got = (int)(br / sizeof(int32_t)) / 2;
      for (int s = 0; s < got && micPos < CAPTURE_SAMPLES; s++)
        gMic[micPos++] = (int16_t)(m24(gRawBuf[s*2]) >> 8);
      yield();
    }

    gOffsets[r] = findArrival();
  }

  // Stats
  double sum = 0, ssq = 0; int mn = 999999, mx = -999999;
  for (int i = 0; i < RUNS; i++) {
    int v = gOffsets[i]; sum += v; ssq += (double)v*v;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  double mean = sum/RUNS, var = ssq/RUNS - mean*mean;
  if (var < 0) var = 0; double sd = sqrt(var);
  Serial.println("\n===== Sync Stats =====");
  Serial.printf("Mean: %.1f samp (%.3f ms)  Std: %.1f samp (%.3f ms)\n",
                mean, mean/SAMPLE_RATE*1000, sd, sd/SAMPLE_RATE*1000);
  Serial.printf("Min: %d  Max: %d  Spread: %d (%.3f ms)\n",
                mn, mx, mx-mn, (double)(mx-mn)/SAMPLE_RATE*1000);
  for (int i = 0; i < RUNS; i++) {
    Serial.printf("  r%02d: %d\n", i+1, gOffsets[i]);
    if ((i&7)==7) yield();
  }

  i2s_driver_uninstall(I2S_PORT);
  Serial.println("Done. Deep sleep...");
  delay(5000);
  esp_deep_sleep_start();
}

void loop() {}
