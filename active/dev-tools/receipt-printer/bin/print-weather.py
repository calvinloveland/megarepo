#!/usr/bin/env python3
"""Print the current weather (plus a 3-day outlook) to the Epson TM-T88V.

Data from wttr.in, which wraps WorldWeatherOnline.

Usage: print-weather.py ["City, ST"] [--wrap N] [--no-forecast]
"""

import json
import sys
import time
import urllib.parse
import urllib.request

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"
WRAP = 32


def fetch(location: str) -> dict:
    url = f"https://wttr.in/{urllib.parse.quote(location)}?format=j1"
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def wrap_pairs(rows: list[tuple[str, str]], width: int = WRAP) -> list[str]:
    """Left/right justify label:value rows so they line up on the receipt."""
    out = []
    for label, value in rows:
        gap = width - len(label) - len(value)
        if gap < 1:
            out.append(label)
            out.append(value.rjust(width))
        else:
            out.append(label + " " * gap + value)
    return out


def current_hour(day: dict, observation: str) -> dict:
    """Pick the hourly entry nearest the observation time (wttr keys are "0", "300", ...)."""
    try:
        hhmm = observation.strip()
        hour = int(hhmm.split(":")[0]) % 12
        if hhmm.upper().endswith("PM"):
            hour += 12
    except (ValueError, IndexError):
        return day["hourly"][0]

    best, best_delta = day["hourly"][0], 99
    for e in day["hourly"]:
        try:
            slot = int(e["time"].rjust(4, "0")) // 100
        except (KeyError, ValueError):
            continue
        delta = abs(slot - hour)
        delta = min(delta, 24 - delta)  # wrap midnight
        if delta < best_delta:
            best, best_delta = e, delta
    return best


def cut() -> bytes:
    return GS + b"V" + b"\x42" + b"\x00"


def write_printer(data: bytes, chunk: int = 1024) -> None:
    with open(PRINTER, "wb", buffering=0) as f:
        for i in range(0, len(data), chunk):
            piece = data[i : i + chunk]
            off = 0
            while off < len(piece):
                try:
                    off += f.write(piece[off:])
                except BlockingIOError:
                    time.sleep(0.01)


def center(s: str, width: int = WRAP) -> bytes:
    s = s[:width]
    pad = max(0, (width - len(s)) // 2)
    return b" " * pad + s.encode("cp437", errors="replace") + b"\n"


def main() -> None:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    location = positional[0] if positional else "Logan, UT"
    wrap = WRAP
    if "--wrap" in sys.argv:
        wrap = int(sys.argv[sys.argv.index("--wrap") + 1])

    try:
        d = fetch(location)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"weather fetch failed: {e}")

    cur = d["current_condition"][0]
    area = d["nearest_area"][0]
    city = area["areaName"][0]["value"]
    region = area["region"][0]["value"]
    today = d["weather"][0]
    astro = today["astronomy"][0]
    now = current_hour(today, cur.get("observation_time", ""))

    out = bytearray()
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x01"  # center
    out += GS + b"!" + b"\x11"  # double size
    out += b"WEATHER\n"
    out += GS + b"!" + b"\x00"
    out += f"{city}, {region}\n".encode("cp437", errors="replace")
    out += f"observed {cur['observation_time']}\n".encode()
    out += ESC + b"a" + b"\x00"
    out += b"\n"

    # Big temperature
    out += ESC + b"a" + b"\x01"
    out += GS + b"!" + b"\x11"
    out += f"{cur['temp_F']}F\n".encode()
    out += GS + b"!" + b"\x00"
    desc = cur["weatherDesc"][0]["value"]
    out += desc.encode("cp437", errors="replace") + b"\n"
    out += ESC + b"a" + b"\x00"
    out += b"-" * wrap + b"\n"

    rows = [
        ("Feels like", f"{cur['FeelsLikeF']}F / {cur['FeelsLikeC']}C"),
        ("Humidity", f"{cur['humidity']}%"),
        ("Wind", f"{cur['windspeedMiles']}mph {cur['winddir16Point']}"),
        ("Gusts", f"{now.get('WindGustMiles', cur['windspeedMiles'])}mph"),
        ("Pressure", f"{cur['pressure']}mb"),
        ("Visibility", f"{cur.get('visibilityMiles', cur.get('visibility', '?'))}mi"),
        ("Cloud cover", f"{cur['cloudcover']}%"),
        ("UV index", cur["uvIndex"]),
        ("Precip", f"{cur['precipInches']}in"),
    ]
    for line in wrap_pairs(rows, wrap):
        out += line.encode("cp437", errors="replace") + b"\n"

    out += b"-" * wrap + b"\n"
    out += f"Sunrise {astro['sunrise']}\n".encode()
    out += f"Sunset  {astro['sunset']}\n".encode()
    out += f"Moon    {astro['moon_phase']} {astro['moon_illumination']}%\n".encode(
        "cp437", errors="replace"
    )

    if "--no-forecast" not in sys.argv:
        out += b"\n" + b"=" * wrap + b"\n"
        out += ESC + b"E" + b"\x01" + b"3-DAY OUTLOOK\n" + ESC + b"E" + b"\x00"
        out += b"-" * wrap + b"\n"
        out += b"DAY       HI   LO\n"
        for day in d["weather"][:3]:
            name = day["date"]
            # Short weekday without needing locale data.
            import datetime

            try:
                wd = datetime.date.fromisoformat(name).strftime("%a")
            except ValueError:
                wd = name[5:]
            out += f"{wd:8s} {day['maxtempF']:>3s}F {day['mintempF']:>3s}F\n".encode()

    out += b"\n"
    out += center("wttr.in / WorldWeatherOnline", wrap)
    out += ESC + b"d\x04"
    out += cut()

    write_printer(bytes(out))
    print(f"printed weather for {city}, {region}: {cur['temp_F']}F {desc}")


if __name__ == "__main__":
    main()
