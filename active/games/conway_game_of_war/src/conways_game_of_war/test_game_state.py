from loguru import logger

from conways_game_of_war.game_state import (
    CellState,
    EasyAIPlayer,
    GameState,
    HardAIPlayer,
    MediumAIPlayer,
)


def string_to_board(string):
    """Convert a string to a board."""
    board = []
    for y, line in enumerate(string.split("\n")):
        for x, char in enumerate(line):
            if x == 0:
                board.append([])
            if char == "X":
                board[y].append(CellState(alive=True))
            else:
                board[y].append(CellState(alive=False))
    return board


def board_to_string(board):
    """Convert a board to a string."""
    string = ""
    for x in range(len(board)):
        for y in range(len(board[0])):
            if board[x][y].alive:
                string += "X"
            else:
                string += "0"
        string += "\n"
    return string


@logger.catch(reraise=True)
def test_game_update():
    """
    Test that a blinker works as expected.
    0 1 0
    0 1 0
    0 1 0
    should become:
    0 0 0
    1 1 1
    0 0 0
    """
    board = string_to_board("00000\n00X00\n00X00\n00X00\n00000\n00000")
    game = GameState(board)
    # Shape sanity
    assert len(game.board) == game.board_size_x or len(game.board) == game.board_size_y
    print(board_to_string(game.board))
    assert game.board[1][2].alive
    game.update()
    print(board_to_string(game.board))
    assert not game.board[1][2].alive
    game.update()
    print(board_to_string(game.board))
    assert game.board[1][2].alive


@logger.catch(reraise=True)
def test_count_friendly_neighbors():
    """Test that the count_friendly_neighbors function works as expected."""
    board = string_to_board("00000\n00X00\n00X00\n00X00\n00000\n00000")
    game = GameState(board)
    assert game.count_friendly_neighbors(0, 0, None) == 0
    assert game.count_friendly_neighbors(1, 2, None) == 1
    assert game.count_friendly_neighbors(2, 2, None) == 2
    assert game.count_friendly_neighbors(3, 2, None) == 1
    assert game.count_friendly_neighbors(4, 4, None) == 0
    assert game.count_friendly_neighbors(2, 1, None) == 3
    game.update()


@logger.catch(reraise=True)
def test_easy_ai_player():
    """Test that the EasyAIPlayer makes a move."""
    board = string_to_board("00000\n00000\n00000\n00000\n00000\n00000")
    game = GameState(board)
    game.ai_player = EasyAIPlayer(color=(0, 255, 0), start_point=(0, 0))
    game.update()
    assert any(cell.alive for row in game.board for cell in row)


@logger.catch(reraise=True)
def test_medium_ai_player():
    """Test that the MediumAIPlayer makes a move."""
    board = string_to_board("00000\n00000\n00000\n00000\n00000\n00000")
    game = GameState(board)
    game.ai_player = MediumAIPlayer(color=(0, 255, 0), start_point=(0, 0))
    game.update()
    # Implement a more advanced strategy test here
    pass


@logger.catch(reraise=True)
def test_hard_ai_player():
    """Test that the HardAIPlayer makes a move."""
    board = string_to_board("00000\n00000\n00000\n00000\n00000\n00000")
    game = GameState(board)
    game.ai_player = HardAIPlayer(color=(0, 255, 0), start_point=(0, 0))
    game.update()
    # Implement a more advanced strategy test here
    pass
