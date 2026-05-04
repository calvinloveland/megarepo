"""Flask app for the Code Reviewdle vertical slice."""

from __future__ import annotations

import os
from datetime import date
from typing import Any

from flask import Flask, render_template, request, session

from .content import PROJECT_ROOT, available_issue_types, puzzle_for_day
from .game import MAX_GUESSES, apply_guess, build_empty_progress, guesses_remaining, is_over


def create_app() -> Flask:
    """Create and configure the Flask app."""
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-key")

    @app.get("/")
    def index() -> str:
        return _render_game_page(_requested_date(request.args.get("day")))

    @app.post("/guess")
    def guess() -> str:
        play_date = _requested_date(request.form.get("day"))
        puzzle = puzzle_for_day(play_date)
        issue_types = available_issue_types()
        progress = _progress_for_puzzle(puzzle.id)

        if is_over(progress):
            return _render_game_page(play_date)

        line_number_text = str(request.form.get("line_number", "")).strip()
        issue_type = str(request.form.get("issue_type", "")).strip()
        error_message = _validate_guess(line_number_text, issue_type, puzzle.code_line_count, issue_types)
        if error_message is not None:
            return _render_game_page(
                play_date,
                error_message=error_message,
                selected_line_number=line_number_text,
                selected_issue_type=issue_type,
            )

        updated_progress = apply_guess(progress, puzzle, int(line_number_text), issue_type)
        _store_progress(puzzle.id, updated_progress)
        return _render_game_page(
            play_date,
            selected_line_number=line_number_text,
            selected_issue_type=issue_type,
        )

    return app


def _requested_date(raw_value: str | None = None) -> date:
    if raw_value:
        try:
            return date.fromisoformat(raw_value)
        except ValueError:
            pass
    return date.today()


def _progress_for_puzzle(puzzle_id: str) -> dict[str, Any]:
    progress_by_puzzle = dict(session.get("progress_by_puzzle", {}))
    return dict(progress_by_puzzle.get(puzzle_id, build_empty_progress()))


def _store_progress(puzzle_id: str, progress: dict[str, Any]) -> None:
    progress_by_puzzle = dict(session.get("progress_by_puzzle", {}))
    progress_by_puzzle[puzzle_id] = progress
    session["progress_by_puzzle"] = progress_by_puzzle
    session.modified = True


def _validate_guess(
    line_number_text: str,
    issue_type: str,
    max_line_number: int,
    issue_types: tuple[str, ...],
) -> str | None:
    if not line_number_text:
        return "Enter a line number before submitting a guess."
    try:
        line_number = int(line_number_text)
    except ValueError:
        return "Line number must be an integer."

    if line_number < 1 or line_number > max_line_number:
        return f"Line number must be between 1 and {max_line_number}."
    if issue_type not in issue_types:
        return "Pick one of the listed issue types."
    return None


def _render_game_page(
    play_date: date,
    *,
    error_message: str | None = None,
    selected_line_number: str = "",
    selected_issue_type: str = "",
) -> str:
    puzzle = puzzle_for_day(play_date)
    progress = _progress_for_puzzle(puzzle.id)
    issue_types = available_issue_types()
    revealed_hints = puzzle.hints[: progress["unlocked_hints"]]
    puzzle_finished = is_over(progress)

    return render_template(
        "index.html",
        play_date=play_date.isoformat(),
        puzzle=puzzle,
        line_entries=list(enumerate(puzzle.code, start=1)),
        issue_types=issue_types,
        progress=progress,
        guesses_remaining=guesses_remaining(progress),
        max_guesses=MAX_GUESSES,
        revealed_hints=revealed_hints,
        puzzle_finished=puzzle_finished,
        error_message=error_message,
        selected_line_number=selected_line_number,
        selected_issue_type=selected_issue_type,
    )


def main() -> None:
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=debug, host=host, port=port)


if __name__ == "__main__":
    main()
