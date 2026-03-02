# Sub Day Generator

Prototype Flask app that helps teachers quickly create a substitute-ready day plan.

## What it does (prototype)

- Captures core sub-day inputs in one form (schedule, student notes, routines, checklist, contacts)
- Generates a structured substitute plan preview instantly
- Keeps formatting teacher-friendly for quick print/copy

## Quickstart

```bash
cd active/web-apps/sub-day-generator
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m sub_day_generator.app
```

Open: http://127.0.0.1:5000

## Tests

```bash
cd active/web-apps/sub-day-generator
python -m pytest -q
```

## Next Prototype Steps

- Add reusable templates (elementary, middle school, high school day patterns)
- Add export options (print and markdown copy)
- Add optional per-student medical/accommodation flags with safe wording

