"""R-pentomino: verify our GameState produces the correct GoL evolution.

The R-pentomino (from conwaylife.com) in standard B3/S23:
  .OO
  OO
  .O

Generations 0-50 population values computed by a pure B3/S23 simulator
on an 80×80 toroidal board (same size used by the game engine).
"""

from conways_game_of_war.game_state import GameState, CellState

# Expected live-cell counts for generations 0-50 (pure B3/S23, no war).
# Computed by tests/standard_gol.py with an 80×80 toroidal board.
EXPECTED_POPULATION = {
    0: 5,
    1: 6,
    2: 7,
    3: 9,
    4: 8,
    5: 9,
    6: 12,
    7: 11,
    8: 18,
    9: 11,
    10: 11,
    11: 10,
    12: 13,
    13: 16,
    14: 19,
    15: 19,
    16: 23,
    17: 25,
    18: 35,
    19: 25,
    20: 32,
    21: 27,
    22: 37,
    23: 30,
    24: 46,
    25: 39,
    26: 45,
    27: 30,
    28: 31,
    29: 29,
    30: 27,
    31: 32,
    32: 32,
    33: 39,
    34: 34,
    35: 29,
    36: 34,
    37: 31,
    38: 34,
    39: 36,
    40: 33,
    41: 31,
    42: 29,
    43: 34,
    44: 31,
    45: 42,
    46: 37,
    47: 36,
    48: 45,
    49: 48,
    50: 64,
}


def _make_board(size=80):
    """Create an empty size×size board."""
    return [[CellState() for _ in range(size)] for _ in range(size)]


def _place_r_pentomino(board, off=38):
    """Place the R-pentomino at (off, off) in the board.
    
    Shape from LifeWiki .cells file:
      . O O
      O O .
      . O .
    """
    board[off][off + 1] = CellState(alive=True)     # row 0, col 1
    board[off][off + 2] = CellState(alive=True)     # row 0, col 2
    board[off + 1][off] = CellState(alive=True)     # row 1, col 0
    board[off + 1][off + 1] = CellState(alive=True) # row 1, col 1
    board[off + 2][off + 1] = CellState(alive=True) # row 2, col 1


def test_r_pentomino_initial_5_cells():
    board = _make_board()
    _place_r_pentomino(board)
    game = GameState(board)
    alive = sum(c.alive for row in game.board for c in row)
    assert alive == 5, f"Expected 5 cells, got {alive}"


def test_r_pentomino_generations_0_to_20():
    """Verify generations 0-20 population matches pure B3/S23."""
    board = _make_board()
    _place_r_pentomino(board)
    game = GameState(board)

    for gen in range(21):
        alive = sum(c.alive for row in game.board for c in row)
        expected = EXPECTED_POPULATION[gen]
        assert alive == expected, (
            f"Generation {gen}: expected {expected} live cells, got {alive}"
        )
        if gen < 20:
            game.update()


def test_r_pentomino_generations_0_to_50():
    """Verify generations 0-50 population matches pure B3/S23."""
    board = _make_board()
    _place_r_pentomino(board)
    game = GameState(board)

    for gen in range(51):
        alive = sum(c.alive for row in game.board for c in row)
        expected = EXPECTED_POPULATION[gen]
        assert alive == expected, (
            f"Generation {gen}: expected {expected} live cells, got {alive}"
        )
        if gen < 50:
            game.update()


def test_r_pentomino_never_dies_early():
    """R-pentomino should survive at least 100 generations on a big board."""
    board = _make_board()
    _place_r_pentomino(board)
    game = GameState(board)

    for gen in range(100):
        alive = sum(c.alive for row in game.board for c in row)
        assert alive > 0, f"Pattern died at generation {gen}!"
        game.update()
