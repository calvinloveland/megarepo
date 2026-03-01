"""Main module for running the Conway's Game of War Flask application."""

import os
from typing import Tuple

import flask

from . import game_state

app = flask.Flask(__name__)
# Prefer env var for production, fallback for dev
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

app.config["GAME"] = game_state.GameState()
app.config["ZOOM_LEVEL"] = 1.0


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
    app.run(debug=True)


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
    """Advance the game one tick and return the current game state as HTML."""
    game = _get_game()
    game.update()
    return game.board_to_html(current_player_index=_current_player_index())


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
            cell.owner = player_obj
            cell.alive = True
        elif cell.owner == player_obj:
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
    """Return the player's energy level as HTML."""
    game = _get_game()
    player_key = flask.session.get("player")
    if player_key == "player1":
        energy_level = game.players[0].get_energy_level()
    elif player_key == "player2":
        energy_level = game.players[1].get_energy_level()
    else:
        energy_level = "Unknown player"
    return f"<div>{energy_level}</div>"


@app.route("/reset", methods=["POST"])
def reset():
    """Reset the game to a fresh state, preserving session options."""
    game = game_state.GameState()
    _set_game(game)
    _apply_session_options_to_game()
    return game.board_to_html(current_player_index=_current_player_index())


if __name__ == "__main__":
    main()
