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


def test_validation_preserves_safe_base_ability_script():
    base = validate_and_balance_card(
        {
            "name": "Clock Shrine",
            "theme": "combo engine fortress",
            "attack": 3,
            "hp": 28,
            "income": 2,
            "ability_summary": "Generates extra resources.",
            "ability_script": 'if api.event == "round_start":\n    api.gain_card_points(1)',
        },
        owner_id="tester",
        prompt="clock shrine",
        kind=CardKind.BASE,
    )
    assert "gain_card_points" in base.ability_script


def test_validation_rejects_event_method_mismatch_and_nested_branches():
    base = validate_and_balance_card(
        {
            "name": "Broken Fortress",
            "theme": "bad script",
            "attack": 2,
            "hp": 24,
            "income": 2,
            "ability_summary": "Should be stripped.",
            "ability_script": (
                'if api.event == "round_start":\n'
                '    api.add_attack(1)\n'
                '    if api.event == "base_attacked":\n'
                '        api.reflect_damage(1)'
            ),
        },
        owner_id="tester",
        prompt="broken fortress",
        kind=CardKind.BASE,
    )
    assert base.ability_script == ""


def test_validation_accepts_name_aware_ability_method():
    card = validate_and_balance_card(
        {
            "name": "Letter Gremlin",
            "theme": "spelling curse",
            "attack": 2,
            "hp": 4,
            "cpc": 2,
            "speed": 1,
            "range": 0,
            "ability_summary": "Hurts enemies with lots of e's.",
            "ability_script": 'if api.event == "combat":\n    api.add_attack_per_enemy_name_char("e")',
        },
        owner_id="tester",
        prompt="letter gremlin",
        kind=CardKind.UNIT,
    )
    assert "add_attack_per_enemy_name_char" in card.ability_script


def test_validation_accepts_weird_helper_methods():
    card = validate_and_balance_card(
        {
            "name": "Swarm Oracle",
            "theme": "choir tempo beast",
            "attack": 2,
            "hp": 4,
            "cpc": 2,
            "speed": 1,
            "range": 0,
            "ability_summary": "Gets stronger from allies and time.",
            "ability_script": (
                'if api.event == "combat":\n'
                '    api.add_attack_if_enemy_name_even_length()\n'
                '    api.add_attack_per_allies_on_board()\n'
                '    api.add_attack_per_round_tier(4)'
            ),
        },
        owner_id="tester",
        prompt="swarm oracle",
        kind=CardKind.UNIT,
    )
    assert "add_attack_if_enemy_name_even_length" in card.ability_script
    assert "add_attack_per_allies_on_board" in card.ability_script
    assert "add_attack_per_round_tier" in card.ability_script
