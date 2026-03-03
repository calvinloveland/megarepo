"""Flask prototype for Cozi family logistics dashboard."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict, List

from flask import Flask, abort, render_template, request

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHARED_SRC_ROOT_CANDIDATES = (
    PROJECT_ROOT.parent / "shared" / "src",
    PROJECT_ROOT / "shared" / "src",
)
for shared_src_root in SHARED_SRC_ROOT_CANDIDATES:
    if shared_src_root.exists():
        if str(shared_src_root) not in sys.path:
            sys.path.insert(0, str(shared_src_root))
        break

from web_feedback import enable_shared_feedback, feedback_storage_paths

FEEDBACK_DIR, ADDRESSED_DIR = feedback_storage_paths(PROJECT_ROOT)

ACTION_KEYWORDS = (
    "due",
    "submit",
    "turn in",
    "bring",
    "sign",
    "permission slip",
    "reminder",
    "practice",
    "game",
    "meeting",
    "refill",
    "birthday",
)
DATE_PATTERN = re.compile(
    r"\b(?:by|due|on)\s+([A-Za-z]+(?:\s+\d{1,2})?|\d{1,2}/\d{1,2}(?:/\d{2,4})?)",
    re.IGNORECASE,
)

DEFAULT_FORM_DATA: Dict[str, str] = {
    "school_emails_text": (
        "Subject: Field trip\nPlease sign and return permission slip by Friday.\n\n"
        "Subject: Nurse update\nPlease refill inhaler medicine by March 10.\n\n"
        "Subject: Class celebration\nBring 24 cupcakes on 3/15 for Ava's birthday."
    ),
    "calendar_text": (
        "2026-03-08 5:30 PM | Soccer practice | Dad\n"
        "2026-03-09 7:45 AM | School drop-off | Mom\n"
        "2026-03-10 6:00 PM | PTA meeting | Both"
    ),
    "pantry_text": (
        "Milk | 0 | 1\n"
        "Eggs | 4 | 12\n"
        "Bread | 1 | 1\n"
        "Yogurt cups | 2 | 8"
    ),
    "reminders_text": (
        "2026-03-08 | Send signed permission slip\n"
        "2026-03-10 | Refill inhaler prescription"
    ),
    "kids_text": (
        "Ava | shirt: M(10-12) | pants: 10 | shoes: 4Y\n"
        "Noah | shirt: S(6-7) | pants: 7 | shoes: 1Y"
    ),
}

LANDING_STYLES: Dict[str, Dict[str, object]] = {
    "neon-sprint": {
        "name": "Neon Sprint",
        "headline": "RUN YOUR HOME LIKE A LEGENDARY PIT CREW",
        "subhead": "Cozi turns school chaos, pantry gaps, and family scheduling into one electric action board.",
        "hero_class": "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-800 text-white",
        "accent_class": "bg-yellow-300 text-black",
        "bullets": [
            "Auto-pull action items from school emails in seconds",
            "Tag every event with a clear owner: Mom, Dad, or Team",
            "Never run out of staples with smart pantry gap alerts",
        ],
    },
    "editorial-pop": {
        "name": "Editorial Pop",
        "headline": "THE FAMILY OPS STACK, DESIGNED LIKE A MAGAZINE COVER",
        "subhead": "Big typography. Sharp priorities. Zero mental clutter. Cozi makes responsibilities obvious.",
        "hero_class": "bg-amber-200 text-slate-900",
        "accent_class": "bg-slate-900 text-amber-200",
        "bullets": [
            "Action cards for permission slips, medicine refills, and school tasks",
            "Shared calendar ownership with visible accountability",
            "Kid profile memory for sizes, notes, and essentials",
        ],
    },
    "midnight-luxe": {
        "name": "Midnight Luxe",
        "headline": "FROM DAILY FIRE DRILLS TO CALM, COMMANDING CONTROL",
        "subhead": "Cozi centralizes family logistics with premium clarity, proactive reminders, and confident execution.",
        "hero_class": "bg-slate-950 text-cyan-100",
        "accent_class": "bg-cyan-300 text-slate-950",
        "bullets": [
            "Unified command center for email, schedules, pantry, and reminders",
            "Instant grocery lists generated from real household inventory",
            "Role-tagged events so everyone knows who owns what",
        ],
    },
}


def _non_empty_lines(text: str) -> List[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _split_sentences(text: str) -> List[str]:
    compact = " ".join(_non_empty_lines(text))
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", compact) if part.strip()]


def extract_action_items(email_text: str) -> List[Dict[str, str]]:
    actions: List[Dict[str, str]] = []
    for sentence in _split_sentences(email_text):
        lower = sentence.lower()
        if not any(keyword in lower for keyword in ACTION_KEYWORDS):
            continue
        due_match = DATE_PATTERN.search(sentence)
        actions.append(
            {
                "task": sentence,
                "due": due_match.group(1) if due_match else "Soon",
            }
        )
    return actions


def parse_calendar_entries(text: str) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|")]
        entries.append(
            {
                "when": parts[0] if parts else "",
                "event": parts[1] if len(parts) > 1 else "General event",
                "responsible": parts[2] if len(parts) > 2 else "Unassigned",
            }
        )
    return entries


def parse_pantry(text: str) -> List[Dict[str, object]]:
    items: List[Dict[str, object]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|")]
        current = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        minimum = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        items.append(
            {
                "item": parts[0],
                "current": current,
                "minimum": minimum,
            }
        )
    return items


def build_grocery_list(pantry_items: List[Dict[str, object]]) -> List[Dict[str, object]]:
    grocery: List[Dict[str, object]] = []
    for item in pantry_items:
        current = int(item["current"])
        minimum = int(item["minimum"])
        if current < minimum:
            grocery.append(
                {
                    "item": str(item["item"]),
                    "needed": minimum - current,
                }
            )
    return grocery


def parse_reminders(text: str) -> List[Dict[str, str]]:
    reminders: List[Dict[str, str]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|", maxsplit=1)]
        reminders.append(
            {
                "when": parts[0],
                "task": parts[1] if len(parts) > 1 else parts[0],
            }
        )
    return reminders


def parse_kids(text: str) -> List[Dict[str, object]]:
    profiles: List[Dict[str, object]] = []
    for line in _non_empty_lines(text):
        parts = [part.strip() for part in line.split("|")]
        profiles.append(
            {
                "name": parts[0],
                "sizes": parts[1:],
            }
        )
    return profiles


def build_snapshot(form_data: Dict[str, str]) -> Dict[str, object]:
    pantry = parse_pantry(form_data.get("pantry_text", ""))
    actions = extract_action_items(form_data.get("school_emails_text", ""))
    reminders = parse_reminders(form_data.get("reminders_text", ""))
    reminders.extend(
        {"when": action["due"], "task": action["task"]}
        for action in actions
        if action["due"] != "Soon"
    )
    return {
        "actions": actions,
        "calendar": parse_calendar_entries(form_data.get("calendar_text", "")),
        "pantry": pantry,
        "grocery": build_grocery_list(pantry),
        "reminders": reminders,
        "kids": parse_kids(form_data.get("kids_text", "")),
    }


def create_app() -> Flask:
    app = Flask(__name__, template_folder=str(PROJECT_ROOT / "templates"))
    enable_shared_feedback(
        app,
        project_root=PROJECT_ROOT,
        app_name="Cozi",
        feedback_dir=FEEDBACK_DIR,
        addressed_dir=ADDRESSED_DIR,
    )

    @app.get("/")
    def index() -> str:
        return render_template("landing_hub.html", styles=LANDING_STYLES)

    @app.get("/landing/<style_name>")
    def landing(style_name: str) -> str:
        style = LANDING_STYLES.get(style_name)
        if not style:
            abort(404)
        return render_template("landing.html", style=style, styles=LANDING_STYLES)

    @app.get("/workspace")
    def workspace() -> str:
        return render_template("index.html", form_data=DEFAULT_FORM_DATA, snapshot=None)

    @app.post("/generate")
    def generate() -> str:
        form_data = {
            key: str(request.form.get(key, "")).strip() for key in DEFAULT_FORM_DATA.keys()
        }
        return render_template(
            "index.html",
            form_data=form_data,
            snapshot=build_snapshot(form_data),
        )

    return app


def main() -> None:
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=debug, host=host, port=port)


if __name__ == "__main__":
    main()
