"""Flask app for generating and managing seating charts."""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from flask import Flask, Response, make_response, render_template, request
from flask_wtf.csrf import CSRFProtect

from .models import (
    Chart,
    Person,
    chart_from_json,
    chart_to_json,
    default_people,
    parse_people_json,
    parse_people_table,
    people_to_json,
    people_to_table,
)
from .scoring import generate_best_chart, score_chart, seat_constraint_statuses
from .storage import list_saves, load_payload, save_payload

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

DEFAULT_ROWS = 4
DEFAULT_COLS = 5
DEFAULT_DESIGN = "design_1"
DESIGN_OPTION_LABELS = {
    "design_1": "1 • Brutalist",
    "design_2": "2 • Cyberpunk",
    "design_3": "3 • Vibrant",
    "design_4": "4 • Retro 70s",
    "design_5": "5 • System UI",
    "design_6": "6 • Military",
    "design_7": "7 • NGE",
}
DESIGN_ALIASES = {"military": "design_6", "nge": "design_7"}
ALLOWED_DESIGNS = tuple(DESIGN_OPTION_LABELS.keys())
DEFAULT_SCORING_WEIGHTS = {
    "reading_mix": 0.3,
    "talkative_spacing": 0.2,
    "iep_front": 0.2,
    "avoid_pairs": 0.15,
    "must_sit_by": 0.15,
}
COLUMN_TO_WEIGHT_KEY = {
    "reading_level": "reading_mix",
    "talkative": "talkative_spacing",
    "iep_front": "iep_front",
    "avoid": "avoid_pairs",
    "must_sit_by": "must_sit_by",
}
DEFAULT_COLUMN_CONFIG = {
    "__priority_mode": "weight",
    "reading_level": {"type": "ignore", "weight": 0.0, "priority": 5},
    "talkative": {"type": "avoid", "weight": 0.35, "priority": 2},
    "iep_front": {"type": "directional", "weight": 0.25, "priority": 3},
    "avoid": {"type": "avoid", "weight": 0.2, "priority": 1},
    "must_sit_by": {"type": "group", "weight": 0.2, "priority": 2},
}
FEEDBACK_DIR, ADDRESSED_DIR = feedback_storage_paths(PROJECT_ROOT)
STATE_COOKIE_NAME = "parambulator_state"
STATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
INVALID_PINNED_SEATS_WARNING = "Pinned seats were cleared because the saved data was invalid."


@dataclass(frozen=True)
class PinValidationContext:
    """Shared context for validating pinned-seat entries."""

    valid_names: Set[str]
    layout: List[List[bool]]
    rows: int
    cols: int
    normalized: Dict[Tuple[int, int], str]
    pinned_names: Set[str]


def _serialize_state_cookie(data: Dict[str, object]) -> Optional[str]:
    try:
        raw = json.dumps(data, separators=(",", ":"))
    except (TypeError, ValueError):
        return None

    if len(raw) <= 3500:
        return raw

    trimmed = dict(data)
    trimmed.pop("chart_json", None)
    try:
        raw = json.dumps(trimmed, separators=(",", ":"))
    except (TypeError, ValueError):
        return None
    if len(raw) <= 3500:
        return raw
    return None


