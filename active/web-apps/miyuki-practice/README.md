# Miyuki Piano Practice — ミユキ

A piano practice web app for **Miraie & Milkoi — ミユキ (Miyuki)**.

## Features

- **Synthesia-style falling notes visualizer** — watch the notes scroll down the keyboard in real time
- **Clickable piano keyboard** — tap any key to hear it, or play along as the song runs
- **Web Audio API playback** — the actual MIDI arrangement voiced with a warm piano tone
- **Tempo control** — slow it down to learn tricky passages, then speed up gradually
- **Progress slider** — jump to any section of the song
- **Song info panel** — BPM, key, duration, and artist credits
- **Embedded listening** — YouTube, SoundCloud, Spotify, and Bandcamp links

## How to use

1. Open the app from the launcher ([shsw.dev](https://shsw.dev))
2. Click the **play button** (or press **Space**) to start the falling-note visualizer
3. Use **+ / −** tempo buttons to dial in a comfortable practice speed
4. Click on the piano keyboard to hear individual notes
5. Drag the **progress slider** to jump to a specific section

## Tech stack

- **Backend:** Flask (serves the page and MIDI data)
- **Frontend:** Vanilla JS + Canvas API + Web Audio API
- **MIDI source:** Online Sequencer export
- **Piano sound:** Triangle-wave oscillator with low-pass filter (Web Audio)

## Files

| Path | Purpose |
|------|---------|
| `app.py` | Flask application |
| `midi_parser.py` | Python MIDI → JSON converter |
| `data/miyuki.mid` | The original MIDI file |
| `data/miyuki.json` | Parsed note data (pre-generated) |
| `templates/index.html` | Main page template |
| `static/css/style.css` | Dark piano-themed styles |
| `static/js/app.js` | Canvas visualizer, audio engine, controls |

## Credits

- Song: **ミユキ (Miyuki)** by **Miraie & Milkoi**
- MIDI arrangement: Winter (Online Sequencer)
- Sheet music: savrtuthd (Gumroad)
