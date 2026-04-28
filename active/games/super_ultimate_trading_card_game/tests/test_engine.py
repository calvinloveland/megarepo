from super_ultimate_trading_card_game.bots import create_default_bots
from super_ultimate_trading_card_game.engine import run_match
from super_ultimate_trading_card_game.generation import DeterministicCardGenerator
from super_ultimate_trading_card_game.storage import load_match, save_bot_collection, save_match


def test_match_completes_with_valid_result():
    generator = DeterministicCardGenerator(seed=3)
    left, right = create_default_bots(seed=3)
    result = run_match(left, right, generator, seed=3)
    assert result.rounds_played >= 1
    assert result.reason
    assert result.generated_cards >= 0


def test_playtest_sequence_keeps_generating_owned_cards():
    generator = DeterministicCardGenerator(seed=5)
    left, right = create_default_bots(seed=5)
    first = run_match(left, right, generator, seed=5)
    second = run_match(left, right, generator, seed=6)
    assert first.generated_cards >= 0
    assert second.generated_cards >= 0
    assert len(left.profile.owned_cards) >= 6
    assert len(right.profile.owned_cards) >= 6


def test_battle_log_surfaces_ability_usage():
    generator = DeterministicCardGenerator(seed=19)
    left, right = create_default_bots(seed=19)
    result = run_match(left, right, generator, seed=19)
    log_text = "\n".join(result.event_log)
    assert "Fortify" in log_text
    assert "healed" in log_text
    assert "Income Boost" in log_text


def test_match_result_can_be_persisted(tmp_path):
    generator = DeterministicCardGenerator(seed=13)
    left, right = create_default_bots(seed=13)
    result = run_match(left, right, generator, seed=13)
    db_path = tmp_path / "sutcg.sqlite3"
    save_bot_collection(left, path=db_path)
    save_bot_collection(right, path=db_path)
    match_id = save_match(
        seed=13,
        generator="deterministic",
        left_player=left.player_id,
        right_player=right.player_id,
        result=result,
        path=db_path,
    )
    stored = load_match(match_id, path=db_path)
    assert stored is not None
    assert stored.rounds_played == result.rounds_played
    assert stored.event_log[0].startswith("=== Round 1 ===")