def _load_state_cookie(raw: Optional[str]) -> Dict[str, object]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )

    secret_key = os.getenv("SECRET_KEY")
    is_dev = os.getenv("FLASK_DEBUG", "").lower() == "true" or os.getenv(
        "FLASK_ENV", ""
    ).lower() == "development"
    is_test = "pytest" in sys.modules or os.getenv("PYTEST_CURRENT_TEST") is not None
    if not secret_key and not is_dev and not is_test:
        raise ValueError("SECRET_KEY environment variable is required in production")

    app.config["SECRET_KEY"] = secret_key or "dev-key-not-for-production"
    app.config["WTF_CSRF_HEADERS"] = ["X-CSRFToken"]
    app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", "1048576"))

    if not is_dev:
        app.config["SESSION_COOKIE_SECURE"] = True
        app.config["SESSION_COOKIE_HTTPONLY"] = True
        app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    CSRFProtect(app)

    if not is_dev:
        log_file = os.getenv("LOG_FILE")
        if log_file:
            handler = RotatingFileHandler(log_file, maxBytes=10485760, backupCount=10)
        else:
            handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] %(levelname)s in %(module)s: %(message)s")
        )
        app.logger.addHandler(handler)
        app.logger.setLevel(logging.INFO)

    def apply_state_cookie(response: Response, context: Dict[str, object]) -> Response:
        state_payload = {
            "people_json": context.get("people_json", ""),
            "people_table": context.get("people_table", ""),
            "rows": context.get("rows"),
            "cols": context.get("cols"),
            "design": context.get("design"),
            "layout_map": context.get("layout_map", ""),
            "column_config": context.get("column_config", ""),
            "chart_json": context.get("chart_json", ""),
            "pinned_seats_json": context.get("pinned_seats_json", "[]"),
        }
        raw = _serialize_state_cookie(state_payload)
        if not raw:
            return response
        response.set_cookie(
            STATE_COOKIE_NAME,
            raw,
            max_age=STATE_COOKIE_MAX_AGE,
            samesite="Lax",
            secure=not is_dev,
            httponly=True,
        )
        return response

    @app.get("/")
    def index() -> str:
        state = _load_state_cookie(request.cookies.get(STATE_COOKIE_NAME))
        state_people_table = str(state.get("people_table", "")).strip()
        state_people_json = str(state.get("people_json", "")).strip()
        if state_people_table:
            people = parse_people_table(state_people_table) or default_people()
            people_json = people_to_json(people)
            people_table = people_to_table(people)
        else:
            if not state_people_json:
                people = default_people()
                people_json = people_to_json(people)
            else:
                people = parse_people_json(state_people_json)
                people_json = people_to_json(people)
            people_table = people_to_table(people)

        rows = _parse_int(
            str(state.get("rows")) if state.get("rows") is not None else None,
            DEFAULT_ROWS,
            min_val=1,
            max_val=50,
        )
        cols = _parse_int(
            str(state.get("cols")) if state.get("cols") is not None else None,
            DEFAULT_COLS,
            min_val=1,
            max_val=50,
        )
        design = sanitize_design(str(state.get("design", DEFAULT_DESIGN)) or DEFAULT_DESIGN)
        column_config = str(state.get("column_config", json.dumps(DEFAULT_COLUMN_CONFIG, indent=2)))
        scoring_weights = parse_scoring_weights(column_config)
        layout_map = str(state.get("layout_map", "")) or layout_to_text(None, rows, cols)
        layout = parse_layout_map(layout_map, rows, cols)
        pinned_seats_json = str(state.get("pinned_seats_json", "[]"))
        pinned_seats, pin_warnings = parse_pinned_seats(
            pinned_seats_json, people, layout, rows, cols
        )
        pinned_seats_json = serialize_pinned_seats(pinned_seats)
        chart_json = str(state.get("chart_json", "")).strip()
        if chart_json:
            chart = chart_from_json(chart_json)
            breakdown = score_chart(chart, people, rows, cols, weights=scoring_weights)
            warnings = pin_warnings
        else:
            result = generate_best_chart(
                people,
                rows,
                cols,
                iterations=150,
                layout=layout,
                pinned_seats=pinned_seats,
                weights=scoring_weights,
            )
            chart = result.chart
            breakdown = result.breakdown
            warnings = pin_warnings + result.warnings
        context = build_context(
            people_json=people_json,
            people_table=people_table,
            rows=rows,
            cols=cols,
            design=design,
            layout_map=layout_map,
            column_config=column_config,
            pinned_seats_json=pinned_seats_json,
            chart=chart,
            breakdown=breakdown,
            warnings=warnings,
        )
        response = make_response(render_template("index.html", **context))
        return apply_state_cookie(response, context)

    @app.post("/generate")
    def generate() -> str:
        form_data = parse_form(request.form)
        result = generate_best_chart(
            form_data["people"],
            form_data["rows"],
            form_data["cols"],
            iterations=form_data["iterations"],
            layout=form_data["layout"],
            pinned_seats=form_data["pinned_seats"],
            weights=form_data["scoring_weights"],
        )
        warnings = list(form_data["pin_warnings"]) + list(result.warnings)
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            column_config=form_data["column_config"],
            pinned_seats_json=form_data["pinned_seats_json"],
            chart=result.chart,
            breakdown=result.breakdown,
            warnings=warnings,
            chart_history=result.attempt_charts,
            message="Generated a new chart.",
        )
        response = make_response(render_design(context))
        return apply_state_cookie(response, context)

    @app.post("/design")
    def swap_design() -> str:
        form_data = parse_form(request.form)
        chart = form_data["chart"]
        breakdown = score_chart(
            chart,
            form_data["people"],
            form_data["rows"],
            form_data["cols"],
            weights=form_data["scoring_weights"],
        )
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            column_config=form_data["column_config"],
            pinned_seats_json=form_data["pinned_seats_json"],
            chart=chart,
            breakdown=breakdown,
            warnings=form_data["warnings"],
            message="Switched design.",
        )
        response = make_response(render_design(context))
        return apply_state_cookie(response, context)

    @app.post("/save")
    def save() -> str:
        form_data = parse_form(request.form)
        save_name = request.form.get("save_name", "").strip()
        payload = {
            "people_json": form_data["people_json"],
            "people_table": form_data["people_table"],
            "rows": form_data["rows"],
            "cols": form_data["cols"],
            "design": form_data["design"],
            "layout_map": form_data["layout_map"],
            "chart_json": chart_to_json(form_data["chart"]),
            "column_config": form_data["column_config"],
            "pinned_seats_json": form_data["pinned_seats_json"],
        }
        save_payload(PROJECT_ROOT, save_name, payload)
        breakdown = score_chart(
            form_data["chart"],
            form_data["people"],
            form_data["rows"],
            form_data["cols"],
            weights=form_data["scoring_weights"],
        )
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            column_config=form_data["column_config"],
            pinned_seats_json=form_data["pinned_seats_json"],
            chart=form_data["chart"],
            breakdown=breakdown,
            warnings=form_data["warnings"],
            message=f"Saved as '{save_name}'.",
        )
        response = make_response(render_design(context))
        return apply_state_cookie(response, context)

    @app.get("/load")
    def load() -> str:
        name = request.args.get("name", "")
        payload = load_payload(PROJECT_ROOT, name)
        people_json = str(payload.get("people_json", people_to_json(default_people())))
        people_table = str(payload.get("people_table", ""))
        rows = _parse_int(str(payload.get("rows")), DEFAULT_ROWS, min_val=1, max_val=50)
        cols = _parse_int(str(payload.get("cols")), DEFAULT_COLS, min_val=1, max_val=50)
        design = sanitize_design(str(payload.get("design", DEFAULT_DESIGN)))
        column_config = str(
            payload.get("column_config", json.dumps(DEFAULT_COLUMN_CONFIG, indent=2))
        )
        scoring_weights = parse_scoring_weights(column_config)
        chart_json = str(payload.get("chart_json", ""))
        layout_map = str(payload.get("layout_map", "")) or layout_to_text(None, rows, cols)
        pinned_seats_json = str(payload.get("pinned_seats_json", "[]"))
        people = (
            parse_people_table(people_table) if people_table else parse_people_json(people_json)
        )
        layout = parse_layout_map(layout_map, rows, cols)
        pinned_seats, pin_warnings = parse_pinned_seats(
            pinned_seats_json, people, layout, rows, cols
        )
        chart = (
            chart_from_json(chart_json)
            if chart_json
            else generate_best_chart(
                people,
                rows,
                cols,
                iterations=100,
                layout=layout,
                pinned_seats=pinned_seats,
                weights=scoring_weights,
            ).chart
        )
        breakdown = score_chart(chart, people, rows, cols, weights=scoring_weights)
        context = build_context(
            people_json=people_json,
            people_table=people_table or people_to_table(people),
            rows=rows,
            cols=cols,
            design=design,
            layout_map=layout_map,
            column_config=column_config,
            pinned_seats_json=serialize_pinned_seats(pinned_seats),
            chart=chart,
            breakdown=breakdown,
            warnings=pin_warnings,
            message=f"Loaded '{name}'.",
        )
        response = make_response(render_design(context))
        return apply_state_cookie(response, context)

    enable_shared_feedback(
        app,
        project_root=PROJECT_ROOT,
        app_name="Parambulator",
        feedback_dir=FEEDBACK_DIR,
        addressed_dir=ADDRESSED_DIR,
    )

    @app.errorhandler(ValueError)
    def handle_value_error(err: ValueError) -> Response:
        app.logger.warning("Validation error: %s", err)
        return Response(str(err), status=400)

    @app.errorhandler(FileNotFoundError)
    def handle_file_not_found(err: FileNotFoundError) -> tuple[str, int]:
        app.logger.warning("File not found: %s", err)
        return render_template("error.html", status=404, message="Not found"), 404

    @app.errorhandler(404)
    def not_found(_error) -> tuple[str, int]:
        return render_template("error.html", status=404, message="Page not found"), 404

    @app.errorhandler(500)
    def server_error(_error) -> tuple[str, int]:
        app.logger.error("Server error")
        return render_template("error.html", status=500, message="Server error"), 500

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-hashes' "
            "https://cdn.tailwindcss.com https://unpkg.com https://static.cloudflareinsights.com; "
            "style-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "frame-ancestors 'self'; "
            "base-uri 'self'"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    return app


