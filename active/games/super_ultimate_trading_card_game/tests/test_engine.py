from super_ultimate_trading_card_game.bots import create_default_bots
from super_ultimate_trading_card_game.engine import run_match
from super_ultimate_trading_card_game.generation import DeterministicCardGenerator


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
