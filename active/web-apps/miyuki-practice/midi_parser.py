"""Parse a MIDI file into JSON-serializable note events for the practice app."""

import struct
import json
from pathlib import Path


def _read_var_len(data, offset):
    """Read a MIDI variable-length value. Returns (value, new_offset)."""
    value = 0
    while True:
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            break
    return value, offset


def parse_midi(path):
    """Parse a MIDI file and return structured data for the frontend.

    Returns a dict with:
      - format: int
      - tracks: list of track dicts with note events
      - ticks_per_quarter: int
      - tempo: microseconds per quarter note
      - bpm: float

    Each track has:
      - notes: list of {note, startTick, endTick, velocity}
      - name: str
      - instrument: int or None
    """
    data = Path(path).read_bytes()

    # --- Read header ---
    if data[:4] != b'MThd':
        raise ValueError("Not a MIDI file")

    header_len = struct.unpack('>I', data[4:8])[0]
    fmt, num_tracks, ticks_per_quarter = struct.unpack('>HHH', data[8:14])
    offset = 8 + header_len  # MThd chunk header (8) + header data

    # Default tempo = 120 BPM
    tempo_us_per_beat = 500000
    bpm = 120.0

    tracks_data = []

    for track_idx in range(num_tracks):
        if offset + 8 > len(data):
            break

        track_id = data[offset:offset+4]
        if track_id != b'MTrk':
            # Skip unknown chunk
            chunk_len = struct.unpack('>I', data[offset+4:offset+8])[0]
            offset += 8 + chunk_len
            continue

        track_len = struct.unpack('>I', data[offset+4:offset+8])[0]
        track_data = data[offset+8:offset+8+track_len]
        offset += 8 + track_len

        abs_tick = 0
        running_status = 0
        notes = []
        track_name = None
        instrument = None
        i = 0

        while i < len(track_data):
            # Read delta time
            delta, i = _read_var_len(track_data, i)
            abs_tick += delta

            if i >= len(track_data):
                break

            # Read status byte
            status = track_data[i]
            if status & 0x80:
                running_status = status
                i += 1
            else:
                # Running status: use previous status byte
                status = running_status

            msg_type = status >> 4
            channel = status & 0x0F

            if msg_type == 0xF:
                # System / Meta events
                if status == 0xFF:
                    # Meta event
                    if i >= len(track_data):
                        break
                    meta_type = track_data[i]
                    i += 1
                    meta_len, i = _read_var_len(track_data, i)
                    meta_data = track_data[i:i+meta_len]
                    i += meta_len

                    if meta_type == 0x51:
                        # Set Tempo (3 bytes: microseconds per quarter note)
                        if len(meta_data) >= 3:
                            tempo_us_per_beat = (meta_data[0] << 16) | (meta_data[1] << 8) | meta_data[2]
                            bpm = 60_000_000 / tempo_us_per_beat
                    elif meta_type == 0x03:
                        # Track name
                        try:
                            track_name = meta_data.decode('latin-1')
                        except Exception:
                            track_name = repr(meta_data)
                    elif meta_type == 0x2F:
                        # End of Track
                        break
                    # Ignore other meta events (key signature, time sig, etc.)
                elif status == 0xF0 or status == 0xF7:
                    # SysEx: read length-prefixed data
                    if i >= len(track_data):
                        break
                    sys_len, i = _read_var_len(track_data, i)
                    i += sys_len
                else:
                    # Other system messages (0xF1-F6, 0xF8-0xFE) are 1-2 bytes
                    # but we can just skip
                    if status == 0xF1 or status == 0xF3:
                        i += 1
                    elif status == 0xF2:
                        i += 2
                    # 0xF4, 0xF5, 0xF6, 0xF8-0xFE: no data bytes
                    pass

            elif msg_type == 0x9:
                # Note On
                if i + 1 >= len(track_data):
                    break
                note = track_data[i]
                velocity = track_data[i + 1]
                i += 2
                if velocity > 0:
                    notes.append({
                        'note': note,
                        'startTick': abs_tick,
                        'velocity': velocity,
                        'channel': channel,
                    })
                else:
                    # Note on with vel=0 is processed as note off
                    for n in reversed(notes):
                        if n['note'] == note and n.get('endTick') is None:
                            n['endTick'] = abs_tick
                            break

            elif msg_type == 0x8:
                # Note Off
                if i + 1 >= len(track_data):
                    break
                note = track_data[i]
                # velocity = track_data[i + 1]  # ignored
                i += 2
                for n in reversed(notes):
                    if n['note'] == note and n.get('endTick') is None:
                        n['endTick'] = abs_tick
                        break

            elif msg_type == 0xC:
                # Program Change (instrument)
                if i < len(track_data):
                    instrument = track_data[i]
                    i += 1

            elif msg_type == 0xB:
                # Controller
                if i + 1 < len(track_data):
                    i += 2
                else:
                    break

            elif msg_type == 0xE:
                # Pitch Bend (2 bytes)
                if i + 1 < len(track_data):
                    i += 2
                else:
                    break

            elif msg_type == 0xA:
                # Polyphonic Aftertouch (2 bytes)
                if i + 1 < len(track_data):
                    i += 2
                else:
                    break

            elif msg_type == 0xD:
                # Channel Aftertouch (1 byte)
                if i < len(track_data):
                    i += 1
                else:
                    break

            else:
                # Unknown message type - stop parsing this track
                break

        # Close any dangling notes
        max_tick = abs_tick
        for n in notes:
            if n.get('endTick') is None:
                n['endTick'] = max_tick + 1

        # Sort notes by start tick
        notes.sort(key=lambda n: (n['startTick'], n['note']))

        if track_name:
            name = track_name
        elif instrument is not None:
            name = f"Track {track_idx + 1} (Program {instrument})"
        else:
            name = f"Track {track_idx + 1}"

        tracks_data.append({
            'index': track_idx,
            'name': name,
            'instrument': instrument,
            'notes': notes,
        })

    # Determine total duration
    total_ticks = max(
        (n['endTick'] for t in tracks_data for n in t['notes']),
        default=0
    )

    return {
        'format': fmt,
        'num_tracks': num_tracks,
        'ticks_per_quarter': ticks_per_quarter,
        'tempo': tempo_us_per_beat,
        'bpm': round(bpm, 1),
        'totalTicks': total_ticks,
        'tracks': tracks_data,
    }