def parse_form(form: Dict[str, str]) -> Dict[str, object]:
    """Parse and validate submitted form data into app-ready structures."""
    people_table = form.get("people_table", "").strip()
    people_json = form.get("people_json", "").strip()
    if people_table:
        people = parse_people_table(people_table)
        if not people:
            people = default_people()
        people_json = people_to_json(people)
        people_table = people_to_table(people)
    else:
        if not people_json:
            people = default_people()
            people_json = people_to_json(people)
        else:
            people = parse_people_json(people_json)
        people_table = people_to_table(people)
    validate_relationship_names(people)

    rows = _parse_int(form.get("rows"), DEFAULT_ROWS, min_val=1, max_val=50)
    cols = _parse_int(form.get("cols"), DEFAULT_COLS, min_val=1, max_val=50)
    iterations = _parse_int(form.get("iterations"), 200, min_val=1, max_val=500)
    design = sanitize_design(form.get("design", DEFAULT_DESIGN) or DEFAULT_DESIGN)
    column_config = form.get("column_config") or json.dumps(DEFAULT_COLUMN_CONFIG, indent=2)
    scoring_weights = parse_scoring_weights(column_config)

    layout = parse_layout_from_form(form, rows, cols)
    layout_map = layout_to_text(layout, rows, cols)
    pinned_seats, pin_warnings = parse_pinned_seats(
        form.get("pinned_seats_json", ""), people, layout, rows, cols
    )
    pinned_seats_json = serialize_pinned_seats(pinned_seats)

    chart_json = form.get("chart_json", "").strip()
    warnings: List[str] = list(pin_warnings)
    chart: Chart
    if chart_json:
        chart = chart_from_json(chart_json)
    else:
        result = generate_best_chart(
            people,
            rows,
            cols,
            iterations=iterations,
            layout=layout,
            pinned_seats=pinned_seats,
            weights=scoring_weights,
        )
        chart = result.chart
        warnings.extend(result.warnings)

    return {
        "people": people,
        "people_json": people_json,
        "people_table": people_table,
        "rows": rows,
        "cols": cols,
        "iterations": iterations,
        "design": design,
        "column_config": column_config,
        "scoring_weights": scoring_weights,
        "layout": layout,
        "layout_map": layout_map,
        "pinned_seats": pinned_seats,
        "pinned_seats_json": pinned_seats_json,
        "pin_warnings": list(pin_warnings),
        "chart": chart,
        "warnings": warnings,
    }


