"""Main module for running the Conway's Game of War Flask application."""

import os
from typing import Tuple

import flask
from loguru import logger

from . import game_state

# Point Flask at the package's templates/static dirs regardless of CWD
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
app = flask.Flask(
    __name__,
    template_folder=os.path.join(_pkg_dir, "templates"),
    static_folder=os.path.join(_pkg_dir, "static"),
    static_url_path="/static",
)
# Prefer env var for production, fallback for dev
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

app.config["GAME"] = game_state.GameState()
app.config["ZOOM_LEVEL"] = 1.0
app.config["FIB_PREV"] = 0       # fib(n-1)
app.config["FIB_CURR"] = 1       # fib(n)
app.config["FIB_REMAINING"] = 0  # steps left in current turn animation


def _hex_to_rgb(hex_color: str):
    """Convert a hex color like '#ff00aa' to an (r,g,b) tuple."""
    if not hex_color:
        return None
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        try:
            return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return None
    return None


def _get_game() -> game_state.GameState:
    return app.config["GAME"]


def _set_game(game: game_state.GameState) -> None:
    app.config["GAME"] = game


def _reset_fib_progression() -> None:
    app.config["FIB_PREV"] = 0
    app.config["FIB_CURR"] = 1
    app.config["FIB_REMAINING"] = 0


def _test_routes_enabled() -> bool:
    return os.environ.get("ENABLE_TEST_ROUTES") == "1"


def _current_player_index() -> int:
    player_key = flask.session.get("player")
    return game_state.PLAYER_1 if player_key == "player1" else game_state.PLAYER_2


def _current_player() -> Tuple[game_state.Player, int]:
    game = _get_game()
    idx = _current_player_index()
    return game.players[idx], idx


def _player_display_name() -> str:
    """Return a human-readable display name for the current player."""
    player_key = flask.session.get("player")
    return "Player 1" if player_key == "player1" else "Player 2"


def _ai_display_name() -> str:
    """Return a human-readable AI difficulty name, or None."""
    diff = flask.session.get("ai_difficulty")
    if not diff:
        return None
    return diff.capitalize()


def _cell_can_toggle(
    game: game_state.GameState, x: int, y: int, player_obj: game_state.Player
) -> bool:
    return game.can_toggle_for_player(x, y, player_obj)


def _winner_payload(game: game_state.GameState) -> dict:
    """Return the current winner payload for UI/JSON responses."""
    winner_index = game.winner_index()
    if winner_index is None:
        return {"winner": None, "winner_name": None}
    winner_name = f"Player {winner_index + 1}"
    return {
        "winner": "p1" if winner_index == game_state.PLAYER_1 else "p2",
        "winner_name": winner_name,
    }


def _apply_session_options_to_game():
    """Apply player color and AI difficulty from session to the GAME instance."""
    game = _get_game()
    p1_hex = flask.session.get("player1_color")
    p2_hex = flask.session.get("player2_color")
    p1_rgb = _hex_to_rgb(p1_hex)
    p2_rgb = _hex_to_rgb(p2_hex)
    if p1_rgb:
        game.players[game_state.PLAYER_1].color = p1_rgb
    if p2_rgb:
        game.players[game_state.PLAYER_2].color = p2_rgb

    ai_diff = flask.session.get("ai_difficulty")
    player_choice = flask.session.get("player")
    if ai_diff:
        if player_choice == "player1":
            ai_index = game_state.PLAYER_2
        else:
            ai_index = game_state.PLAYER_1
        game.ai_player_index = ai_index
        if ai_diff == "easy":
            game.ai_player = game_state.EasyAIPlayer(
                color=game.players[ai_index].color,
                start_point=game.players[ai_index].start_point,
            )
        elif ai_diff == "medium":
            game.ai_player = game_state.MediumAIPlayer(
                color=game.players[ai_index].color,
                start_point=game.players[ai_index].start_point,
            )
        elif ai_diff == "hard":
            game.ai_player = game_state.HardAIPlayer(
                color=game.players[ai_index].color,
                start_point=game.players[ai_index].start_point,
            )
        else:
            game.ai_player = None


def main():
    """Run the Flask application."""
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)


