"""Unit tests for GameState.get_stats() and related helpers."""

import pytest
from conways_game_of_war.game_state import GameState, Player


@pytest.fixture
def empty_game():
    """A freshly initialised game with default 2 players."""
    gs = GameState()
    return gs


def test_get_stats_returns_expected_keys(empty_game):
    stats = empty_game.get_stats()
    assert "players" in stats
    assert "board" in stats
    assert "turn_count" in stats
    assert stats["turn_count"] == 0


def test_get_stats_board_section(empty_game):
    stats = empty_game.get_stats()
    board = stats["board"]
    assert board["size_x"] == 131
    assert board["size_y"] == 127
    assert board["total_cells"] == 131 * 127
    assert board["alive_total"] + board["dead_total"] == board["total_cells"]


def test_get_stats_two_players(empty_game):
    stats = empty_game.get_stats()
    assert len(stats["players"]) == 2


def test_get_stats_player_keys(empty_game):
    stats = empty_game.get_stats()
    for p in stats["players"]:
        assert "index" in p
        assert "color" in p
        assert "territory" in p
        assert "alive_cells" in p
        assert "immortal_cells" in p
        assert "energy" in p
        assert "frontier_cells" in p
        assert "eliminated" in p


def test_get_stats_eliminated_flag(empty_game):
    """A player with zero non-immortal cells should be marked eliminated."""
    gs = empty_game
    gs.turn_count = 10
    # Manually kill all of player 0's non-immortal cells
    p0_obj = gs.players[0]
    for row in gs.board:
        for cell in row:
            if cell.owner is p0_obj and not cell.immortal:
                cell.alive = False

    stats = gs.get_stats()
    p0 = stats["players"][0]
    assert p0["eliminated"] == (p0["alive_cells"] == 0)


def test_get_stats_energy_rounding(empty_game):
    gs = empty_game
    gs.players[0].energy = 10.555
    stats = gs.get_stats()
    assert stats["players"][0]["energy"] == 10.6


def test_get_stats_immortal_count(empty_game):
    gs = empty_game
    # Count immortal cells owned by player 0
    p0_obj = gs.players[0]
    immortal_count = 0
    for row in gs.board:
        for cell in row:
            if cell.immortal and cell.owner is p0_obj:
                immortal_count += 1

    stats = gs.get_stats()
    assert stats["players"][0]["immortal_cells"] == immortal_count


def test_get_stats_frontier_symmetry(empty_game):
    """Both fresh players should have roughly similar frontier sizes."""
    gs = empty_game
    stats = gs.get_stats()
    f0 = stats["players"][0]["frontier_cells"]
    f1 = stats["players"][1]["frontier_cells"]
    # On a symmetric board both frontiers should be close
    assert abs(f0 - f1) <= 2


def test_get_stats_alive_plus_dead_equals_total(empty_game):
    """Every cell is either alive or dead; total should match."""
    gs = empty_game
    stats = gs.get_stats()
    board = stats["board"]
    assert board["alive_total"] + board["dead_total"] == board["total_cells"]


def test_get_stats_turn_count_increments(empty_game):
    gs = empty_game
    gs.turn_count = 42
    assert gs.get_stats()["turn_count"] == 42