def validate_relationship_names(people: List[Person]) -> None:
    """Ensure avoid/must-sit-by relationships only reference roster members."""
    invalid_avoid_entries = _unknown_relationship_entries(people, "avoid")
    if invalid_avoid_entries:
        raise ValueError("Unknown avoid-list names: " + "; ".join(invalid_avoid_entries))
    invalid_must_sit_by_entries = _unknown_relationship_entries(people, "must_sit_by")
    if invalid_must_sit_by_entries:
        raise ValueError(
            "Unknown must-sit-by names: " + "; ".join(invalid_must_sit_by_entries)
        )


def parse_pinned_seats(
    raw_json: str,
    people: List[Person],
    layout: List[List[bool]],
    rows: int,
    cols: int,
) -> Tuple[Dict[Tuple[int, int], str], List[str]]:
    """Parse and validate persisted pinned-seat assignments."""
    warnings: List[str] = []
    if not raw_json.strip():
        return {}, warnings

    payload = _decode_pinned_seat_payload(raw_json)
    if payload is None:
        return {}, [INVALID_PINNED_SEATS_WARNING]

    valid_names: Set[str] = {person.name for person in people}
    normalized: Dict[Tuple[int, int], str] = {}
    pinned_names: Set[str] = set()
    context = PinValidationContext(
        valid_names=valid_names,
        layout=layout,
        rows=rows,
        cols=cols,
        normalized=normalized,
        pinned_names=pinned_names,
    )

    for entry in payload:
        if not isinstance(entry, dict):
            warnings.append("Ignored a pinned seat entry with invalid format.")
            continue
        warning, seat, student_name = _validate_pinned_seat_entry(entry, context)
        if warning:
            warnings.append(warning)
            continue
        if seat is None or student_name is None:
            continue
        normalized[seat] = student_name
        pinned_names.add(student_name)

    return normalized, warnings


