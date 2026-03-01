"""Base Gym environment for Mancala."""

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .board import Board


class MancalaEnv(gym.Env):
    """Base turn-based Mancala environment."""

    def __init__(self):
        self.board = Board()
        self.action_space = spaces.Discrete(6)
        self.observation_space = spaces.Box(low=-0.5, high=5, shape=(2, 6))
        self.player = 0

    def step(self, action):
        """Advance one turn and return Gym-style transition values."""
        self.board.execute_turn(action)
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}

    def reset(self, seed=None, options=None):
        """Reset environment state and return normalized observation."""
        super().reset(seed=seed)
        _ = options
        self.board = Board()
        obs = self.normalize_marbles()
        return obs

    def render(self, mode=None, close=None):
        """Render the board in text mode."""
        _ = (mode, close)
        self.board.print_board()

    def calculate_reward(self):
        """Compute scalar reward from score differential and game termination."""
        if self.board.game_over:
            if self.board.mancala[self.player] > self.board.mancala[1 - self.player]:
                return 1
            return -1
        return max(
            -1,
            (
                (
                    self.board.mancala[self.player]
                    - self.board.mancala[1 - self.player]
                    + (
                        (
                            sum(self.board.marbles[self.player])
                            - sum(self.board.marbles[1 - self.player])
                        )
                        * 0.8
                    )
                )
                / 48
            ),
        )

    def normalize_marbles(self):
        """Normalize board marbles into a bounded numeric observation."""
        return np.divide(np.subtract(self.board.marbles, 1.5), 3)