@app.route("/")
def index():
    """Render the index page with window dimensions and zoom level."""
    if "player" not in flask.session:
        return flask.redirect("/select_player")
    _apply_session_options_to_game()
    _reset_fib_progression()
    window_width = flask.request.args.get("width", type=int, default=800)
    window_height = flask.request.args.get("height", type=int, default=600)
    zoom_level = flask.request.args.get("zoom", type=float, default=1.0)
    current_player, _ = _current_player()
    return flask.render_template(
        "index.html",
        window_width=window_width,
        window_height=window_height,
        zoom_level=zoom_level,
        player_name=_player_display_name(),
        ai_difficulty=_ai_display_name(),
        current_energy=current_player.energy,
        starting_energy=game_state.STARTING_ENERGY,
        winner_name=_winner_payload(_get_game())["winner_name"],
    )


@app.route("/select_player")
def select_player():
    """Render the player selection screen."""
    return flask.render_template("select_player.html")


@app.route("/set_player", methods=["POST"])
def set_player():
    """Set the selected player and options in the session."""
    player = flask.request.form.get("player")
    if player:
        flask.session["player"] = player
    ai_difficulty = flask.request.form.get("ai_difficulty")
    if ai_difficulty:
        flask.session["ai_difficulty"] = ai_difficulty
    player1_color = flask.request.form.get("player1_color")
    player2_color = flask.request.form.get("player2_color")
    if player1_color:
        flask.session["player1_color"] = player1_color
    if player2_color:
        flask.session["player2_color"] = player2_color
    return flask.redirect("/")


@app.route("/game_state")
def get_game_state():
    """Return the current game state as HTML (no tick advance)."""
    game = _get_game()
    return game.board_to_html(current_player_index=_current_player_index())


@app.route("/end_turn", methods=["POST"])
def end_turn():
    """Start a Fibonacci-sized turn: advance ONE tick."""
    game = _get_game()
    current_player_index = _current_player_index()
    before = None
    if flask.request.args.get("json") == "1":
        before = _board_visual_snapshot(game, current_player_index)

    if game.winner_index() is not None:
        app.config["FIB_REMAINING"] = 0
        if before is not None:
            return _board_patch_json(game, current_player_index, before, 0)
        return game.board_to_html(current_player_index=current_player_index, fib_remaining=0)

    prev = app.config["FIB_PREV"]
    curr = app.config["FIB_CURR"]  # total steps for this turn
    app.config["FIB_PREV"] = curr
    app.config["FIB_CURR"] = prev + curr
    remaining = curr - 1
    app.config["FIB_REMAINING"] = remaining
    game.update()
    if game.winner_index() is not None:
        remaining = 0
        app.config["FIB_REMAINING"] = 0

    if before is not None:
        return _board_patch_json(game, current_player_index, before, remaining)

    return game.board_to_html(current_player_index=current_player_index,
                              fib_remaining=remaining)


@app.route("/step", methods=["POST"])
def step():
    """Advance one tick and return the board."""
    game = _get_game()
    current_player_index = _current_player_index()
    before = None
    if flask.request.args.get("json") == "1":
        before = _board_visual_snapshot(game, current_player_index)

    if game.winner_index() is not None:
        app.config["FIB_REMAINING"] = 0
        if before is not None:
            return _board_patch_json(game, current_player_index, before, 0)
        return game.board_to_html(current_player_index=current_player_index, fib_remaining=0)

    remaining = app.config.get("FIB_REMAINING", 0)
    next_remaining = 0
    if remaining > 0:
        app.config["FIB_REMAINING"] = remaining - 1
        next_remaining = remaining - 1
    game.update()
    if game.winner_index() is not None:
        next_remaining = 0
        app.config["FIB_REMAINING"] = 0

    if before is not None:
        return _board_patch_json(game, current_player_index, before, next_remaining)

    return game.board_to_html(current_player_index=current_player_index,
                              fib_remaining=next_remaining)