def sanitize_design(design: str) -> str:
    """Map aliases and invalid values to a supported design identifier."""
    normalized = str(design or "").strip()
    normalized = DESIGN_ALIASES.get(normalized.lower(), normalized)
    if normalized in ALLOWED_DESIGNS:
        return normalized
    return DEFAULT_DESIGN


def _unknown_relationship_entries(people: List[Person], attribute: str) -> List[str]:
    roster = {person.name for person in people}
    invalid_entries: List[str] = []
    for person in people:
        names = getattr(person, attribute)
        unknown_names = sorted({name for name in names if name not in roster})
        if unknown_names:
            invalid_entries.append(f"{person.name}: {', '.join(unknown_names)}")
    return invalid_entries


def _decode_pinned_seat_payload(raw_json: str) -> Optional[List[object]]:
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list):
        return None
    return payload


def _validate_pinned_seat_entry(
    entry: Dict[str, object],
    context: PinValidationContext,
) -> Tuple[Optional[str], Optional[Tuple[int, int]], Optional[str]]:
    warning, row_index, col_index, student_name = _pinned_entry_identity_error(entry, context)
    if warning:
        return warning, None, None

    warning = _pinned_entry_seat_error(row_index, col_index, student_name, context)
    if warning:
        return warning, None, None

    seat = (row_index, col_index)
    if seat in context.normalized:
        return f"Ignored pinned seat for {student_name}: seat already has a pin.", None, None
    if student_name in context.pinned_names:
        return f"Ignored duplicate pin for {student_name}.", None, None
    return None, seat, student_name


def _pinned_entry_identity_error(
    entry: Dict[str, object], context: PinValidationContext
) -> Tuple[Optional[str], Optional[int], Optional[int], str]:
    row_index, col_index = _parse_pin_coordinates(entry)
    seat: Optional[Tuple[int, int]] = None
    student_name = str(entry.get("name", "")).strip()
    if row_index is None or col_index is None:
        return "Ignored a pinned seat entry with invalid coordinates.", None, None, ""
    if not student_name:
        return "Ignored a pinned seat entry without a student name.", None, None, ""
    if student_name not in context.valid_names:
        return (
            f"Ignored pinned seat for {student_name}: student is not in the roster."
        ), None, None, ""
    return None, row_index, col_index, student_name


