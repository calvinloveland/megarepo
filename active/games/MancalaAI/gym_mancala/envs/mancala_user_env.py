"""Mancala environment that requests moves from stdin for player two."""

from .mancala_env import MancalaEnv


class MancalaUserEnv(MancalaEnv):
    """Interactive environment for human-vs-agent play."""

    def step(self, action):
        """Apply agent move then request human input until turn returns."""
        if not self.board.player2_turn:
            self.board.execute_turn(action)
            self.board.print_board()
        while self.board.player2_turn and not self.board.game_over:
            player_input = int(input("Input:"))
            self.board.execute_turn(player_input)
            self.board.print_board()
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}
