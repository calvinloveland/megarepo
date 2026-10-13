#!/usr/bin/env python3
from __future__ import annotations

import argparse
import serial
import time
import wave
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Capture ESP32 mic recording over serial and save as WAV")
    p.add_argument("--port", default="/dev/ttyUSB0")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--output", default="artifacts/mic_capture.wav")
    p.add_argument("--timeout", type=float, default=45.0)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    ser = serial.Serial(args.port, args.baud, timeout=0.5)
    try:
        ser.setDTR(False)
        ser.setRTS(True)
        time.sleep(0.15)
        ser.setRTS(False)

        start = time.time()
        sample_rate = None
        sample_count = None
        while time.time() - start < args.timeout:
            line = ser.readline()
            if not line:
                continue
            try:
                text = line.decode("utf-8", errors="replace").strip()
            except Exception:
                continue
            if text:
                print(text)
            if text.startswith("BEGIN_RAW "):
                _, sr, count = text.split()
                sample_rate = int(sr)
                sample_count = int(count)
                break

        if sample_rate is None or sample_count is None:
            raise RuntimeError("Did not receive BEGIN_RAW header from ESP32")

        pcm_bytes_needed = sample_count * 2
        pcm = ser.read(pcm_bytes_needed)
        while len(pcm) < pcm_bytes_needed and time.time() - start < args.timeout:
            pcm += ser.read(pcm_bytes_needed - len(pcm))
        if len(pcm) != pcm_bytes_needed:
            raise RuntimeError(f"Expected {pcm_bytes_needed} PCM bytes, got {len(pcm)}")

        tail_deadline = time.time() + 5.0
        while time.time() < tail_deadline:
            line = ser.readline()
            if not line:
                continue
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                print(text)
            if text == "END_RAW":
                break

        with wave.open(str(out_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm)

        print(f"Saved WAV: {out_path} ({sample_count} samples @ {sample_rate} Hz)")
        return 0
    finally:
        ser.close()


if __name__ == "__main__":
    raise SystemExit(main())
