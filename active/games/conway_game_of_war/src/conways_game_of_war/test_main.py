"""Flask route tests for match-based game."""

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

        response = self.client.post("/end_turn?json=1")
        payload = response.get_json()

        assert response.status_code == 200
        assert payload["winner"] == "p1"
        assert payload["winner_name"] == "Player 1"
        assert payload["fib_remaining"] == 0
        assert payload["cells"] == []

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
