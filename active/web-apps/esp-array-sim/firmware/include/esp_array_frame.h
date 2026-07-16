// Generated from src/firmware-frame.mjs — do not hand-edit.
#ifndef ESP_ARRAY_FRAME_H
#define ESP_ARRAY_FRAME_H

#define ESP_ARRAY_FRAME_MAGIC "ESPA"
#define ESP_ARRAY_FRAME_VERSION 1
#define ESP_ARRAY_FRAME_KIND_CALIBRATION_PLAN 1
#define ESP_ARRAY_FRAME_KIND_LISTENER_ROW 2

// Suggested outer transport envelope for mesh packets.
typedef struct {
  char magic[4];
  unsigned short version;
  unsigned short kind;
  unsigned int payload_bytes;
} esp_array_frame_header_t;

#endif // ESP_ARRAY_FRAME_H
