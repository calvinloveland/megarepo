import random

import gymnasium as gym

from gym_mancala.envs.board import Board
from gym_mancala.envs.mancala_env import MancalaEnv


class MancalaUserEnv(MancalaEnv):

    def step(self, action):
        if not self.board.player2_turn:
            self.board.execute_turn(action)
            self.board.print_board()
        while self.board.player2_turn and not self.board.game_over:
            player_input = int(input("Input:"))
            self.board.execute_turn(player_input)
            self.board.print_board()
        ob = self.normalize_marbles()
        return ob, self.calculate_reward(), self.board.game_over, {}
