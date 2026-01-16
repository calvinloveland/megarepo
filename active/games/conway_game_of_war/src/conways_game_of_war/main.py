"""Main module for running the Conway's Game of War Flask application."""

import os
import flask

from conways_game_of_war import game_state

app = flask.Flask(__name__)
# Prefer env var for production, fallback for dev
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

GAME = game_state.GameState()
ZOOM_LEVEL = 1.0


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


def _apply_session_options_to_game():
    """Apply player color and AI difficulty from session to the GAME instance."""
    p1_hex = flask.session.get("player1_color")
    p2_hex = flask.session.get("player2_color")
    p1_rgb = _hex_to_rgb(p1_hex)
    p2_rgb = _hex_to_rgb(p2_hex)
    if p1_rgb:
        GAME.players[game_state.PLAYER_1].color = p1_rgb
    if p2_rgb:
        GAME.players[game_state.PLAYER_2].color = p2_rgb

    # Configure AI side/difficulty once per session change
    ai_diff = flask.session.get("ai_difficulty")
    player_choice = flask.session.get("player")
    if ai_diff:
        # If the human is player1, AI is player2 and vice versa
        if player_choice == "player1":
            ai_index = game_state.PLAYER_2
        else:
            ai_index = game_state.PLAYER_1
        GAME.ai_player_index = ai_index
        if ai_diff == "easy":
            GAME.ai_player = game_state.EasyAIPlayer(
                color=GAME.players[ai_index].color,
                start_point=GAME.players[ai_index].start_point,
            )
        elif ai_diff == "medium":
            GAME.ai_player = game_state.MediumAIPlayer(
                color=GAME.players[ai_index].color,
                start_point=GAME.players[ai_index].start_point,
            )
        elif ai_diff == "hard":
            GAME.ai_player = game_state.HardAIPlayer(
                color=GAME.players[ai_index].color,
                start_point=GAME.players[ai_index].start_point,
            )
        else:
            GAME.ai_player = None


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
    GAME.update()
    player_key = flask.session.get("player")
    idx = game_state.PLAYER_1 if player_key == "player1" else game_state.PLAYER_2
    return GAME.board_to_html(current_player_index=idx)


@app.route("/update_cell", methods=["POST"])
def update_cell():
    """Update the state of a cell and return the updated game state as HTML."""
    x = flask.request.args.get("x", type=int)
    y = flask.request.args.get("y", type=int)
    if x is None or y is None:
        player_key = flask.session.get("player")
        idx = game_state.PLAYER_1 if player_key == "player1" else game_state.PLAYER_2
        return GAME.board_to_html(current_player_index=idx)

    # Determine current player
    player_key = flask.session.get("player")
    if player_key == "player1":
        player_obj = GAME.players[game_state.PLAYER_1]
        idx = game_state.PLAYER_1
    else:
        player_obj = GAME.players[game_state.PLAYER_2]
        idx = game_state.PLAYER_2

    # Only allow toggling in owned cells or placing adjacent to owned alive cells
    cell = GAME.board[x][y]
    allowed = False
    if not cell.immortal:
        if cell.owner == player_obj:
            allowed = True
        elif (
            (not cell.alive)
            and (cell.owner in (None, player_obj))
            and (GAME.count_friendly_neighbors(x, y, player_obj) > 0)
        ):
            allowed = True

    if allowed:
        if cell.owner is None:
            cell.owner = player_obj
            cell.alive = True
        elif cell.owner == player_obj:
            cell.alive = not cell.alive

    return GAME.board_to_html(current_player_index=idx)


@app.route("/zoom", methods=["POST"])
def zoom():
    """Update the zoom level (client uses CSS scaling) and return the board."""
    zoom_level = flask.request.args.get("zoom", type=float)
    global ZOOM_LEVEL
    if zoom_level is not None:
        ZOOM_LEVEL = zoom_level
    player_key = flask.session.get("player")
    idx = game_state.PLAYER_1 if player_key == "player1" else game_state.PLAYER_2
    return GAME.board_to_html(current_player_index=idx)


@app.route("/player_energy")
def player_energy():
    """Return the player's energy level as HTML."""
    player = flask.session.get("player")
    if player == "player1":
        energy_level = GAME.players[0].get_energy_level()
    elif player == "player2":
        energy_level = GAME.players[1].get_energy_level()
    else:
        energy_level = "Unknown player"
    return f"<div>{energy_level}</div>"


@app.route("/reset", methods=["POST"])
def reset():
    """Reset the game to a fresh state, preserving session options."""
    global GAME
    GAME = game_state.GameState()
    _apply_session_options_to_game()
    player_key = flask.session.get("player")
    idx = game_state.PLAYER_1 if player_key == "player1" else game_state.PLAYER_2
    return GAME.board_to_html(current_player_index=idx)


if __name__ == "__main__":
    main()
