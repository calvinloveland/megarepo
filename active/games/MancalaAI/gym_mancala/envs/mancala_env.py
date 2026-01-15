import gymnasium as gym
import numpy as np
from gymnasium import spaces

from gym_mancala.envs.board import Board


class MancalaEnv(gym.Env):

    def __init__(self):
        self.board = Board()
        self.action_space = spaces.Discrete(6)
        self.observation_space = spaces.Box(low=-0.5, high=5, shape=(2, 6))
        self.player = 0

    def step(self, action):
        self.board.execute_turn(action)
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}

    def reset(self):
        self.board = Board()
        obs = self.normalize_marbles()
        return obs

    def render(self, mode=None, close=None):
        self.board.print_board()

    def calculate_reward(self):
        if self.board.game_over:
            if self.board.mancala[self.player] > self.board.mancala[1 - self.player]:
                return 1
            else:
                return -1
        else:
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
        return np.divide(np.subtract(self.board.marbles, 1.5), 3)
