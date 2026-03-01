"""Mancala environment using a simple random/min-max-like opponent policy."""

import random

from .board import Board
from .mancala_env import MancalaEnv


class MancalaMinMaxEnv(MancalaEnv):
    """Environment variant with opponent auto-moves after each player step."""

    def step(self, action):
        """Apply player action then a fallback opponent move."""
        self.board.execute_turn(action)
        move = random.randint(0, 5)
        while self.board.marbles[1 - self.player][move] == 0:
            move = random.randint(0, 5)
        self.board.execute_turn(move)
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}

    def reset(self):
        """Reset board state for a new episode."""
        self.board = Board()
        return self.normalize_marbles()

    def render(self, mode=None, close=None):
        """Render the board in text mode."""
        _ = (mode, close)
        self.board.print_board()
