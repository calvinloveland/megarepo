import board
import random


def alpha_beta(board_arg, depth, alpha, beta, player):
    if depth == 0 or board_arg.game_over:
        if board_arg.game_over:
            if board_arg.mancala[int(player)] > board_arg.mancala[int(not player)]:
                return [500, -1]
            return [-500, -1]
        return [(board_arg.mancala[int(player)] - board_arg.mancala[int(not player)]) + (
        sum(board_arg.marbles[int(player)]) - sum(board_arg.marbles[int(not player)])), -1]
    if player == board_arg.player2_turn:
        v = [-10000, -1]
        best_score = -10000
        for i in range(6):
            new_board = board.board(board_arg, i)
            v[0] = max(v[0], alpha_beta(new_board, depth - 1, alpha, beta, player)[0])
            alpha = max(alpha, v[0])
            if v[0] > best_score:
                best_score = v[0]
                v[1] = i
            if beta <= alpha:
                break
                # if depth == 4:
                # new_board.print_board()
        return v
    else:
        v = [10000, -1]
        for i in range(6):
            new_board = board.board(board_arg, i)
            v[0] = min(v[0], alpha_beta(new_board, depth - 1, alpha, beta, player)[0])
            beta = min(beta, v[0])
            if beta <= alpha:
                break
                # if depth == 3:
                # new_board.print_board()
        return v


'''
testing_board = board.board()
testing_board.mancala = [3,5]
testing_board.marbles = [[3,9,10,11,2,3],[0,0,0,0,0,1]]
alpha_beta(testing_board,4,-1000,1000,False)
print("DING")
input()
'''

clean_board = board.board()
wins = [0, 0]
while True:
    current_board = board.board(clean_board)
    player1AI = True
    player2AI = True
    player1_level = 0
    player2_level = 0
    print('Player1 (A)I or (P)layer?')
    if 'p' in input().lower():
        player1AI = False
    else:
        print('AI level? (1-9)')
        player1_level = int(input())
    print('Player2 (A)I or (P)layer?')
    if 'p' in input().lower():
        player2AI = False
    else:
        print('AI level? (1-9)')
        player2_level = int(input())
    current_board.print_board()
    while not current_board.game_over:
        if not current_board.player2_turn:
            if player1AI:
                ab_result = alpha_beta(current_board, player1_level, -1000, 1000, False)
                current_board.execute_turn(ab_result[1])
            else:
                move = (int(input('Player1, your move?:')) - 1)
                current_board.execute_turn(move)
        else:
            if player2AI:
                ab_result = alpha_beta(current_board, player2_level, -1000, 1000, True)
                current_board.execute_turn(ab_result[1])
            else:
                move = (int(input('Player2, your move?:')) - 1)
                current_board.execute_turn(move)
        current_board.print_board()