def midi_to_json(path):
    """Parse MIDI and return JSON string suitable for embedding in a web page."""
    parsed = parse_midi(path)
    return json.dumps(parsed)


if __name__ == '__main__':
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else 'data/miyuki.mid'
    result = parse_midi(path)

    # Print compact summary
    print(f"Format: {result['format']}, Tracks: {result['num_tracks']}")
    print(f"TPQ: {result['ticks_per_quarter']}, BPM: {result['bpm']}, Total ticks: {result['totalTicks']}")
    print(f"Duration: {result['totalTicks'] / result['ticks_per_quarter'] / (result['bpm'] / 60):.1f} seconds")
    print()

    for track in result['tracks']:
        print(f"Track {track['index']}: '{track['name']}' - {len(track['notes'])} notes (instrument: {track['instrument']})")
        if track['notes']:
            print(f"  Range: note {min(n['note'] for n in track['notes'])} to {max(n['note'] for n in track['notes'])}")
            print(f"  First: note={track['notes'][0]['note']} at tick={track['notes'][0]['startTick']}")
            print(f"  Last: note={track['notes'][-1]['note']} at tick={track['notes'][-1]['startTick']}")

    # JSON dump to a file for the frontend
    json_path = path.replace('.mid', '.json')
    with open(json_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'), ensure_ascii=False)
    print(f"\nJSON written to {json_path} ({len(json.dumps(result, separators=(',', ':'), ensure_ascii=False))} bytes)")
