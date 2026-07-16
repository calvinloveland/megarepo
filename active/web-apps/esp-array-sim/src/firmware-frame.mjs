// Binary/frame-level metadata for firmware transport. This sits below the
// JSON/wire-format payload shapes and gives the future ESP32 mesh packets a
// concrete envelope: magic, protocol version, kind ids.

export const FIRMWARE_FRAME_SPEC = Object.freeze({
  magic: 'ESPA',
  version: 1,
  kinds: Object.freeze({
    calibrationPlan: 1,
    listenerRow: 2,
  }),
});

export function renderFirmwareFrameHeader() {
  return `// Generated from src/firmware-frame.mjs — do not hand-edit.
#ifndef ESP_ARRAY_FRAME_H
#define ESP_ARRAY_FRAME_H

#define ESP_ARRAY_FRAME_MAGIC \"${FIRMWARE_FRAME_SPEC.magic}\"
#define ESP_ARRAY_FRAME_VERSION ${FIRMWARE_FRAME_SPEC.version}
#define ESP_ARRAY_FRAME_KIND_CALIBRATION_PLAN ${FIRMWARE_FRAME_SPEC.kinds.calibrationPlan}
#define ESP_ARRAY_FRAME_KIND_LISTENER_ROW ${FIRMWARE_FRAME_SPEC.kinds.listenerRow}

// Suggested outer transport envelope for mesh packets.
typedef struct {
  char magic[4];
  unsigned short version;
  unsigned short kind;
  unsigned int payload_bytes;
} esp_array_frame_header_t;

#endif // ESP_ARRAY_FRAME_H
`;
}
