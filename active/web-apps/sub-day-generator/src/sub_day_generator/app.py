"""Flask prototype for generating substitute day plans."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List

from flask import Flask, render_template, request

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_FORM_DATA: Dict[str, str] = {
    "teacher_name": "Ms. Rivera",
    "class_name": "Grade 5 - Homeroom",
    "day_date": "",
    "welcome_note": "Thanks for covering today. Students line up quietly after transitions.",
    "periods_text": (
        "8:15-8:35 | Morning Work | Journal prompt on kindness\n"
        "8:35-9:20 | Reading | Read-aloud then partner questions\n"
        "9:30-10:15 | Math | Fractions practice page 42\n"
        "10:30-11:00 | Science | Water cycle video and notes"
    ),
    "students_text": (
        "Avery | Needs front-row seating support\n"
        "Jordan | ELL support: allow extra response time\n"
        "Mia | May need movement break before math"
    ),
    "must_do_text": (
        "Take attendance by 8:30\n"
        "Send office note for any absent students\n"
        "Collect math page 42 before lunch"
    ),
    "routines_text": (
        "Call-and-response: 'Class class' / 'Yes yes'\n"
        "Restroom: one student at a time with hall pass\n"
        "Dismissal: bus riders first, then pickup line"
    ),
    "emergency_text": (
        "Front office ext 100\n"
        "Nurse ext 125\n"
        "Neighbor teacher: Mr. Singh (Room 12)"
    ),
}


def _non_empty_lines(text: str) -> List[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def parse_periods(text: str) -> List[Dict[str, str]]:
    periods: List[Dict[str, str]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|")]
        time = parts[0] if parts else ""
        subject = parts[1] if len(parts) > 1 else "General"
        activity = parts[2] if len(parts) > 2 else ""
        periods.append({"time": time, "subject": subject, "activity": activity})
    return periods


def parse_student_notes(text: str) -> List[Dict[str, str]]:
    notes: List[Dict[str, str]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|", maxsplit=1)]
        name = parts[0]
        note = parts[1] if len(parts) > 1 else ""
        notes.append({"name": name, "note": note})
    return notes


def build_plan(form_data: Dict[str, str]) -> Dict[str, object]:
    return {
        "header": {
            "teacher_name": form_data.get("teacher_name", "").strip(),
            "class_name": form_data.get("class_name", "").strip(),
            "day_date": form_data.get("day_date", "").strip(),
            "welcome_note": form_data.get("welcome_note", "").strip(),
        },
        "periods": parse_periods(form_data.get("periods_text", "")),
        "student_notes": parse_student_notes(form_data.get("students_text", "")),
        "must_do": _non_empty_lines(form_data.get("must_do_text", "")),
        "routines": _non_empty_lines(form_data.get("routines_text", "")),
        "emergency_contacts": _non_empty_lines(form_data.get("emergency_text", "")),
    }


def create_app() -> Flask:
    """Create and configure the Flask app."""
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
    )

    @app.get("/")
    def index() -> str:
        return render_template("index.html", form_data=DEFAULT_FORM_DATA, plan=None)

    @app.post("/generate")
    def generate() -> str:
        form_data = {
            key: str(request.form.get(key, "")).strip()
            for key in DEFAULT_FORM_DATA.keys()
        }
        plan = build_plan(form_data)
        return render_template("index.html", form_data=form_data, plan=plan)

    return app


def main() -> None:
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=debug, host=host, port=port)


if __name__ == "__main__":
    main()

