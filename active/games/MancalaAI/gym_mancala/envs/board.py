import copy

import numpy as np


class Board:

    def __init__(self, board=None, move=None):
        if board is not None:
            self.mancala = copy.deepcopy(board.mancala)
            self.marbles = copy.deepcopy(board.marbles)
            self.player2_turn = copy.deepcopy(board.player2_turn)
            self.game_over = copy.deepcopy(board.game_over)
            self.invalid_move = copy.deepcopy(board.invalid_move)
            if move is not None:
                self.execute_turn(move)
        else:
            self.mancala = np.array([0, 0])
            self.marbles = np.array([[4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]])
            self.player2_turn = False
            self.game_over = False
            self.invalid_move = ""

    def execute_turn(self, n):
        if self.game_over:
            self.player2_turn = not self.player2_turn
            return
        # Initialize variables:
        current_side = self.player2_turn
        current_space = n + 1
        moving_marbles = self.marbles[int(self.player2_turn)][n]
        switch_turns = True

        # pickup marbles
        self.marbles[int(self.player2_turn)][n] = 0

        # don't select empty spaces
        if moving_marbles == 0:
            self.invalid_move = (
                "Player " + str(int(self.player2_turn) + 1) + " made an invalid move"
            )
            # self.game_over = True
            self.mancala[int(self.player2_turn)] += -10
            # self.player2_turn = not self.player2_turn
            # return

        # start placing
        while moving_marbles != 0:
            if current_space > 5:
                self.mancala[int(current_side)] += 1
                current_space = 0
                current_side = not current_side
                if moving_marbles == 1:
                    switch_turns = False
            else:
                self.marbles[int(current_side)][current_space] += 1
                current_space += 1
            moving_marbles -= 1

        current_space -= 1
        # stealing marbles by ending on an empty space
        if (
            current_space < 6
            and current_space >= 0
            and self.marbles[int(current_side)][current_space] == 1
            and current_side == self.player2_turn
            and self.marbles[int(not current_side)][5 - current_space] > 0
        ):
            self.mancala[int(current_side)] += (
                self.marbles[int(not current_side)][5 - current_space] + 1
            )
            self.marbles[int(not current_side)][5 - current_space] = 0
            self.marbles[int(current_side)][current_space] = 0

        # End of game?
        if sum(self.marbles[0]) == 0:
            self.game_over = True
            self.mancala[1] += sum(self.marbles[1])
        elif sum(self.marbles[1]) == 0:
            self.game_over = True
            self.mancala[0] += sum(self.marbles[0])

        # Switch if necessary
        if switch_turns:
            self.player2_turn = not self.player2_turn

    def print_board(self):
        print(self.invalid_move)
        print(str(int(self.player2_turn) + 1))
        print(str(self.mancala[0]) + "<-" + str(list(reversed(self.marbles[0]))) + "<-")
        print(" ->" + str(self.marbles[1]) + "->" + str(self.mancala[1]))
        if self.game_over:
            print("GAME OVER")
            print("PLAYER " + str(int(self.mancala[0] < self.mancala[1]) + 1) + " WINS")

    def get_current_player_score(self):
        return self.mancala[int(self.player2_turn)]
