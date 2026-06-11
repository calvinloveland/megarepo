"""Main module for running the Conway's Game of War Flask application."""

import os
import uuid
import json
import time
from typing import Tuple, Optional

import flask
from loguru import logger

from . import game_state

_pkg_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_pkg_dir, "data")
_RATINGS_FILE = os.path.join(_DATA_DIR, "ratings.json")
os.makedirs(_DATA_DIR, exist_ok=True)

app = flask.Flask(
    __name__,
    template_folder=os.path.join(_pkg_dir, "templates"),
    static_folder=os.path.join(_pkg_dir, "static"),
    static_url_path="/static",
)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

# Matchmaking queue and active matches
MATCH_QUEUE = []  # list of {pid, username, color}
ACTIVE_MATCHES = {}  # match_id -> {p1_pid, p2_pid, p1_name, p2_name, game, turn_idx, started}
TURN_TIMEOUT = 60  # seconds per turn
HEARTBEAT_TIMEOUT = 15  # seconds before a player is considered disconnected
LAST_HEARTBEAT = {}  # pid -> timestamp of last heartbeat
MATCH_LOGS = {}  # match_id -> list of {type, x, y, player_idx, action, cost, timestamp}

app.config["GAME"] = game_state.GameState()
app.config["ZOOM_LEVEL"] = 1.0
app.config["FIB_PREV"] = 0
app.config["FIB_CURR"] = 1
app.config["FIB_REMAINING"] = 0
app.config["TURN_PLACED"] = {}
MATCH_EPOCH = 0  # incremented on every turn switch for instant poll detection


def _bump_epoch():
    global MATCH_EPOCH
    MATCH_EPOCH += 1


def _current_epoch() -> int:
    global MATCH_EPOCH
    return MATCH_EPOCH


def _hex_to_rgb(hex_color: str):
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


# ─── Persistent rankings ────────────────────────────────────────────

DEFAULT_RATING = 1200
K_FACTOR = 32


