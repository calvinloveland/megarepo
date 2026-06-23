# Miyuki Piano Practice

A piano practice web app for **Miraie & Milkoi — ミユキ (Miyuki)**.

## Local development

```bash
# Generate parsed MIDI data (if you change the MIDI)
python3 midi_parser.py

# Run the Flask dev server
python3 -m flask run --port 5115
```

Or use the launcher at [shsw.dev](https://shsw.dev).

## Architecture

The app is a standard Flask + static-files web app. MIDI parsing happens
once at build time (`midi_parser.py` → `data/miyuki.json`). The browser
renders falling notes on a `<canvas>`, plays audio via the Web Audio API,
and shows a clickable piano keyboard as DOM elements.

No external JS frameworks or build tools needed.
