import random

import gymnasium as gym

from gym_mancala.envs.board import Board
from gym_mancala.envs.mancala_env import MancalaEnv


class MancalaRandomEnv(MancalaEnv):

    def step(self, action):
        if int(self.board.player2_turn) == self.player:
            self.board.execute_turn(action)
        while int(self.board.player2_turn) != self.player and not self.board.game_over:
            move = random.randint(0, 5)
            for i in range(7):
                if self.board.marbles[1 - self.player][move] != 0:
                    break
                move = (move + 1) % 6
            self.board.execute_turn(move)
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}
