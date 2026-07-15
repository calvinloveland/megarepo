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
- `examples/calibration-plan.example.json`
  - deterministic example calibration plan generated from the simulator
- `examples/calibration-plan.wire.example.json`
  - the same plan in a compact integer/microsecond wire form
- `examples/listener-rows.closed.example.json`
  - deterministic closed-form listener-row packets
- `examples/listener-rows.closed.wire.example.json`
  - the same packets quantized to a compact integer wire form
- `examples/listener-rows.matched.example.json`
  - deterministic matched-filter listener-row packets with richer diagnostics
- `examples/listener-rows.matched.wire.example.json`
  - the same matched packets in the compact integer wire form
- `main/esp_array_backend.h`
  - C prototypes mirroring the JS firmware backend hooks:
    - clock sync
    - calibration plan generation
    - listener-row capture
    - row gossip
- `main/esp_array_main.c`
  - coordinator-style state machine scaffold
- `host/esp_array_wire_example.h`
  - generated C header containing one deterministic wire-format listener-row example
- `host/consume_example.c`
  - tiny host-side C consumer stub that iterates the generated example payload

## Regeneration

Whenever the simulator's canonical calibration/protocol constants change, refresh the generated
headers with:

```bash
node bin/export-firmware-headers.mjs
```

Whenever you want to refresh the example packet payloads used by future firmware
serialization tests, regenerate them with:

```bash
node bin/export-firmware-fixtures.mjs
```

The `*.wire.example.json` variants are especially important for firmware work:
they show the intended low-bandwidth fixed-point transport target (integer
microseconds / millimetres) rather than only the richer JSON-shaped contracts.

There is also a generated C mirror of one closed-form wire example:

```bash
node bin/export-firmware-c-example.mjs
```

That writes `firmware/host/esp_array_wire_example.h`, which the tiny
`firmware/host/consume_example.c` stub includes to demonstrate that the compact
wire-format payloads are actually consumable from C.

## Intended ESP-IDF mapping

- `esp_array_sync_clocks()` → Wi-Fi / time-sync task
- `esp_array_make_plan()` → chirp scheduler / coordinator state
- `esp_array_capture_listener_rows()` → I2S/PDM mic capture + DSP pipeline
- `esp_array_gossip_listener_rows()` → ESP-MESH or other transport layer
- localization solver → coordinator node or off-device service

## Minimal ESP-IDF scaffold

This directory now includes the minimum project files you would expect to grow into a real ESP-IDF
application:

- `CMakeLists.txt`
- `main/CMakeLists.txt`
- `main/idf_component.yml`
- `sdkconfig.defaults`

That is enough structure for a future `idf.py build` path once real drivers and task code are added.

## Build notes (future phase)

When ESP-IDF is installed and the real hardware code is fleshed out, the intended flow is:

```bash
cd firmware
idf.py set-target esp32
idf.py build
idf.py flash monitor
```

## Current status

Still skeleton only. No `idf.py build` has been attempted here yet, because the goal of this step is
to freeze the **interfaces, shared constants, and project shape** first so later ESP-IDF work does
not drift from the validated simulator.