@app.route("/update_cell", methods=["POST"])
def update_cell():
    """Update the state of a cell.
    Returns full HTML by default, or JSON when ?json=1 is set."""
    game = _get_game()
    x = flask.request.args.get("x", type=int)
    y = flask.request.args.get("y", type=int)
    if x is None or y is None:
        return game.board_to_html(current_player_index=_current_player_index())

    player_obj, idx = _current_player()
    if game.winner_index() is None:
        cell = game.board[x][y]
        cost = game.energy_cost_for_player(x, y, player_obj)
        if _cell_can_toggle(game, x, y, player_obj):
            if cell.owner is None:
                if player_obj.energy >= cost:
                    player_obj.energy -= cost
                    cell.owner = player_obj
                    cell.alive = True
                    game._claim_neighbors(x, y, player_obj)
            elif cell.owner == player_obj and player_obj.energy >= cost:
                player_obj.energy -= cost
                cell.alive = not cell.alive

    # JSON response for partial updates
    if flask.request.args.get("json") == "1":
        return _cell_json(game, x, y, idx)

    return game.board_to_html(current_player_index=idx)


def _cell_payload(game, x, y, current_player_index: int) -> dict:
    """Return the client-facing visual payload for a single cell."""
    cell = game.board[x][y]
    player_obj = game.players[current_player_index]
    cost = game.energy_cost_for_player(x, y, player_obj)
    r, g, b = game.generate_cell_color(x, y)
    br, bg, bb = game.generate_cell_border_color(x, y)
    return {
        "x": x,
        "y": y,
        "alive": cell.alive,
        "immortal": cell.immortal,
        "crop": max(0.0, min(1.0, cell.crop_level)),
        "cost": cost,
        "cost_label": game.compact_cost_label(cost),
        "cost_bg": game.cost_overlay_background(x, y, player_obj),
        "current_energy": player_obj.energy,
        "owner": game._cell_owner_key(cell),
        "action": game.cell_interaction_hint(x, y, current_player_index),
        "bg": f"rgb({r},{g},{b})",
        "border": f"rgb({br},{bg},{bb})",
        "has_hx": not cell.immortal,
    }


def _cell_json(game, x, y, current_player_index: int):
    """Return a lightweight JSON response for a single cell update."""
    payload = _cell_payload(game, x, y, current_player_index)
    payload.update(_winner_payload(game))
    return flask.jsonify(payload)


def _board_visual_snapshot(game, current_player_index: int) -> dict:
    """Capture the current visual state of all cells for diffing."""
    snapshot = {}
    for y in range(game.board_size_y):
        for x in range(game.board_size_x):
            payload = _cell_payload(game, x, y, current_player_index)
            snapshot[(x, y)] = (
                payload["bg"],
                payload["border"],
                payload["owner"],
                payload["alive"],
                payload["action"],
                payload["has_hx"],
                payload["cost"],
                payload["cost_label"],
                payload["cost_bg"],
            )
    return snapshot


def _board_patch_json(
    game: game_state.GameState,
    current_player_index: int,
    before: dict,
    fib_remaining: int,
):
    """Return a JSON patch with changed cells and updated board metadata."""
    changed_cells = []
    for y in range(game.board_size_y):
        for x in range(game.board_size_x):
            payload = _cell_payload(game, x, y, current_player_index)
            current = (
                payload["bg"],
                payload["border"],
                payload["owner"],
                payload["alive"],
                payload["action"],
                payload["has_hx"],
                payload["cost"],
                payload["cost_label"],
                payload["cost_bg"],
            )
            if before.get((x, y)) != current:
                changed_cells.append(payload)

    xmin, ymin, xmax, ymax = game._player_bbox(current_player_index)
    payload = {
        "fib_remaining": fib_remaining,
        "current_energy": game.players[current_player_index].energy,
        "bbox": {
            "xmin": xmin,
            "ymin": ymin,
            "xmax": xmax,
            "ymax": ymax,
        },
        "cells": changed_cells,
    }
    payload.update(_winner_payload(game))
    return flask.jsonify(payload)


@app.route("/zoom", methods=["POST"])
def zoom():
    """Update the zoom level (client uses CSS scaling) and return the board."""
    zoom_level = flask.request.args.get("zoom", type=float)
    if zoom_level is not None:
        app.config["ZOOM_LEVEL"] = zoom_level
    return _get_game().board_to_html(current_player_index=_current_player_index())