def _load_rankings() -> dict:
    """Load rankings from the JSON file."""
    if not os.path.exists(_RATINGS_FILE):
        return {}
    try:
        with open(_RATINGS_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_rankings(rankings: dict) -> None:
    """Save rankings to the JSON file."""
    try:
        with open(_RATINGS_FILE, "w") as f:
            json.dump(rankings, f, indent=2)
    except OSError as e:
        logger.error(f"Failed to save rankings: {e}")


def _update_elo_rankings(winner_name: str, loser_name: str) -> dict:
    """Update ELO rankings for a match result and persist."""
    rankings = _load_rankings()
    for name in (winner_name, loser_name):
        if name not in rankings:
            rankings[name] = {"rating": DEFAULT_RATING, "wins": 0, "losses": 0}
    wr = rankings[winner_name]
    lr = rankings[loser_name]
    expected_winner = 1 / (1 + 10 ** ((lr["rating"] - wr["rating"]) / 400))
    wr["rating"] = round(wr["rating"] + K_FACTOR * (1 - expected_winner))
    lr["rating"] = round(lr["rating"] + K_FACTOR * (0 - (1 - expected_winner)))
    wr["wins"] += 1
    lr["losses"] += 1
    _save_rankings(rankings)
    return rankings


@app.route("/rankings")
def get_rankings():
    """Return all rankings as JSON."""
    rankings = _load_rankings()
    entries = []
    for name, data in sorted(rankings.items(), key=lambda x: -x[1]["rating"]):
        entries.append({
            "name": name,
            "rating": data["rating"],
            "wins": data["wins"],
            "losses": data["losses"],
        })
    return flask.jsonify(entries)


@app.route("/record_match", methods=["POST"])
def record_match():
    """Record a match result and update rankings."""
    data = flask.request.get_json(silent=True) or {}
    winner = data.get("winner", "").strip()
    loser = data.get("loser", "").strip()
    if not winner or not loser:
        return flask.jsonify({"ok": False, "error": "winner and loser required"}), 400
    _update_elo_rankings(winner, loser)
    return flask.jsonify({"ok": True})



def _set_game(game: game_state.GameState) -> None:
    app.config["GAME"] = game


def _reset_fib_progression() -> None:
    app.config["FIB_PREV"] = 0
    app.config["FIB_CURR"] = 1
    app.config["FIB_REMAINING"] = 0


def _test_routes_enabled() -> bool:
    return os.environ.get("ENABLE_TEST_ROUTES") == "1"


def _get_match() -> Optional[dict]:
    """Get the active match for the current session, if any."""
    match_id = flask.session.get("match_id")
    if not match_id or match_id not in ACTIVE_MATCHES:
        return None
    return ACTIVE_MATCHES[match_id]





def _winner_payload(game: game_state.GameState) -> dict:
    winner_index = game.winner_index()
    if winner_index is None:
        return {"winner": None, "winner_name": None}
    winner_name = f"Player {winner_index + 1}"
    return {
        "winner": "p1" if winner_index == game_state.PLAYER_1 else "p2",
        "winner_name": winner_name,
    }


def _cell_payload(game, x, y, current_player_index: int) -> dict:
    cell = game.board[x][y]
    player_obj = game.players[current_player_index]
    cost = game.energy_cost_for_player(x, y, player_obj)
    r, g, b = game.generate_cell_color(x, y)
    br, bg, bb = game.generate_cell_border_color(x, y)
    return {
        "x": x, "y": y, "alive": cell.alive, "immortal": cell.immortal,
        "crop": max(0.0, min(1.0, cell.crop_level)),
        "cost": cost, "cost_label": game.compact_cost_label(cost),
        "cost_bg": game.cost_overlay_background(x, y, player_obj),
        "current_energy": player_obj.energy,
        "owner": game._cell_owner_key(cell),
        "action": game.cell_interaction_hint(x, y, current_player_index),
        "bg": f"rgb({r},{g},{b})", "border": f"rgb({br},{bg},{bb})", "has_hx": not cell.immortal,
    }


def _cell_json(game, x, y, current_player_index: int):
    payload = _cell_payload(game, x, y, current_player_index)
    payload.update(_winner_payload(game))
    return flask.jsonify(payload)


def _board_visual_snapshot(game, current_player_index: int) -> dict:
    snapshot = {}
    for y in range(game.board_size_y):
        for x in range(game.board_size_x):
            p = _cell_payload(game, x, y, current_player_index)
            snapshot[(x, y)] = (p["bg"], p["border"], p["owner"], p["alive"], p["action"], p["has_hx"], p["cost"], p["cost_label"], p["cost_bg"])
    return snapshot


def _board_patch_json(game, current_player_index, before, fib_remaining):
    changed = []
    for y in range(game.board_size_y):
        for x in range(game.board_size_x):
            p = _cell_payload(game, x, y, current_player_index)
            cur = (p["bg"], p["border"], p["owner"], p["alive"], p["action"], p["has_hx"], p["cost"], p["cost_label"], p["cost_bg"])
            if before.get((x, y)) != cur:
                changed.append(p)
    xmin, ymin, xmax, ymax = game._player_bbox(current_player_index)
    payload = {
        "fib_remaining": fib_remaining,
        "current_energy": game.players[current_player_index].energy,
        "bbox": {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax},
        "cells": changed,
    }
    payload.update(_winner_payload(game))
    return flask.jsonify(payload)


def _energy_html(game, p1_name="Player 1", p2_name="Player 2") -> str:
    p1 = game.players[0]
    p2 = game.players[1]
    p1_cells = game.count_owned_cells(p1, alive_only=True)
    p2_cells = game.count_owned_cells(p2, alive_only=True)
    p1_color = "#{:02x}{:02x}{:02x}".format(*p1.color)
    p2_color = "#{:02x}{:02x}{:02x}".format(*p2.color)
    fib_steps = app.config["FIB_CURR"]
    winner = _winner_payload(game)
    victory_html = f' &nbsp;&nbsp;· <strong>🏆 {winner["winner_name"]} wins!</strong>' if winner["winner_name"] else ""
    return (
        f'<span style="color:{p1_color}">⬤ {p1_name}</span> '
        f'<span id="energy-val" data-player="p1">⚡{p1.energy:.1f}</span> 🏠{p1_cells} &nbsp;&nbsp; '
        f'<span style="color:{p2_color}">⬤ {p2_name}</span> ⚡{p2.energy:.1f} 🏠{p2_cells}'
        f' · ⏭ +{fib_steps}{victory_html}'
    )


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)


# ─── Lobby ───────────────────────────────────────────────────────────

@app.route("/lobby")
def lobby():
    """Render the matchmaking lobby."""
    return flask.render_template("lobby.html")


@app.route("/leaderboard")
def leaderboard():
    """Render the leaderboard page."""
    return flask.render_template("leaderboard.html")


