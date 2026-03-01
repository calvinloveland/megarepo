"""Mancala environment where opponent moves are random."""

import random

from .mancala_env import MancalaEnv


class MancalaRandomEnv(MancalaEnv):
    """Mancala environment with random-opponent policy."""

    def step(self, action):
        """Apply player move then random opponent responses until turn returns."""
        if int(self.board.player2_turn) == self.player:
            self.board.execute_turn(action)
        while int(self.board.player2_turn) != self.player and not self.board.game_over:
            move = random.randint(0, 5)
            for _ in range(7):
                if self.board.marbles[1 - self.player][move] != 0:
                    break
                move = (move + 1) % 6
            self.board.execute_turn(move)
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}
