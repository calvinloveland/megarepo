"""Miyuki Piano Practice — a web app to practice Miraie & Milkoi's 'ミユキ'."""

import json
import os
from pathlib import Path

from flask import Flask, render_template

app = Flask(__name__)

HERE = Path(__file__).parent
JSON_PATH = HERE / 'data' / 'miyuki.json'

# Load parsed MIDI data once at startup
with open(JSON_PATH) as f:
    MIDI_DATA = json.load(f)


@app.route('/')
def index():
    """Main practice page with embedded MIDI data."""
    return render_template('index.html', midi=MIDI_DATA)


@app.route('/api/midi-data')
def midi_data():
    """Return parsed MIDI data as JSON API."""
    return MIDI_DATA


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5115))
    host = os.environ.get('HOST', '127.0.0.1')
    app.run(host=host, port=port, debug=True)