@app.route("/join_queue", methods=["POST"])
def join_queue():
    """Join the matchmaking queue."""
    data = flask.request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    color = data.get("color", "#ff0000")
    if not username:
        return flask.jsonify({"ok": False, "error": "username required"}), 400

    if "_pid" not in flask.session:
        flask.session["_pid"] = str(uuid.uuid4())
    pid = flask.session["_pid"]
    flask.session["username"] = username
    flask.session["player_color"] = color

    # Remove any existing entry for this sid
    global MATCH_QUEUE
    MATCH_QUEUE = [e for e in MATCH_QUEUE if e["pid"] != pid]

    # Check if there's someone waiting
    if len(MATCH_QUEUE) > 0:
        other = MATCH_QUEUE.pop(0)
        match_id = str(uuid.uuid4())
        p1, p2 = (other, {"pid": pid, "username": username, "color": color})
        game = game_state.GameState()
        p1_rgb = _hex_to_rgb(p1.get("color", "#ff0000"))
        p2_rgb = _hex_to_rgb(p2.get("color", "#2266ff"))
        if p1_rgb:
            game.players[game_state.PLAYER_1].color = p1_rgb
        if p2_rgb:
            game.players[game_state.PLAYER_2].color = p2_rgb

        ACTIVE_MATCHES[match_id] = {
            "p1_pid": p1["pid"], "p2_pid": p2["pid"],
            "p1_name": p1["username"], "p2_name": p2["username"],
            "game": game, "turn_idx": game_state.PLAYER_1,
            "started": True, "turn_deadline": time.time() + TURN_TIMEOUT,
        }
        MATCH_LOGS[match_id] = []
        flask.session["match_id"] = match_id
        return flask.jsonify({"ok": True, "match_id": match_id, "matched": True, "player": 1})

    # No one waiting — join queue
    MATCH_QUEUE.append({"pid": pid, "username": username, "color": color})
    return flask.jsonify({"ok": True, "matched": False})


@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    """Client heartbeat to indicate the player is still connected."""
    pid = flask.session.get("_pid")
    if pid:
        LAST_HEARTBEAT[pid] = time.time()
    return flask.jsonify({"ok": True})


@app.route("/leave_queue", methods=["POST"])
def leave_queue():
    pid = flask.session.get("_pid")
    global MATCH_QUEUE
    MATCH_QUEUE = [e for e in MATCH_QUEUE if e["pid"] != pid]
    return flask.jsonify({"ok": True})


@app.route("/poll_match")
def poll_match():
    """Check if the current session has been matched."""
    match_id = flask.session.get("match_id")
    pid = flask.session.get("_pid")
    if match_id and match_id in ACTIVE_MATCHES:
        match = ACTIVE_MATCHES[match_id]
        player = 0 if match["p1_pid"] == pid else (1 if match["p2_pid"] == pid else None)
        if player is not None:
            return flask.jsonify({"matched": True, "match_id": match_id, "player": player})
    for mid, m in list(ACTIVE_MATCHES.items()):
        if m["p2_pid"] == pid or m["p1_pid"] == pid:
            player = 0 if m["p1_pid"] == pid else 1
            flask.session["match_id"] = mid
            return flask.jsonify({"matched": True, "match_id": mid, "player": player})
    return flask.jsonify({"matched": False})


# ─── Game ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Redirect to lobby or game."""
    match_id = flask.session.get("match_id")
    if match_id and match_id in ACTIVE_MATCHES:
        match = ACTIVE_MATCHES[match_id]
        pid = flask.session.get("_pid")
        player = 0 if match["p1_pid"] == pid else (1 if match["p2_pid"] == pid else None)
        if player is not None:
            game = match["game"]
            p_name = match["p1_name"] if player == 0 else match["p2_name"]
            return flask.render_template(
                "index.html",
                window_width=800, window_height=600, zoom_level=1.0,
                player_name=p_name, player_index=player,
                player1_name=match["p1_name"], player2_name=match["p2_name"],
                ai_difficulty=None,
                current_energy=game.players[player].energy,
                starting_energy=game_state.STARTING_ENERGY,
                winner_name=_winner_payload(game)["winner_name"],
                match_id=match_id,
            )
    return flask.redirect("/lobby")


@app.route("/spectate/<match_id>")
def spectate(match_id):
    """Render a read-only spectator view of a match."""
    if match_id not in ACTIVE_MATCHES:
        return flask.redirect("/lobby")
    match = ACTIVE_MATCHES[match_id]
    game = match["game"]
    return flask.render_template(
        "index.html",
        window_width=800, window_height=600, zoom_level=1.0,
        player_name="Spectator", player_index=None,
        player1_name=match["p1_name"], player2_name=match["p2_name"],
        ai_difficulty=None, spectator=True,
        current_energy=0,
        starting_energy=game_state.STARTING_ENERGY,
        winner_name=_winner_payload(game)["winner_name"],
        match_id=match_id,
    )


