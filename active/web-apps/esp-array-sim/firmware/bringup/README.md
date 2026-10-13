# ESP Array hardware bring-up tests

This directory is the practical Arduino/PlatformIO bring-up companion to the
main ESP-IDF firmware under `../`.

Why this exists:
- `../main/` is the long-term ESP-IDF firmware target.
- board-level speaker/mic debugging is faster with tiny Arduino/PlatformIO
  sketches while the hardware path is still being proven.
- these tests belong to the **speaker array project**, not `esp32-led-sync`.

## Environments

### `phase1-single-node`
Very quiet single-node speaker + mic hardware test.

```bash
cd active/web-apps/esp-array-sim/firmware/bringup
platformio run -e phase1-single-node --target upload --upload-port /dev/ttyUSB0
```

### `mic-monitor`
Mic-only ambient monitor with low-frequency analysis.

```bash
platformio run -e mic-monitor --target upload --upload-port /dev/ttyUSB0
```

### `mic-record`
One-shot mic recorder that streams raw PCM over serial.

```bash
platformio run -e mic-record --target upload --upload-port /dev/ttyUSB0
```

Then save a WAV on the host with:

```bash
nix-shell -p 'python3.withPackages (p: [p.pyserial])' \
  --run 'python3 scripts/capture_mic_wav.py --port /dev/ttyUSB0 --output artifacts/mic_capture.wav'
```

## Files

- `src/phase1_single_node.cpp` — quiet speaker + mic bring-up test
- `src/mic_monitor.cpp` — live-ish ambient mic diagnostics
- `src/mic_record.cpp` — serial PCM recorder
- `scripts/capture_mic_wav.py` — host-side WAV capture helper