@app.route("/player_energy")
def player_energy():
    """Return both players' energy levels and cell counts as HTML."""
    game = _get_game()
    return _energy_html(game)


def _energy_html(game) -> str:
    """Build the status bar HTML with both players' info."""
    p1 = game.players[0]
    p2 = game.players[1]
    p1_cells = game.count_owned_cells(p1, alive_only=True)
    p2_cells = game.count_owned_cells(p2, alive_only=True)

    p1_color = "#{:02x}{:02x}{:02x}".format(*p1.color)
    p2_color = "#{:02x}{:02x}{:02x}".format(*p2.color)

    player_key = flask.session.get("player")
    human_name = "Player 1" if player_key == "player1" else "Player 2"
    diff = _ai_display_name()
    ai_info = f" · AI: {diff}" if diff else ""
    fib_steps = app.config["FIB_CURR"]
    winner = _winner_payload(game)
    victory_html = (
        f' &nbsp;&nbsp;· <strong>🏆 {winner["winner_name"]} wins!</strong>'
        if winner["winner_name"]
        else ""
    )

    p1_energy = f'<span id="energy-val" data-player="p1">⚡{p1.energy:.1f}</span>' if player_key == "player1" else f'⚡{p1.energy:.1f}'
    p2_energy = f'<span id="energy-val" data-player="p2">⚡{p2.energy:.1f}</span>' if player_key == "player2" else f'⚡{p2.energy:.1f}'

    return (
        f'<span style="color:{p1_color}">⬤ P1</span> '
        f'{p1_energy} 🏠{p1_cells} '
        f'&nbsp;&nbsp; '
        f'<span style="color:{p2_color}">⬤ P2</span> '
        f'{p2_energy} 🏠{p2_cells} '
        f'&nbsp;&nbsp;· {human_name}{ai_info}'
        f' · ⏭ +{fib_steps}'
        f'{victory_html}'
    )


@app.route("/reset", methods=["POST"])
def reset():
    """Reset the game to a fresh state, preserving session options."""
    game = game_state.GameState()
    _set_game(game)
    _apply_session_options_to_game()
    _reset_fib_progression()
    return game.board_to_html(current_player_index=_current_player_index())


def _build_territory_collision_scenario() -> game_state.GameState:
    """Create a deterministic near-start collision scenario for browser tests."""
    game = game_state.GameState()
    p1 = game.players[game_state.PLAYER_1]
    p2 = game.players[game_state.PLAYER_2]

    p1_cells = [(22, 20), (22, 21), (23, 20), (23, 21)]
    p2_cells = [(24, 20), (24, 21), (25, 20), (25, 21)]

    for x, y in p1_cells:
        game.board[x][y].owner = p1
        game.board[x][y].alive = True
        game._claim_neighbors(x, y, p1)

    for x, y in p2_cells:
        game.board[x][y].owner = p2
        game.board[x][y].alive = True
        game._claim_neighbors(x, y, p2)

    return game


@app.route("/__test__/seed_scenario", methods=["POST"])
def seed_scenario():
    """Seed deterministic scenarios for browser tests.

    This route is disabled unless ENABLE_TEST_ROUTES=1 is set in the server env.
    """
    if not _test_routes_enabled():
        flask.abort(404)

    payload = flask.request.get_json(silent=True) or {}
    name = flask.request.form.get("name") or payload.get("name")

    if name == "territory_collision":
        game = _build_territory_collision_scenario()
    else:
        return flask.jsonify({"ok": False, "error": f"unknown scenario: {name}"}), 400

    _set_game(game)
    _apply_session_options_to_game()
    _reset_fib_progression()
    return flask.jsonify({"ok": True, "scenario": name})


@app.route("/log_error", methods=["POST"])
def log_error():
    """Client-side error logger — logs JS errors/warnings to the server log."""
    data = flask.request.get_json(silent=True) or {}
    level = data.get("level", "unknown")
    msg = data.get("message", "")
    stack = data.get("stack", "")
    log = logger.warning if level == "warning" else logger.error
    log(f"JS {level}: {msg}")
    if stack:
        log(f"Stack:\n{stack}")
    return ("", 204)


if __name__ == "__main__":
    main()
