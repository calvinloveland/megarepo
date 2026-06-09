"""Main module for running the Conway's Game of War Flask application."""

import os
from typing import Tuple

import flask

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
    cell = game.board[x][y]
    if cell.immortal:
        return False
    if cell.owner == player_obj:
        return True
    return (
        (not cell.alive)
        and (cell.owner in (None, player_obj))
        and (game.count_friendly_neighbors(x, y, player_obj) > 0)
    )


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

    # Configure AI side/difficulty once per session change
    ai_diff = flask.session.get("ai_difficulty")
    player_choice = flask.session.get("player")
    if ai_diff:
        # If the human is player1, AI is player2 and vice versa
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
    window_width = flask.request.args.get("width", type=int, default=800)
    window_height = flask.request.args.get("height", type=int, default=600)
    zoom_level = flask.request.args.get("zoom", type=float, default=1.0)
    return flask.render_template(
        "index.html",
        window_width=window_width,
        window_height=window_height,
        zoom_level=zoom_level,
        player_name=_player_display_name(),
        ai_difficulty=_ai_display_name(),
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
    """Start a Fibonacci-sized turn: advance ONE tick and store remaining steps.
    The client animates the remaining ticks by calling /step repeatedly."""
    game = _get_game()
    prev = app.config["FIB_PREV"]
    curr = app.config["FIB_CURR"]  # total steps for this turn
    # Move to next Fibonacci number for NEXT turn
    app.config["FIB_PREV"] = curr
    app.config["FIB_CURR"] = prev + curr
    # Store remaining steps (total - 1, since we take one now)
    app.config["FIB_REMAINING"] = curr - 1
    game.update()
    html = game.board_to_html(current_player_index=_current_player_index())
    return _embed_remaining(html, curr - 1)


def _embed_remaining(html: str, remaining: int) -> str:
    """Embed the remaining step count in the #game element for the client."""
    marker = 'data-board-w='
    idx = html.find(marker)
    if idx == -1:
        return html
    space = html.rfind(' ', 0, idx)
    if space == -1:
        space = html.find('>', idx)
    return html[:space] + f' data-fib-remaining="{remaining}"' + html[space:]


@app.route("/step", methods=["POST"])
def step():
    """Advance one tick and return the board with remaining count embedded."""
    game = _get_game()
    remaining = app.config.get("FIB_REMAINING", 0)
    if remaining > 0:
        app.config["FIB_REMAINING"] = remaining - 1
    game.update()
    html = game.board_to_html(current_player_index=_current_player_index())
    return _embed_remaining(html, remaining - 1 if remaining > 0 else 0)


@app.route("/update_cell", methods=["POST"])
def update_cell():
    """Update the state of a cell and return the updated game state as HTML."""
    game = _get_game()
    x = flask.request.args.get("x", type=int)
    y = flask.request.args.get("y", type=int)
    if x is None or y is None:
        return game.board_to_html(current_player_index=_current_player_index())

    player_obj, idx = _current_player()
    cell = game.board[x][y]
    if _cell_can_toggle(game, x, y, player_obj):
        if cell.owner is None:
            # Claiming a new cell costs energy
            if player_obj.energy >= game_state.ENERGY_PER_CELL:
                player_obj.energy -= game_state.ENERGY_PER_CELL
                cell.owner = player_obj
                cell.alive = True
                # Territory expansion: neighbours become owned too
                game._claim_neighbors(x, y, player_obj)
        elif cell.owner == player_obj:
            # Toggling an owned cell is free
            cell.alive = not cell.alive

    return game.board_to_html(current_player_index=idx)


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
    p1_cells = sum(1 for row in game.board for c in row if c.owner == p1 and c.alive)
    p2_cells = sum(1 for row in game.board for c in row if c.owner == p2 and c.alive)

    p1_color = "#{:02x}{:02x}{:02x}".format(*p1.color)
    p2_color = "#{:02x}{:02x}{:02x}".format(*p2.color)

    player_key = flask.session.get("player")
    human_name = "Player 1" if player_key == "player1" else "Player 2"
    diff = _ai_display_name()
    ai_info = f" · AI: {diff}" if diff else ""

    fib_steps = app.config["FIB_CURR"]
    return (
        f'<span style="color:{p1_color}">⬤ P1</span> '
        f'⚡{p1.energy:.1f} 🏠{p1_cells} '
        f'&nbsp;&nbsp; '
        f'<span style="color:{p2_color}">⬤ P2</span> '
        f'⚡{p2.energy:.1f} 🏠{p2_cells} '
        f'&nbsp;&nbsp;· {human_name}{ai_info}'
        f' · ⏭ +{fib_steps}'
    )


@app.route("/reset", methods=["POST"])
def reset():
    """Reset the game to a fresh state, preserving session options."""
    game = game_state.GameState()
    _set_game(game)
    _apply_session_options_to_game()
    app.config["FIB_PREV"] = 0
    app.config["FIB_CURR"] = 1
    app.config["FIB_REMAINING"] = 0
    return game.board_to_html(current_player_index=_current_player_index())


if __name__ == "__main__":
    main()
