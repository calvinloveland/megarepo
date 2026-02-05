from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from flask import Flask, Response, render_template, request

from .models import (
    Chart,
    chart_from_json,
    chart_to_json,
    default_people,
    parse_people_json,
    parse_people_table,
    people_to_json,
    people_to_table,
)
from .scoring import ChartResult, generate_best_chart, score_chart
from .storage import list_saves, load_payload, save_payload

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROWS = 4
DEFAULT_COLS = 5
DEFAULT_DESIGN = "design_1"


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )

    @app.get("/")
    def index() -> str:
        people = default_people()
        people_json = people_to_json(people)
        people_table = people_to_table(people)
        layout_map = layout_to_text(None, DEFAULT_ROWS, DEFAULT_COLS)
        result = generate_best_chart(
            people,
            DEFAULT_ROWS,
            DEFAULT_COLS,
            iterations=150,
            layout=parse_layout_map(layout_map, DEFAULT_ROWS, DEFAULT_COLS),
        )
        context = build_context(
            people_json=people_json,
            people_table=people_table,
            rows=DEFAULT_ROWS,
            cols=DEFAULT_COLS,
            design=DEFAULT_DESIGN,
            layout_map=layout_map,
            chart=result.chart,
            breakdown=result.breakdown,
            warnings=result.warnings,
        )
        return render_template("index.html", **context)

    @app.post("/generate")
    def generate() -> str:
        form_data = parse_form(request.form)
        result = generate_best_chart(
            form_data["people"],
            form_data["rows"],
            form_data["cols"],
            iterations=form_data["iterations"],
            layout=form_data["layout"],
        )
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            chart=result.chart,
            breakdown=result.breakdown,
            warnings=result.warnings,
            message="Generated a new chart.",
        )
        return render_design(context)

    @app.post("/design")
    def swap_design() -> str:
        form_data = parse_form(request.form)
        chart = form_data["chart"]
        breakdown = score_chart(chart, form_data["people"], form_data["rows"], form_data["cols"])
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            chart=chart,
            breakdown=breakdown,
            warnings=form_data["warnings"],
            message="Switched design.",
        )
        return render_design(context)

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
        }
        save_payload(PROJECT_ROOT, save_name, payload)
        breakdown = score_chart(
            form_data["chart"], form_data["people"], form_data["rows"], form_data["cols"]
        )
        context = build_context(
            people_json=form_data["people_json"],
            people_table=form_data["people_table"],
            rows=form_data["rows"],
            cols=form_data["cols"],
            design=form_data["design"],
            layout_map=form_data["layout_map"],
            chart=form_data["chart"],
            breakdown=breakdown,
            warnings=form_data["warnings"],
            message=f"Saved as '{save_name}'.",
        )
        return render_design(context)

    @app.get("/load")
    def load() -> str:
        name = request.args.get("name", "")
        payload = load_payload(PROJECT_ROOT, name)
        people_json = str(payload.get("people_json", people_to_json(default_people())))
        people_table = str(payload.get("people_table", ""))
        rows = int(payload.get("rows", DEFAULT_ROWS))
        cols = int(payload.get("cols", DEFAULT_COLS))
        design = str(payload.get("design", DEFAULT_DESIGN))
        chart_json = str(payload.get("chart_json", ""))
        layout_map = str(payload.get("layout_map", "")) or layout_to_text(None, rows, cols)
        people = parse_people_table(people_table) if people_table else parse_people_json(people_json)
        layout = parse_layout_map(layout_map, rows, cols)
        chart = (
            chart_from_json(chart_json)
            if chart_json
            else generate_best_chart(people, rows, cols, iterations=100, layout=layout).chart
        )
        breakdown = score_chart(chart, people, rows, cols)
        context = build_context(
            people_json=people_json,
            people_table=people_table or people_to_table(people),
            rows=rows,
            cols=cols,
            design=design,
            layout_map=layout_map,
            chart=chart,
            breakdown=breakdown,
            warnings=[],
            message=f"Loaded '{name}'.",
        )
        return render_design(context)

    @app.errorhandler(ValueError)
    def handle_value_error(err: ValueError) -> Response:
        return Response(str(err), status=400)

    return app


def parse_form(form: Dict[str, str]) -> Dict[str, object]:
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

    rows = _parse_int(form.get("rows"), DEFAULT_ROWS)
    cols = _parse_int(form.get("cols"), DEFAULT_COLS)
    iterations = _parse_int(form.get("iterations"), 200)
    design = form.get("design", DEFAULT_DESIGN) or DEFAULT_DESIGN

    layout = parse_layout_from_form(form, rows, cols)
    layout_map = layout_to_text(layout, rows, cols)

    chart_json = form.get("chart_json", "").strip()
    warnings: List[str] = []
    chart: Chart
    if chart_json:
        chart = chart_from_json(chart_json)
    else:
        result = generate_best_chart(people, rows, cols, iterations=iterations, layout=layout)
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
        "layout": layout,
        "layout_map": layout_map,
        "chart": chart,
        "warnings": warnings,
    }


def build_context(
    *,
    people_json: str,
    people_table: str,
    rows: int,
    cols: int,
    design: str,
    layout_map: str,
    chart: Chart,
    breakdown,
    warnings: List[str],
    message: Optional[str] = None,
) -> Dict[str, object]:
    return {
        "people_json": people_json,
        "people_table": people_table,
        "rows": rows,
        "cols": cols,
        "design": design,
        "design_template": f"designs/{design}.html",
        "layout_map": layout_map,
        "layout_grid": parse_layout_map(layout_map, rows, cols),
        "chart": chart,
        "chart_json": chart_to_json(chart),
        "breakdown": breakdown,
        "warnings": warnings,
        "message": message,
        "available_designs": [
            "design_1",
            "design_2",
            "design_3",
            "design_4",
            "design_5",
        ],
        "saves": list_saves(PROJECT_ROOT),
    }


def render_design(context: Dict[str, object]) -> str:
    return render_template(context["design_template"], **context)


def parse_layout_from_form(form: Dict[str, str], rows: int, cols: int) -> List[List[bool]]:
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
    if not layout:
        layout = [[True for _ in range(cols)] for _ in range(rows)]
    lines: List[str] = []
    for row in layout:
        line = "".join("X" if seat else "." for seat in row)
        lines.append(line)
    return "\n".join(lines)


def _parse_int(value: Optional[str], fallback: int) -> int:
    try:
        parsed = int(value) if value is not None else fallback
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def main() -> None:
    app = create_app()
    app.run(debug=True)


if __name__ == "__main__":
    main()
