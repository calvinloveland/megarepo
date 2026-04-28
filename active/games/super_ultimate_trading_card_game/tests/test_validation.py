from super_ultimate_trading_card_game.models import CardKind
from super_ultimate_trading_card_game.validation import validate_and_balance_card


def test_unit_validation_increases_cpc_for_overpowered_cards():
    card = validate_and_balance_card(
        {
            "name": "Ridiculous Cannon",
            "theme": "glass laser",
            "attack": 8,
            "hp": 10,
            "cpc": 1,
            "speed": 3,
            "range": 2,
            "keywords": ["Charge", "Flying"],
            "role_tags": ["attacker"],
            "passive": {"type": "berserk", "magnitude": 2, "text": "Gets even madder."},
            "ability_summary": "Crushes bases.",
            "ability_script": 'if api.event == "attack_base":\n    api.add_base_damage(2)',
        },
        owner_id="tester",
        prompt="ridiculous cannon",
        kind=CardKind.UNIT,
    )
    assert card.cpc is not None
    assert card.cpc >= 6


def test_base_validation_clamps_income_and_stats():
    base = validate_and_balance_card(
        {
            "name": "Sun Fortress",
            "theme": "overpowered fortress",
            "attack": 10,
            "hp": 99,
            "income": 9,
            "keywords": ["Flying", "Ranged"],
            "passive": {"type": "income_boost", "magnitude": 3, "text": "Too much."},
        },
        owner_id="tester",
        prompt="sun fortress",
        kind=CardKind.BASE,
    )
    assert base.income <= 3
    assert base.hp <= 36
    assert base.attack <= 7


def test_validation_rejects_unsafe_ability_script():
    card = validate_and_balance_card(
        {
            "name": "Unsafe Hacker",
            "theme": "bad idea",
            "attack": 2,
            "hp": 4,
            "cpc": 2,
            "speed": 1,
            "range": 0,
            "ability_summary": "Should be stripped.",
            "ability_script": 'import os\nos.system("echo nope")',
        },
        owner_id="tester",
        prompt="unsafe",
        kind=CardKind.UNIT,
    )
    assert card.ability_script == ""
