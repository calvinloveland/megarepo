# ESP Array Firmware Skeleton

This directory is the beginning of the **hardware phase** for the ESP Array simulator.
It is **not** a complete ESP-IDF app yet, but it mirrors the simulator's new firmware-shaped
boundaries so the transition is incremental instead of a rewrite.

## What is here

- `include/esp_array_calibration.h`
  - generated from `src/calibration-config.mjs`
  - canonical chirp + timing constants shared with the simulator
- `include/esp_array_protocol.h`
  - generated from `src/firmware-protocol.mjs`
  - packet kinds + listener-row struct skeleton
- `main/esp_array_backend.h`
  - C prototypes mirroring the JS firmware backend hooks:
    - clock sync
    - calibration plan generation
    - listener-row capture
    - row gossip
- `main/esp_array_main.c`
  - coordinator-style state machine scaffold

## Regeneration

Whenever the simulator's canonical calibration/protocol constants change, refresh the generated
headers with:

```bash
node bin/export-firmware-headers.mjs
```

## Intended ESP-IDF mapping

- `esp_array_sync_clocks()` → Wi-Fi / time-sync task
- `esp_array_make_plan()` → chirp scheduler / coordinator state
- `esp_array_capture_listener_rows()` → I2S/PDM mic capture + DSP pipeline
- `esp_array_gossip_listener_rows()` → ESP-MESH or other transport layer
- localization solver → coordinator node or off-device service

## Current status

Skeleton only. No `idf.py build` has been attempted here yet, because the goal of this step is to
freeze the **interfaces and shared constants** first so later ESP-IDF work does not drift from the
validated simulator.