@app.route("/active_matches")
def active_matches():
    """Return a list of active matches for the lobby."""
    matches = []
    for mid, m in ACTIVE_MATCHES.items():
        game = m["game"]
        winner = _winner_payload(game)
        matches.append({
            "match_id": mid,
            "p1_name": m["p1_name"],
            "p2_name": m["p2_name"],
            "turn_idx": m["turn_idx"],
            "turn_name": m["p1_name"] if m["turn_idx"] == 0 else m["p2_name"],
            "p1_energy": game.players[0].energy,
            "p2_energy": game.players[1].energy,
            "winner_name": winner["winner_name"],
        })
    return flask.jsonify(matches)
    """Check if either player in a match has disconnected. Returns the pid of the disconnected player, or None."""
    now = time.time()
    for key in ("p1_pid", "p2_pid"):
        pid = match[key]
        last = LAST_HEARTBEAT.get(pid)
        if last is not None and (now - last) > HEARTBEAT_TIMEOUT:
            return pid
    return None


@app.route("/match_status")
def match_status():
    """Return current game state for the match — used for polling."""
    match = _get_match()
    if not match:
        return flask.jsonify({"ok": False, "error": "no match"}), 404
    game = match["game"]
    idx = match["turn_idx"]
    deadline = match.get("turn_deadline", 0)
    now = time.time()

    # Auto-switch turn if deadline passed
    if deadline > 0 and now >= deadline and game.winner_index() is None:
        match["turn_idx"] = 1 - idx
        match["turn_deadline"] = now + TURN_TIMEOUT
        idx = match["turn_idx"]
        _bump_epoch()

    p1 = match["p1_name"]
    p2 = match["p2_name"]
    turn_name = p1 if idx == 0 else p2
    winner = _winner_payload(game)
    time_remaining = max(0, int(deadline - now))

    # Check for disconnection
    disconnected = _check_match_disconnect(match)
    disconnected_name = None
    if disconnected:
        if disconnected == match["p1_pid"]:
            disconnected_name = match["p1_name"]
        elif disconnected == match["p2_pid"]:
            disconnected_name = match["p2_name"]

    return flask.jsonify({
        "ok": True,
        "turn_idx": idx,
        "turn_name": turn_name,
        "time_remaining": time_remaining,
        "disconnected": disconnected_name,
        "winner": winner["winner"],
        "winner_name": winner["winner_name"],
        "p1_energy": game.players[0].energy,
        "p2_energy": game.players[1].energy,
        "epoch": _current_epoch(),
        "your_turn": False,  # client determines this
    })


@app.route("/rematch", methods=["POST"])
def rematch():
    """Reset the current match for a rematch."""
    match = _get_match()
    if not match:
        return flask.jsonify({"ok": False, "error": "no match"}), 404

    game = game_state.GameState()
    p1_rgb = _hex_to_rgb("#ff0000")
    p2_rgb = _hex_to_rgb("#2266ff")
    if p1_rgb:
        game.players[game_state.PLAYER_1].color = p1_rgb
    if p2_rgb:
        game.players[game_state.PLAYER_2].color = p2_rgb
    match["game"] = game
    match["turn_idx"] = game_state.PLAYER_1
    match["turn_deadline"] = time.time() + TURN_TIMEOUT
    app.config["TURN_PLACED"] = {}
    _reset_fib_progression()
    _bump_epoch()
    return flask.jsonify({"ok": True})


@app.route("/player_energy")
def player_energy():
    match = _get_match()
    if match:
        return _energy_html(match["game"], match["p1_name"], match["p2_name"])
    return _energy_html(_get_game())


@app.route("/game_state")
def get_game_state():
    """Return the current game board as HTML."""
    match = _get_match()
    if match:
        return match["game"].board_to_html(current_player_index=match["turn_idx"])
    return _get_game().board_to_html(current_player_index=0)


