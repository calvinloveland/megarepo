from super_ultimate_trading_card_game.generation import DeterministicCardGenerator
from super_ultimate_trading_card_game.models import CardKind


def test_deterministic_generator_returns_valid_unit_card():
    generator = DeterministicCardGenerator(seed=7)
    card = generator.generate_card("alpha", "A flying phoenix sniper", kind=CardKind.UNIT)
    assert card.kind is CardKind.UNIT
    assert card.name
    assert card.hp > 0
    assert card.cpc is not None


def test_deterministic_generator_returns_valid_base_card():
    generator = DeterministicCardGenerator(seed=11)
    base = generator.generate_card("alpha", "A patient garden fortress", kind=CardKind.BASE)
    assert base.kind is CardKind.BASE
    assert base.cpc is None
    assert base.income >= 1
