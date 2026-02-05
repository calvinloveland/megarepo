# Parambulator

Parambulator is a Flask + HTMX web app for building seating charts and office plans with constraint-based scoring.

## Features

- People + constraints input as JSON
- Seating chart generation with 0–1 scoring
- Constraint-aware scoring (mix reading levels, separate talkative students, front-row IEP priority, explicit avoidance)
- Save/load seating plans (server-side JSON)
- Five UI designs to compare

## Quickstart

```bash
cd active/web-apps/parambulator
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m parambulator.app
```

Then open http://127.0.0.1:5000

## Notes

- Saved charts are stored in `data/saves/`.
- Use the design selector in the UI to compare layouts.
