"""Full AI-vs-AI game test — two AIs play a complete game."""

from conways_game_of_war.game_state import (
    GameState,
    EasyAIPlayer,
    MediumAIPlayer,
    HardAIPlayer,
    PLAYER_1,
    PLAYER_2,
)


def _run_ai_game(ai1_class, ai2_class, max_ticks=500):
    """Run a game between two AIs."""
    game = GameState()
    p1 = game.players[PLAYER_1]
    p2 = game.players[PLAYER_2]

    # Create both AI instances once
    ai_p1 = ai2_class(color=p1.color, start_point=p1.start_point)
    ai_p2 = ai1_class(color=p2.color, start_point=p2.start_point)

    for tick in range(max_ticks):
        # Alternate which AI moves each tick
        if tick % 2 == 0:
            game.ai_player = ai_p1
            game.ai_player_index = PLAYER_1
        else:
            game.ai_player = ai_p2
            game.ai_player_index = PLAYER_2

        game.update()

        # Stop if both players are completely dead
        p1_alive = sum(
            1 for row in game.board for c in row
            if c.owner == p1 and c.alive
        )
        p2_alive = sum(
            1 for row in game.board for c in row
            if c.owner == p2 and c.alive
        )
        if p1_alive == 0 and p2_alive == 0:
            break
    return game, p1_alive, p2_alive


def test_easy_vs_easy_completes():
    game, _, _ = _run_ai_game(EasyAIPlayer, EasyAIPlayer, max_ticks=100)
    assert game is not None


def test_easy_vs_medium_completes():
    game, _, _ = _run_ai_game(EasyAIPlayer, MediumAIPlayer, max_ticks=100)
    assert game is not None


def test_easy_vs_hard_completes():
    game, _, _ = _run_ai_game(EasyAIPlayer, HardAIPlayer, max_ticks=100)
    assert game is not None


def test_medium_vs_hard_completes():
    game, _, _ = _run_ai_game(MediumAIPlayer, HardAIPlayer, max_ticks=100)
    assert game is not None


def test_hard_vs_hard_completes():
    game, _, _ = _run_ai_game(HardAIPlayer, HardAIPlayer, max_ticks=100)
    assert game is not None


def test_medium_vs_medium_completes():
    game, _, _ = _run_ai_game(MediumAIPlayer, MediumAIPlayer, max_ticks=100)
    assert game is not None


def test_ai_game_progresses():
    """After 20 ticks, a single AI should have expanded."""
    game = GameState()
    ai = EasyAIPlayer(
        color=game.players[PLAYER_1].color,
        start_point=game.players[PLAYER_1].start_point,
    )
    game.ai_player = ai
    game.ai_player_index = PLAYER_1
    for _ in range(20):
        game.update()
    p1_alive = sum(
        1 for row in game.board for c in row
        if c.owner == game.players[PLAYER_1] and c.alive
    )
    assert p1_alive >= 1, f"AI should have at least 1 alive cell, got {p1_alive}"


def test_ai_vs_ai_still_running_after_200_ticks():
    """Two AIs should still have some activity after 200 ticks (no crash)."""
    game, p1_alive, p2_alive = _run_ai_game(HardAIPlayer, EasyAIPlayer, max_ticks=200)
    # Game completed without crashing; at least one player should have cells
    assert p1_alive + p2_alive > 0, (
        f"Both AIs died off, P1={p1_alive}, P2={p2_alive}"
    )
