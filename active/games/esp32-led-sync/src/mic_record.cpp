/*
 * ESP32 INMP441 mic recorder
 *
 * Captures a short mono recording from the left INMP441 channel and sends raw
 * PCM16 over USB serial so a host script can save it as a WAV file.
 */

#include <Arduino.h>
#include "driver/i2s.h"

#define MIC_PORT     I2S_NUM_1
#define MIC_SCK_PIN  19
#define MIC_WS_PIN   21
#define MIC_DATA_PIN 23

#define SAMPLE_RATE       16000
#define BUFFER_FRAMES     64
#define CAPTURE_SECONDS   2
#define CAPTURE_SAMPLES   (SAMPLE_RATE * CAPTURE_SECONDS)

static int16_t gPcm[CAPTURE_SAMPLES] = {0};

static inline int32_t mic24From32(int32_t raw) {
  return raw >> 8;
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

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n========== ESP32 INMP441 Mic Recorder ==========");
  Serial.printf("Capturing %d second(s) at %d Hz from left mic channel...\n", CAPTURE_SECONDS, SAMPLE_RATE);

  if (!initMicI2s()) {
    Serial.println("*** Microphone init FAILED ***");
    return;
  }
  Serial.println("Microphone initialized.");
  Serial.println("Capture starts in 2 seconds...");
  delay(2000);
  micFlush();

  int32_t raw[BUFFER_FRAMES * 2];
  int captured = 0;
  while (captured < CAPTURE_SAMPLES) {
    int framesNeeded = CAPTURE_SAMPLES - captured;
    int chunkFrames = framesNeeded < BUFFER_FRAMES ? framesNeeded : BUFFER_FRAMES;
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(MIC_PORT, raw, chunkFrames * 2 * sizeof(int32_t), &bytesRead, portMAX_DELAY);
    if (err != ESP_OK || bytesRead == 0) break;
    int stereoSamples = (int)(bytesRead / sizeof(int32_t));
    int gotFrames = stereoSamples / 2;
    for (int i = 0; i < gotFrames && captured < CAPTURE_SAMPLES; i++) {
      int32_t sample24 = mic24From32(raw[i * 2]);
      gPcm[captured++] = (int16_t)(sample24 >> 8);
    }
  }

  i2s_driver_uninstall(MIC_PORT);
  Serial.printf("Captured %d samples.\n", captured);
  Serial.printf("BEGIN_RAW %d %d\n", SAMPLE_RATE, captured);
  Serial.write((const uint8_t *)gPcm, captured * sizeof(int16_t));
  Serial.println();
  Serial.println("END_RAW");
  Serial.println("Recorder done. Deep sleep in 5 s...");
  delay(5000);
  esp_deep_sleep_start();
}

void loop() {}