@app.route("/end_turn", methods=["POST"])
def end_turn():
    match = _get_match()
    if match:
        game = match["game"]
        idx = match["turn_idx"]
        before = _board_visual_snapshot(game, idx) if flask.request.args.get("json") == "1" else None

        if game.winner_index() is not None:
            app.config["FIB_REMAINING"] = 0
            if before:
                return _board_patch_json(game, idx, before, 0)
            return game.board_to_html(current_player_index=idx, fib_remaining=0)

        prev = app.config["FIB_PREV"]
        curr = app.config["FIB_CURR"]
        app.config["FIB_PREV"] = curr
        app.config["FIB_CURR"] = prev + curr
        remaining = curr - 1
        app.config["FIB_REMAINING"] = remaining
        game.update()
        if game.winner_index() is not None:
            remaining = 0
            app.config["FIB_REMAINING"] = 0

        # Switch turn
        match["turn_idx"] = 1 - idx
        match["turn_deadline"] = time.time() + TURN_TIMEOUT
        _bump_epoch()

        # Log for replay
        mid = flask.session.get("match_id")
        if mid and mid in MATCH_LOGS:
            MATCH_LOGS[mid].append({"type": "end_turn", "player_idx": idx, "timestamp": time.time()})
            if game.winner_index() is not None:
                MATCH_LOGS[mid].append({"type": "winner", "winner_idx": game.winner_index(), "timestamp": time.time()})

        if before:
            return _board_patch_json(game, idx, before, remaining)
        return game.board_to_html(current_player_index=idx, fib_remaining=remaining)

    # Fallback for legacy single-game mode
    return flask.redirect("/lobby")


@app.route("/step", methods=["POST"])
def step():
    match = _get_match()
    if match:
        game = match["game"]
        idx = match["turn_idx"]
        before = _board_visual_snapshot(game, idx) if flask.request.args.get("json") == "1" else None

        if game.winner_index() is not None:
            app.config["FIB_REMAINING"] = 0
            if before:
                return _board_patch_json(game, idx, before, 0)
            return game.board_to_html(current_player_index=idx, fib_remaining=0)

        remaining = app.config.get("FIB_REMAINING", 0)
        next_remaining = 0
        if remaining > 0:
            app.config["FIB_REMAINING"] = remaining - 1
            next_remaining = remaining - 1
        game.update()
        if game.winner_index() is not None:
            next_remaining = 0
            app.config["FIB_REMAINING"] = 0

        if before:
            return _board_patch_json(game, idx, before, next_remaining)
        return game.board_to_html(current_player_index=idx, fib_remaining=next_remaining)

    return flask.redirect("/lobby")


@app.route("/update_cell", methods=["POST"])
def update_cell():
    x = flask.request.args.get("x", type=int)
    y = flask.request.args.get("y", type=int)
    if x is None or y is None:
        return flask.jsonify({"ok": False, "error": "missing coords"}), 400

    match = _get_match()
    if match:
        game = match["game"]
        pid = flask.session.get("_pid")
        idx = match["turn_idx"]
        player_obj = game.players[idx]

        # Verify it's this player's turn
        my_idx = 0 if match["p1_pid"] == pid else (1 if match["p2_pid"] == pid else -1)
        if my_idx != idx:
            return flask.jsonify({"ok": False, "error": "not your turn"}), 403

        if game.winner_index() is None:
            cell = game.board[x][y]
            cost = game.energy_cost_for_player(x, y, player_obj)
            if game.can_toggle_for_player(x, y, player_obj):
                if cell.owner is None:
                    if player_obj.energy >= cost:
                        player_obj.energy -= cost
                        cell.owner = player_obj
                        cell.alive = True
                        game._claim_neighbors(x, y, player_obj)
                elif cell.owner == player_obj and player_obj.energy >= cost:
                    player_obj.energy -= cost
                    cell.alive = not cell.alive

            # Track placed cells for undo
            key = (x, y)
            placed = app.config.get("TURN_PLACED", {})
            if key not in placed:
                placed[key] = {"prev_alive": cell.alive, "cost": cost}
                app.config["TURN_PLACED"] = placed

            # Log the move for replay
            mid = flask.session.get("match_id")
            if mid and mid in MATCH_LOGS:
                action = "claim" if cell.owner is not None and cell.alive else ("toggle-on" if cell.alive else "toggle-off")
                MATCH_LOGS[mid].append({
                    "type": "cell", "x": x, "y": y,
                    "player_idx": idx, "action": action,
                    "cost": cost, "timestamp": time.time(),
                })

        return _cell_json(game, x, y, idx)

    return flask.jsonify({"ok": False, "error": "no match"}), 404


