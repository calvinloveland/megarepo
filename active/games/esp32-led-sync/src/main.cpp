/*
 * ESP32 LED + Buzzer Round-Robin Sync
 *
 * Three boards, each with an LED + piezo buzzer.
 * Only ONE fires at a time, rotating:
 *   Node 0 → Node 1 → Node 2 → Node 0 → ...
 *
 * Each node plays a different note so you hear a
 * rotating three-note melody. LED follows the same pattern.
 *
 * Sync: microsecond timer per node + ESP-NOW timestamp resync.
 * All boards forced to WiFi channel 1.
 *
 * Hardware:
 *   LED    - GPIO 2 (active LOW)
 *   Buzzer - GPIO 4 (piezo, GND to GND, signal to GPIO 4)
 *
 * NODE_ID set at compile time via CONFIG_NODE_ID build flag.
 */

#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_timer.h>

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#define NODE_ID      CONFIG_NODE_ID
#define LED_PIN      2
#define BUZZER_PIN   4
#define SLOT_MS      500
#define CHANNEL      1

// Each node plays a different pitch (C5, E5, G5 = C major triad)
static const int TONE_FREQ[3] = { 523, 659, 784 };  // C5, E5, G5

// ---------------------------------------------------------------------------
// ESP-NOW packet
// ---------------------------------------------------------------------------

struct __attribute__((packed)) SyncPacket {
  uint32_t slot;
  int64_t  masterTick;
};

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static volatile uint32_t currentSlot    = 0;
static volatile int64_t  lastSlotChange = 0;

static const uint8_t broadcastMac[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// ---------------------------------------------------------------------------
// LED + Buzzer helper
// ---------------------------------------------------------------------------

static void updateOutputs() {
  bool on = (currentSlot % 3 == NODE_ID);

  // LED (active LOW)
  digitalWrite(LED_PIN, on ? LOW : HIGH);

  // Buzzer tone
  if (on) {
    ledcWriteTone(0, TONE_FREQ[NODE_ID]);
  } else {
    ledcWriteTone(0, 0);  // silence
  }
}

// ---------------------------------------------------------------------------
// ESP-NOW receive callback
// ---------------------------------------------------------------------------

static void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
  if (len != sizeof(SyncPacket)) return;
  const SyncPacket *pkt = reinterpret_cast<const SyncPacket *>(data);
  lastSlotChange = esp_timer_get_time();
  currentSlot    = pkt->slot;
  updateOutputs();
}

// ---------------------------------------------------------------------------
// ESP-NOW initialisation
// ---------------------------------------------------------------------------

static bool initESPNow() {
  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) return false;

  // Set channel AFTER WiFi is running (esp_now_init starts it)
  esp_wifi_set_channel(CHANNEL, WIFI_SECOND_CHAN_NONE);

  esp_now_register_recv_cb(onDataRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, broadcastMac, 6);
  peer.channel   = CHANNEL;
  peer.ifidx     = WIFI_IF_STA;
  peer.encrypt   = false;

  if (esp_now_add_peer(&peer) != ESP_OK) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);          // LED off

  // Set up buzzer on LEDC channel 0
  ledcAttachPin(BUZZER_PIN, 0);

  if (!initESPNow()) {
    while (true) {                      // SOS blink
      digitalWrite(LED_PIN, LOW);  delay(200);
      digitalWrite(LED_PIN, HIGH); delay(200);
      digitalWrite(LED_PIN, LOW);  delay(200);
      digitalWrite(LED_PIN, HIGH); delay(200);
      digitalWrite(LED_PIN, LOW);  delay(200);
      digitalWrite(LED_PIN, HIGH); delay(600);
    }
  }

  lastSlotChange = esp_timer_get_time();
  updateOutputs();

  Serial.printf("Node %d | MAC: %s | Tone: %d Hz\n",
                NODE_ID, WiFi.macAddress().c_str(), TONE_FREQ[NODE_ID]);
}

void loop() {
  int64_t now = esp_timer_get_time();

  if (now - lastSlotChange >= (int64_t)SLOT_MS * 1000) {
    lastSlotChange = now;
    currentSlot++;
    updateOutputs();

    if (NODE_ID == 0) {
      SyncPacket pkt = { currentSlot, now };
      esp_now_send(const_cast<uint8_t *>(broadcastMac),
                   reinterpret_cast<const uint8_t *>(&pkt),
                   sizeof(pkt));
    }
  }
}