def _pinned_entry_seat_error(
    row_index: int,
    col_index: int,
    student_name: str,
    context: PinValidationContext,
) -> Optional[str]:
    if not (0 <= row_index < context.rows and 0 <= col_index < context.cols):
        return f"Ignored pinned seat for {student_name}: seat is outside layout bounds."
    if (
        row_index >= len(context.layout)
        or col_index >= len(context.layout[row_index])
        or not context.layout[row_index][col_index]
    ):
        return f"Ignored pinned seat for {student_name}: seat is disabled."
    return None


def _parse_pin_coordinates(entry: Dict[str, object]) -> Tuple[Optional[int], Optional[int]]:
    try:
        return int(entry.get("row")), int(entry.get("col"))
    except (TypeError, ValueError):
        return None, None


def parse_scoring_weights(column_config_raw: str) -> Dict[str, float]:
    """Convert column configuration JSON into scoring weights."""
    weights = dict(DEFAULT_SCORING_WEIGHTS)
    if not column_config_raw.strip():
        return weights

    try:
        parsed = json.loads(column_config_raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return weights
    if not isinstance(parsed, dict):
        return weights

    priority_mode = str(parsed.get("__priority_mode", "weight")).strip().lower()

    for column_key, score_key in COLUMN_TO_WEIGHT_KEY.items():
        entry = parsed.get(column_key)
        if not isinstance(entry, dict):
            continue
        if str(entry.get("type", "")).strip().lower() == "ignore":
            weights[score_key] = 0.0
            continue
        if priority_mode == "priority":
            try:
                priority = int(entry.get("priority", 3))
            except (TypeError, ValueError):
                priority = 3
            priority = min(5, max(1, priority))
            weights[score_key] = float(6 - priority)
            continue
        try:
            weight = float(entry.get("weight", weights[score_key]))
        except (TypeError, ValueError):
            continue
        weights[score_key] = max(0.0, weight)

    return weights


def serialize_pinned_seats(pinned_seats: Dict[Tuple[int, int], str]) -> str:
    """Serialize pinned seats to compact JSON for hidden form fields."""
    payload = [
        {"row": row_index, "col": col_index, "name": name}
        for (row_index, col_index), name in sorted(pinned_seats.items())
    ]
    return json.dumps(payload, separators=(",", ":"))


def pinned_keys_from_json(raw_json: str) -> List[str]:
    """Return normalized row:col keys extracted from pinned seat JSON."""
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(payload, list):
        return []

    keys: List[str] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        try:
            row_index = int(entry.get("row"))
            col_index = int(entry.get("col"))
        except (TypeError, ValueError):
            continue
        keys.append(f"{row_index}:{col_index}")
    return keys


def summarize_conflicts(
    chart: Chart, seat_constraints: List[List[List[Dict[str, str]]]]
) -> List[Dict[str, object]]:
    """List unmet constraints by student and seat in the current chart."""
    conflicts: List[Dict[str, object]] = []
    for row_index, row in enumerate(chart):
        for col_index, seat_name in enumerate(row):
            if not seat_name:
                continue
            statuses = []
            if row_index < len(seat_constraints) and col_index < len(seat_constraints[row_index]):
                statuses = seat_constraints[row_index][col_index]
            unmet = [
                item.get("label", "")
                for item in statuses
                if isinstance(item, dict) and item.get("status") == "not met"
            ]
            if unmet:
                conflicts.append(
                    {
                        "student": seat_name,
                        "seat": f"R{row_index + 1}C{col_index + 1}",
                        "constraints": unmet,
                    }
                )
    return conflicts


def build_context(
    *,
    people_json: str,
    people_table: str,
    rows: int,
    cols: int,
    design: str,
    layout_map: str,
    column_config: str,
    pinned_seats_json: str,
    chart: Chart,
    breakdown,
    warnings: List[str],
    chart_history: Optional[List[Chart]] = None,
    message: Optional[str] = None,
) -> Dict[str, object]:
    """Build template context for rendering the current chart state."""
    people = parse_people_json(people_json)
    layout_grid = parse_layout_map(layout_map, rows, cols)
    seat_constraints = seat_constraint_statuses(chart, people, rows, cols)
    conflicts = summarize_conflicts(chart, seat_constraints)
    pinned_seat_keys = pinned_keys_from_json(pinned_seats_json)
    return {
        "people_json": people_json,
        "people_table": people_table,
        "rows": rows,
        "cols": cols,
        "design": design,
        "design_template": f"designs/{design}.html",
        "layout_map": layout_map,
        "layout_grid": layout_grid,
        "column_config": column_config,
        "pinned_seats_json": pinned_seats_json,
        "pinned_seat_keys": pinned_seat_keys,
        "chart": chart,
        "chart_json": chart_to_json(chart),
        "seat_constraints": seat_constraints,
        "conflicts": conflicts,
        "breakdown": breakdown,
        "warnings": warnings,
        "chart_history": chart_history or [],
        "message": message,
        "available_designs": list(ALLOWED_DESIGNS),
        "design_option_labels": dict(DESIGN_OPTION_LABELS),
        "saves": list_saves(PROJECT_ROOT),
    }


def render_design(context: Dict[str, object]) -> str:
    """Render the active design template with shared context."""
    return render_template(context["design_template"], **context)


def parse_layout_from_form(form: Dict[str, str], rows: int, cols: int) -> List[List[bool]]:
    """Parse seat layout from hidden button fields, checkboxes, or text map."""
    if any(key.startswith("layout_cell_") and key.endswith("_value") for key in form.keys()):
        layout: List[List[bool]] = []
        for row_index in range(rows):
            row: List[bool] = []
            for col_index in range(cols):
                key = f"layout_cell_{row_index}_{col_index}_value"
                row.append(form.get(key) == "1")
            layout.append(row)
        return layout

    if any(key.startswith("layout_cell_") for key in form.keys()):
        layout: List[List[bool]] = []
        for row_index in range(rows):
            row: List[bool] = []
            for col_index in range(cols):
                key = f"layout_cell_{row_index}_{col_index}"
                row.append(key in form)
            layout.append(row)
        return layout

    layout_map = form.get("layout_map", "").strip()
    return parse_layout_map(layout_map, rows, cols)


def parse_layout_map(raw_text: str, rows: int, cols: int) -> List[List[bool]]:
    """Parse text layout markers into a rows-by-cols enabled-seat grid."""
    if not raw_text.strip():
        return [[True for _ in range(cols)] for _ in range(rows)]
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    layout: List[List[bool]] = []
    for row_index in range(rows):
        if row_index < len(lines):
            row_raw = lines[row_index].replace(" ", "").replace(",", "")
        else:
            row_raw = ""
        row: List[bool] = []
        for col_index in range(cols):
            if col_index < len(row_raw):
                char = row_raw[col_index]
                row.append(char in {"1", "x", "X", "#", "o", "O"})
            else:
                row.append(True)
        layout.append(row)
    return layout


def layout_to_text(layout: Optional[List[List[bool]]], rows: int, cols: int) -> str:
    """Render layout grid to newline-delimited text map."""
    if not layout:
        layout = [[True for _ in range(cols)] for _ in range(rows)]
    lines: List[str] = []
    for row in layout:
        line = "".join("X" if seat else "." for seat in row)
        lines.append(line)
    return "\n".join(lines)


def _parse_int(value: Optional[str], fallback: int, min_val: int = 1, max_val: int = 1000) -> int:
    try:
        parsed = int(value) if value is not None else fallback
    except (ValueError, TypeError):
        return fallback
    if parsed < min_val:
        return min_val
    if parsed > max_val:
        return max_val
    return parsed


def main() -> None:
    """Run the Flask development server."""
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("HOST", "127.0.0.1")

    app.run(debug=debug, host=host, port=port)


if __name__ == "__main__":
    main()
