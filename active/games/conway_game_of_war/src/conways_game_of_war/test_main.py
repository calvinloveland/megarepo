"""Flask route tests for winner/victory behavior."""

from conways_game_of_war import game_state, main


class TestClientGameState:
    def setup_method(self):
        self.original_game = main.app.config["GAME"]
        self.original_fib_prev = main.app.config["FIB_PREV"]
        self.original_fib_curr = main.app.config["FIB_CURR"]
        self.original_fib_remaining = main.app.config["FIB_REMAINING"]
        self.game = game_state.GameState()
        main._set_game(self.game)
        main._reset_fib_progression()
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()
        with self.client.session_transaction() as session:
            session["player"] = "player1"

    def teardown_method(self):
        main._set_game(self.original_game)
        main.app.config["FIB_PREV"] = self.original_fib_prev
        main.app.config["FIB_CURR"] = self.original_fib_curr
        main.app.config["FIB_REMAINING"] = self.original_fib_remaining

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