@app.route("/undo_cell", methods=["POST"])
def undo_cell():
    x = flask.request.args.get("x", type=int)
    y = flask.request.args.get("y", type=int)
    if x is None or y is None:
        return flask.jsonify({"ok": False}), 400

    match = _get_match()
    if match:
        game = match["game"]
        idx = match["turn_idx"]
        placed = app.config.get("TURN_PLACED", {})
        key = (x, y)
        if key in placed:
            entry = placed[key]
            cell = game.board[x][y]
            player_obj = game.players[idx]
            player_obj.energy += entry["cost"]
            cell.alive = entry["prev_alive"]
            if entry["prev_alive"] is False and cell.owner is not None:
                cell.owner = None
            del placed[key]
            app.config["TURN_PLACED"] = placed
        return _cell_json(game, x, y, idx)
    return flask.jsonify({"ok": False}), 404


@app.route("/reset", methods=["POST"])
def reset():
    """Reset the game for both players in the match."""
    match = _get_match()
    if match:
        game = game_state.GameState()
        # Preserve colors
        p1_rgb = _hex_to_rgb(flask.session.get("player_color", "#ff0000"))
        p2_rgb = _hex_to_rgb("#2266ff")
        if p1_rgb:
            game.players[game_state.PLAYER_1].color = p1_rgb
        if p2_rgb:
            game.players[game_state.PLAYER_2].color = p2_rgb
        match["game"] = game
        match["turn_idx"] = game_state.PLAYER_1
        app.config["TURN_PLACED"] = {}
        _reset_fib_progression()
        return game.board_to_html(current_player_index=0)
    return flask.redirect("/lobby")


@app.route("/match_log/<match_id>")
def get_match_log(match_id):
    """Return the full move log for a match."""
    log = MATCH_LOGS.get(match_id, [])
    match = ACTIVE_MATCHES.get(match_id)
    if match:
        return flask.jsonify({"ok": True, "p1_name": match["p1_name"], "p2_name": match["p2_name"], "log": log})
    return flask.jsonify({"ok": False, "error": "match not found"}), 404


@app.route("/replay/<match_id>")
def replay(match_id):
    """Render a replay page for a match."""
    match = ACTIVE_MATCHES.get(match_id)
    if not match:
        return flask.redirect("/lobby")
    return flask.render_template(
        "replay.html", match_id=match_id,
        p1_name=match["p1_name"], p2_name=match["p2_name"],
        log_length=len(MATCH_LOGS.get(match_id, [])),
    )


@app.route("/replay_board/<match_id>/<int:step>")
def replay_board(match_id, step):
    """Return the board state at a given step index as HTML."""
    match = ACTIVE_MATCHES.get(match_id)
    if not match:
        return flask.jsonify({"ok": False}), 404
    log = MATCH_LOGS.get(match_id, [])
    if step < 0 or step > len(log):
        return flask.jsonify({"ok": False}), 400
    game = game_state.GameState()
    for entry in log[:step]:
        if entry["type"] == "cell":
            x, y = entry["x"], entry["y"]
            cell = game.board[x][y]
            player_obj = game.players[entry["player_idx"]]
            if entry["action"] == "claim":
                player_obj.energy -= entry.get("cost", 0)
                cell.owner = player_obj
                cell.alive = True
                game._claim_neighbors(x, y, player_obj)
            elif entry["action"] == "toggle-on":
                cell.owner = player_obj
                cell.alive = True
            elif entry["action"] == "toggle-off":
                cell.alive = False
        elif entry["type"] == "end_turn":
            game.update()
    return game.board_to_html(current_player_index=None)


@app.route("/log_error", methods=["POST"])
def log_error():
    data = flask.request.get_json(silent=True) or {}
    level = data.get("level", "unknown")
    msg = data.get("message", "")
    stack = data.get("stack", "")
    log = logger.warning if level == "warning" else logger.error
    log(f"JS {level}: {msg}")
    if stack:
        log(f"Stack:\n{stack}")
    return ("", 204)


# ─── Test routes ─────────────────────────────────────────────────────

@app.route("/__test__/seed_scenario", methods=["POST"])
def seed_scenario():
    if not _test_routes_enabled():
        return flask.jsonify({"ok": False, "error": "test routes disabled"}), 403
    name = flask.request.args.get("name", "territory_collision")
    if name == "territory_collision":
        game = _build_territory_collision_scenario()
    else:
        game = game_state.GameState()
    _set_game(game)
    _apply_session_options_to_game()
    _reset_fib_progression()
    return flask.jsonify({"ok": True, "scenario": name})


def _build_territory_collision_scenario() -> game_state.GameState:
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


def _apply_session_options_to_game():
    pass  # Colors handled via match setup


if __name__ == "__main__":
    main()
