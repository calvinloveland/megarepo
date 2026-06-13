"""Flask route tests for match-based game."""

import time

from conways_game_of_war import game_state, main


class TestClientGameState:
    def setup_method(self):
        self.original_game = main.app.config["GAME"]
        self.original_fib_prev = main.app.config["FIB_PREV"]
        self.original_fib_curr = main.app.config["FIB_CURR"]
        self.original_fib_remaining = main.app.config["FIB_REMAINING"]
        self.original_queue = list(main.MATCH_QUEUE)
        self.original_matches = dict(main.ACTIVE_MATCHES)

        main.MATCH_QUEUE = []
        main.ACTIVE_MATCHES = {}

        self.game = game_state.GameState()
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()

        # Create a match
        with self.client.session_transaction() as session:
            session["_pid"] = "test-player-1"
            session["username"] = "TestP1"
            session["player_color"] = "#ff0000"

        match_id = "test-match-1"
        main.ACTIVE_MATCHES[match_id] = {
            "p1_pid": "test-player-1",
            "p2_pid": "test-player-2",
            "p1_name": "TestP1",
            "p2_name": "TestP2",
            "game": self.game,
            "turn_idx": game_state.PLAYER_1,
            "started": True,
        }
        with self.client.session_transaction() as session:
            session["match_id"] = match_id

        main._reset_fib_progression()

    def teardown_method(self):
        main._set_game(self.original_game)
        main.app.config["FIB_PREV"] = self.original_fib_prev
        main.app.config["FIB_CURR"] = self.original_fib_curr
        main.app.config["FIB_REMAINING"] = self.original_fib_remaining
        main.MATCH_QUEUE = self.original_queue
        main.ACTIVE_MATCHES = self.original_matches

    def _eliminate_player_two_territory(self):
        loser = self.game.players[game_state.PLAYER_2]
        for x in range(self.game.board_size_x):
            for y in range(self.game.board_size_y):
                cell = self.game.board[x][y]
                if cell.owner == loser and not cell.immortal:
                    cell.owner = None
                    cell.alive = False

    def test_player_energy_shows_victory_banner(self):
        self._eliminate_player_two_territory()

        response = self.client.get("/player_energy")

        assert response.status_code == 200
        assert "🏆 Player 1 wins!" in response.get_data(as_text=True)

    def test_end_turn_json_stops_when_winner_exists(self):
        self._eliminate_player_two_territory()

        # Pre-fix, /end_turn would return the board HTML with a
        # "winner" key. Post-fix (simultaneous turns), /end_turn just
        # marks the current player as ready. The world doesn't step
        # when there's already a winner. The actual winner info is
        # in /match_status, not /end_turn.
        response = self.client.post("/end_turn?json=1")
        payload = response.get_json()
        assert response.status_code == 200
        assert payload["ok"] is True
        # The match has only one player in this test, so we're not
        # "both ready" and the world does not step.
        assert payload["world_stepped"] is False
        # The winner is reported by /match_status.
        status = self.client.get("/match_status").get_json()
        assert status["winner_name"] == "Player 1"

    def test_update_cell_applies_distance_based_cost(self):
        player = self.game.players[game_state.PLAYER_1]
        player.energy = 10.0
        self.game.board[24][20].owner = player
        self.game.board[24][20].alive = False

        response = self.client.post("/update_cell?x=24&y=20&json=1")
        payload = response.get_json()

        assert response.status_code == 200
        assert payload["cost"] == 9.0
        assert self.game.board[24][20].owner == player
        assert self.game.board[24][20].alive is True
        assert player.energy == 1.0

    def test_cell_json_includes_cost_overlay_metadata(self):
        response = self.client.post("/update_cell?x=21&y=20&json=1")
        payload = response.get_json()

        assert response.status_code == 200
        assert payload["cost"] == 0.0
        assert payload["cost_label"] == ""
        assert payload["cost_bg"].startswith("rgba(")

    # ─── Matchmaking tests ────────────────────────────────────────────

    def test_join_queue_adds_player(self):
        main.MATCH_QUEUE = []
        main.ACTIVE_MATCHES = {}

        response = self.client.post("/join_queue", json={"username": "Alice", "color": "#ff0000"})
        data = response.get_json()

        assert response.status_code == 200
        assert data["matched"] is False
        assert len(main.MATCH_QUEUE) == 1
        assert main.MATCH_QUEUE[0]["username"] == "Alice"

    def test_join_queue_matches_two_players(self):
        main.MATCH_QUEUE = []
        main.ACTIVE_MATCHES = {}

        c1 = main.app.test_client()
        with c1.session_transaction() as s:
            s["_pid"] = "alice-123"
        r1 = c1.post("/join_queue", json={"username": "Alice", "color": "#ff0000"})
        d1 = r1.get_json()
        assert d1["matched"] is False

        c2 = main.app.test_client()
        with c2.session_transaction() as s:
            s["_pid"] = "bob-456"
        r2 = c2.post("/join_queue", json={"username": "Bob", "color": "#2266ff"})
        d2 = r2.get_json()
        assert d2["matched"] is True
        assert d2["player"] == 1
        assert len(main.ACTIVE_MATCHES) == 1

        match_id = d2["match_id"]
        match = main.ACTIVE_MATCHES[match_id]
        assert match["p1_name"] == "Alice"
        assert match["p2_name"] == "Bob"
        assert match["started"] is True
        # No turn counter with simultaneous turns
        assert "turn_idx" not in match

    def test_two_shared_session_joins_match_each_other(self):
        """Regression: two requests sharing a session (two tabs in the
        same browser) must still match each other.

        Before the fix, ``/join_queue`` reused ``_pid`` from the session,
        so the second tab's request removed the first tab's queue entry
        instead of being matched against it. Net effect: with two tabs
        in the same browser, only one entry ever existed in
        ``MATCH_QUEUE`` and no match was ever created.

        The client now sends a per-tab pid (stored in ``sessionStorage``
        in the browser, which is unique per tab). This test simulates
        that by passing an explicit ``pid`` for each request.
        """
        main.MATCH_QUEUE = []
        main.ACTIVE_MATCHES = {}

        # First tab (or first browser) joins
        r1 = self.client.post("/join_queue", json={
            "username": "Alice", "color": "#ff0000", "pid": "tab-1-pid",
        })
        d1 = r1.get_json()
        assert d1["matched"] is False

        # Second tab in the SAME browser (same Flask session) joins with
        # a DIFFERENT pid (mirroring the per-tab sessionStorage pid).
        r2 = self.client.post("/join_queue", json={
            "username": "Bob", "color": "#2266ff", "pid": "tab-2-pid",
        })
        d2 = r2.get_json()

        assert d2["matched"] is True, (
            f"Two requests sharing a session should match each other, "
            f"got {d2!r}. queue={main.MATCH_QUEUE!r}"
        )
        assert d2["player"] == 1
        assert len(main.ACTIVE_MATCHES) == 1

        match = next(iter(main.ACTIVE_MATCHES.values()))
        assert match["p1_pid"] == "tab-1-pid"
        assert match["p2_pid"] == "tab-2-pid"

    def test_match_poll_detects_match(self):
        main.MATCH_QUEUE = []
        main.ACTIVE_MATCHES = {}

        with self.client.session_transaction() as session:
            session["_pid"] = "poll-player"
            session["username"] = "PollP"

        match_id = "poll-match"
        main.ACTIVE_MATCHES[match_id] = {
            "p1_pid": "poll-player",
            "p2_pid": "other-player",
            "p1_name": "PollP",
            "p2_name": "Other",
            "game": game_state.GameState(),
            "turn_idx": game_state.PLAYER_1,
            "started": True,
        }

        response = self.client.get("/poll_match")
        data = response.get_json()

        assert response.status_code == 200
        assert data["matched"] is True
        assert data["match_id"] == match_id
        assert data["player"] == 0

    # ─── Simultaneous-turn tests ───────────────────────────────────────

    def test_opponent_cannot_move_on_own_territory(self):
        """Player 2 cannot toggle a cell that is owned by player 1.

        With simultaneous turns, there is no 403 "not your turn"
        response — the request simply returns 200 with the unchanged
        cell because ``can_toggle_for_player`` rejects enemy-owned
        cells.
        """
        client2 = main.app.test_client()
        with client2.session_transaction() as session:
            session["_pid"] = "test-player-2"
            session["username"] = "TestP2"
            session["match_id"] = "test-match-1"

        # Cell (21, 20) is adjacent to P1's start and owned by P1.
        response = client2.post("/update_cell?x=21&y=20&json=1")
        assert response.status_code == 200
        payload = response.get_json()
        assert payload["alive"] is False
        assert payload["owner"] == "p1"

    def test_both_players_can_move_simultaneously(self):
        """With simultaneous turns, both players can act in any order
        without waiting for an End Turn.

        Each action targets a cell that is directly adjacent to the
        player's start base (so ``count_friendly_neighbors`` is 1 from
        the immortal start cell, satisfying ``can_toggle_for_player``).
        """
        main.ACTIVE_MATCHES["test-match-1"]["p1_pid"] = "test-player-1"
        main.ACTIVE_MATCHES["test-match-1"]["p2_pid"] = "test-player-2"

        # Player 1 toggles a free cell adjacent to P1's start
        r1 = self.client.post("/update_cell?x=21&y=20&json=1")
        assert r1.status_code == 200
        assert r1.get_json()["alive"] is True
        assert r1.get_json()["owner"] == "p1"

        # Player 2 toggles a free cell adjacent to P2's start, in the
        # same "turn" (no End Turn between the two actions).
        p2 = self.game.players[game_state.PLAYER_2]
        p2x, p2y = p2.start_point
        client2 = main.app.test_client()
        with client2.session_transaction() as session:
            session["_pid"] = "test-player-2"
            session["username"] = "TestP2"
            session["match_id"] = "test-match-1"
        r2 = client2.post(f"/update_cell?x={p2x + 1}&y={p2y}&json=1")
        assert r2.status_code == 200
        payload2 = r2.get_json()
        assert payload2["alive"] is True
        assert payload2["owner"] == "p2"

    def test_end_turn_does_not_switch_turns(self):
        """End Turn now just steps the game; it does NOT switch the
        acting player. With simultaneous turns there is no turn.

        Pre-fix the server would set ``match["turn_idx"] = 1 - idx``;
        with the turn system removed, the match dict has no
        ``turn_idx`` after End Turn runs.
        """
        match = main.ACTIVE_MATCHES["test-match-1"]
        # Strip any turn_idx the setup put in (the cleanup loop in
        # setup_method didn't, but we want the test to be robust).
        match.pop("turn_idx", None)
        assert "turn_idx" not in match

        response = self.client.post("/end_turn?json=1")
        assert response.status_code == 200
        # End Turn must not introduce a new turn_idx either.
        assert "turn_idx" not in match
        # And it should not have toggled the acting player identity.
        assert "p1_pid" in match and "p2_pid" in match

    # ─── Both-players-ready semantics ─────────────────────────────────────

    def _client_for(self, pid: str):
        """Return a test client set up as the given pid with the
        match_id in its session, ready to make calls on behalf of
        that player.
        """
        client = main.app.test_client()
        with client.session_transaction() as s:
            s["_pid"] = pid
            s["username"] = f"User-{pid}"
            s["match_id"] = "test-match-1"
        return client

    def test_end_turn_requires_both_players(self):
        """One player clicking End Turn must NOT advance the world.

        The world only steps once BOTH players have indicated they're
        ready. Otherwise a fast player could race the board forward
        before the opponent has finished their moves.
        """
        main.ACTIVE_MATCHES["test-match-1"]["ready_players"] = []
        epoch_before = main._current_epoch()

        # Only P1 is ready.
        c1 = self._client_for("test-player-1")
        r1 = c1.post("/end_turn")
        body1 = r1.get_json()
        assert r1.status_code == 200
        assert body1["world_stepped"] is False
        assert body1["you_are_ready"] is True
        assert body1["ready_players"] == ["test-player-1"]
        assert body1["waiting_for"] == "test-player-2"
        # World did not step
        assert main._current_epoch() == epoch_before

    def test_end_turn_steps_world_when_both_ready(self):
        """When BOTH players have clicked End Turn, the world steps
        forward and the ready set clears for the next round.
        """
        main.ACTIVE_MATCHES["test-match-1"]["ready_players"] = []
        epoch_before = main._current_epoch()
        match = main.ACTIVE_MATCHES["test-match-1"]
        turn_count_before = match["game"].turn_count

        c1 = self._client_for("test-player-1")
        c2 = self._client_for("test-player-2")

        # First player ready.
        r1 = c1.post("/end_turn").get_json()
        assert r1["world_stepped"] is False
        # Second player ready \u2014 world steps now.
        r2 = c2.post("/end_turn").get_json()
        assert r2["world_stepped"] is True
        assert r2["you_are_ready"] is False
        assert r2["ready_players"] == []
        # Epoch advanced and turn count incremented
        assert main._current_epoch() > epoch_before
        assert match["game"].turn_count == turn_count_before + 1

        # After the step, /match_status shows both unready for the
        # next round.
        status = self.client.get("/match_status").get_json()
        assert status["p1_ready"] is False
        assert status["p2_ready"] is False
        assert status["both_ready"] is False

    def test_end_turn_is_idempotent_for_same_player(self):
        """Clicking End Turn twice as the same player doesn't
        double-step the world; the second click is a no-op for the
        ready set.
        """
        main.ACTIVE_MATCHES["test-match-1"]["ready_players"] = []
        c1 = self._client_for("test-player-1")
        c2 = self._client_for("test-player-2")

        r1a = c1.post("/end_turn").get_json()
        r1b = c1.post("/end_turn").get_json()
        # Both clicks marked P1 ready, no double-step
        assert r1a["you_are_ready"] is True
        assert r1b["you_are_ready"] is True
        assert r1a["world_stepped"] is False
        assert r1b["world_stepped"] is False
        # P1 is only in the ready set once
        assert r1b["ready_players"] == ["test-player-1"]

        # Then P2 \u2192 world steps, ready set clears
        r2 = c2.post("/end_turn").get_json()
        assert r2["world_stepped"] is True

    def test_match_status_reports_ready_state(self):
        """/match_status surfaces each player's ready state so the
        client can render a \"Waiting for opponent\" indicator.
        """
        main.ACTIVE_MATCHES["test-match-1"]["ready_players"] = []
        c1 = self._client_for("test-player-1")

        # Before anyone is ready
        status = self.client.get("/match_status").get_json()
        assert status["p1_ready"] is False
        assert status["p2_ready"] is False
        assert status["you_are_ready"] is False
        assert status["both_ready"] is False

        # P1 marks themselves ready
        c1.post("/end_turn")
        status = self.client.get("/match_status").get_json()
        # ``you_are_ready`` depends on the requesting session's pid,
        # so from the test client (which is P1) we see ready.
        assert status["p1_ready"] is True
        assert status["p2_ready"] is False
        assert status["you_are_ready"] is True
        assert status["both_ready"] is False

    # ─── Queue-time sandbox ───────────────────────────────────

    def _sandbox_client(self, pid: str):
        """Return a test client that has ``pid`` in its session and
        is in the matchmaking queue so it can access /queue.
        """
        c = main.app.test_client()
        with c.session_transaction() as s:
            s["_pid"] = pid
            s["username"] = f"Sandbox-{pid}"
        main.MATCH_QUEUE.append({"pid": pid, "username": f"Sandbox-{pid}", "color": "#ff66aa"})
        return c

    def test_queue_page_renders_sandbox(self):
        """/queue is reachable while the player is in the queue, and
        the response includes a sandbox board the player can play.
        """
        main.MATCH_QUEUE = []
        main.SANDBOX_STATES = {}
        c = self._sandbox_client("sandbox-pid-1")

        response = c.get("/queue?pid=sandbox-pid-1")
        assert response.status_code == 200
        body = response.get_data(as_text=True)
        assert "Sandbox" in body
        assert "sandbox-wrap" in body
        assert "In Queue" in body  # the banner
        assert "waiting for an opponent" in body
        # The sandbox state was created on this request
        assert "sandbox-pid-1" in main.SANDBOX_STATES
        # Start cell is owned and alive
        state = main.SANDBOX_STATES["sandbox-pid-1"]
        start = state.players[0].start_point
        assert state.board[start[0]][start[1]].alive is True
        assert state.board[start[0]][start[1]].immortal is True

    def test_queue_page_redirects_when_not_in_queue(self):
        """/queue is only for players currently in the queue or
        already in a match. Anyone else is bounced back to /lobby.
        """
        main.MATCH_QUEUE = []
        c = main.app.test_client()
        response = c.get("/queue?pid=ghost-pid", follow_redirects=False)
        assert response.status_code == 302
        assert "/lobby" in response.headers["Location"]

    def test_sandbox_update_claims_adjacent_cell(self):
        """Clicking an unowned cell adjacent to the start claims it."""
        main.MATCH_QUEUE = []
        main.SANDBOX_STATES = {}
        c = self._sandbox_client("sandbox-pid-2")
        # Pre-create the sandbox state by visiting the page
        c.get("/queue?pid=sandbox-pid-2")
        state = main.SANDBOX_STATES["sandbox-pid-2"]
        start = state.players[0].start_point
        # Cell one step to the right of start
        x, y = start[0] + 1, start[1]
        cell_before = state.board[x][y]
        assert cell_before.owner is not None  # already owned (from init)
        assert cell_before.alive is False     # but not alive

        response = c.post(f"/sandbox/update?x={x}&y={y}",
                          json={"pid": "sandbox-pid-2"})
        assert response.status_code == 200
        body = response.get_json()
        assert body["alive"] is True  # toggled to alive
        # No energy is spent in the sandbox
        assert state.players[0].energy == game_state.STARTING_ENERGY

    def test_sandbox_update_rejects_far_cell(self):
        """Clicking a cell too far from the territory is a silent no-op
        (the sandbox is free-play, so we don't return an error — we
        just return the unchanged cell).
        """
        main.MATCH_QUEUE = []
        main.SANDBOX_STATES = {}
        c = self._sandbox_client("sandbox-pid-3")
        c.get("/queue?pid=sandbox-pid-3")
        state = main.SANDBOX_STATES["sandbox-pid-3"]
        # Cell (0, 0) is far from the start at (15, 15) and unowned
        assert state.board[0][0].owner is None
        response = c.post("/sandbox/update?x=0&y=0",
                          json={"pid": "sandbox-pid-3"})
        assert response.status_code == 200
        # Cell is still unowned
        assert state.board[0][0].owner is None
        # The action hint is "none" (no action possible)
        body = response.get_json()
        assert body["action"] == "none"

    def test_sandbox_state_isolated_per_pid(self):
        """Two tabs in the same browser context (sharing a session
        cookie) each have their own sandbox state, keyed by the
        per-tab pid.
        """
        main.MATCH_QUEUE = []
        main.SANDBOX_STATES = {}

        c1 = self._sandbox_client("tab-1-pid")
        c2 = self._sandbox_client("tab-2-pid")
        c1.get("/queue?pid=tab-1-pid")
        c2.get("/queue?pid=tab-2-pid")
        assert "tab-1-pid" in main.SANDBOX_STATES
        assert "tab-2-pid" in main.SANDBOX_STATES
        # They are different GameState objects
        assert (main.SANDBOX_STATES["tab-1-pid"]
                is not main.SANDBOX_STATES["tab-2-pid"])
        # A cell claimed in tab-1's sandbox is not in tab-2's
        start = main.SANDBOX_STATES["tab-1-pid"].players[0].start_point
        x, y = start[0] + 1, start[1]
        c1.post(f"/sandbox/update?x={x}&y={y}", json={"pid": "tab-1-pid"})
        # tab-1 owns and has the cell alive
        assert main.SANDBOX_STATES["tab-1-pid"].board[x][y].alive is True
        # tab-2's board is independent; that cell is just unowned (it
        # was never claimed in tab-2's sandbox)
        # (Note: the start is at (15, 15) on both; the adjacent
        # cells of tab-2 are also unowned/alive=False initially)
        tab2_cell = main.SANDBOX_STATES["tab-2-pid"].board[x][y]
        assert tab2_cell.alive is False

    def test_sandbox_reset_returns_fresh_board(self):
        """/sandbox/reset wipes the per-pid sandbox and gives a fresh
        one on the next interaction.
        """
        main.MATCH_QUEUE = []
        main.SANDBOX_STATES = {}
        c = self._sandbox_client("sandbox-pid-4")
        c.get("/queue?pid=sandbox-pid-4")
        state = main.SANDBOX_STATES["sandbox-pid-4"]
        # Claim a cell to mutate the state
        start = state.players[0].start_point
        c.post(f"/sandbox/update?x={start[0] + 1}&y={start[1]}",
               json={"pid": "sandbox-pid-4"})
        # Old state had the cell alive
        old_state = main.SANDBOX_STATES["sandbox-pid-4"]
        assert old_state.board[start[0] + 1][start[1]].alive is True

        # Reset
        response = c.post("/sandbox/reset", json={"pid": "sandbox-pid-4"})
        assert response.status_code == 200
        # The old entry is gone, a new one was created (replaces the
        # popped one). The new state has the cell NOT alive.
        new_state = main.SANDBOX_STATES["sandbox-pid-4"]
        assert new_state is not old_state
        assert new_state.board[start[0] + 1][start[1]].alive is False

    def test_current_player_can_move_on_their_turn(self):
        # The acting player is determined by the session pid, not by a
        # turn counter. The default test client is set up as P1 (pid
        # "test-player-1"), so it can claim cells in P1's territory.
        response = self.client.post("/update_cell?x=21&y=20&json=1")
        assert response.status_code == 200
        payload = response.get_json()
        assert payload["alive"] is True
        assert payload["owner"] == "p1"

    def test_undo_works_within_match(self):
        player = self.game.players[game_state.PLAYER_1]
        # Toggle a free cell alive so neighbor becomes claimable
        self.client.post("/update_cell?x=21&y=20&json=1")
        # Claim cell at distance 2 (cost = 1)
        energy_before = player.energy
        self.client.post("/update_cell?x=22&y=20&json=1")
        energy_after_place = player.energy
        assert energy_after_place < energy_before

        response = self.client.post("/undo_cell?x=22&y=20&json=1")
        assert response.status_code == 200
        assert player.energy == energy_before

    # ─── Additional coverage ───────────────────────────────────────────

    def test_leave_queue_removes_player(self):
        main.MATCH_QUEUE = [{"pid": "test-pid", "username": "Tester", "color": "#ff0000"}]
        with self.client.session_transaction() as session:
            session["_pid"] = "test-pid"
        response = self.client.post("/leave_queue")
        assert response.status_code == 200
        assert len(main.MATCH_QUEUE) == 0

    def test_undo_cell_missing_coords(self):
        response = self.client.post("/undo_cell")
        assert response.status_code == 400

    def test_update_cell_missing_coords(self):
        response = self.client.post("/update_cell")
        assert response.status_code == 400

    def test_match_status_without_match(self):
        with self.client.session_transaction() as session:
            del session["match_id"]
        response = self.client.get("/match_status")
        assert response.status_code == 404

    def test_match_status_with_match_does_not_500(self):
        """Regression: ``_check_match_disconnect`` was orphaned (its body
        sat as dead code inside ``active_matches``) so calling
        ``/match_status`` with an active match raised NameError → 500.
        """
        main.LAST_HEARTBEAT.clear()
        match = main.ACTIVE_MATCHES["test-match-1"]
        match["p1_pid"] = "p1-with-fresh-heartbeat"
        match["p2_pid"] = "p2-with-no-heartbeat"
        main.LAST_HEARTBEAT["p1-with-fresh-heartbeat"] = time.time()

        response = self.client.get("/match_status")

        assert response.status_code == 200
        body = response.get_json()
        assert body["ok"] is True
        # p2 never sent a heartbeat, so they are not considered disconnected
        assert body["disconnected"] is None

    def test_check_match_disconnect_flags_stale_heartbeat(self):
        """Player with a heartbeat older than HEARTBEAT_TIMEOUT is reported."""
        match = main.ACTIVE_MATCHES["test-match-1"]
        match["p1_pid"] = "fresh-pid"
        match["p2_pid"] = "stale-pid"
        main.LAST_HEARTBEAT["fresh-pid"] = time.time()
        main.LAST_HEARTBEAT["stale-pid"] = time.time() - (main.HEARTBEAT_TIMEOUT + 5)

        assert main._check_match_disconnect(match) == "stale-pid"

    def test_index_redirects_to_lobby_without_match(self):
        with self.client.session_transaction() as session:
            session.pop("match_id", None)
            session.pop("_pid", None)
        response = self.client.get("/")
        assert response.status_code == 302
        assert "/lobby" in response.location

    def test_lobby_renders(self):
        response = self.client.get("/lobby")
        assert response.status_code == 200
        assert b"Find Match" in response.data

    def test_join_queue_requires_username(self):
        response = self.client.post("/join_queue", json={"color": "#ff0000"})
        assert response.status_code == 400

    def test_cell_json_includes_current_energy(self):
        response = self.client.post("/update_cell?x=21&y=20&json=1")
        payload = response.get_json()
        assert "current_energy" in payload
        assert isinstance(payload["current_energy"], (int, float))

    def test_match_poll_returns_not_matched_when_not_in_queue(self):
        with self.client.session_transaction() as session:
            session["_pid"] = "nobody"
            session.pop("match_id", None)
        response = self.client.get("/poll_match")
        data = response.get_json()
        assert data["matched"] is False

    def test_log_error_warning_level(self):
        response = self.client.post("/log_error", json={"level": "warning", "message": "test warn"})
        assert response.status_code == 204

    def test_log_error_error_level(self):
        response = self.client.post("/log_error", json={"level": "error", "message": "test error"})
        assert response.status_code == 204
