import json

from pathlib import Path
from urllib.error import HTTPError

from super_ultimate_trading_card_game.generation import DeterministicCardGenerator
from super_ultimate_trading_card_game.generation import OpenRouterCardGenerator
from super_ultimate_trading_card_game.models import CardKind
from super_ultimate_trading_card_game.storage import load_owned_cards, save_card


def test_deterministic_generator_returns_valid_unit_card():
    generator = DeterministicCardGenerator(seed=7)
    card = generator.generate_card("alpha", "A flying phoenix sniper", kind=CardKind.UNIT)
    assert card.kind is CardKind.UNIT
    assert card.name
    assert card.hp > 0
    assert card.cpc is not None
    assert card.ability_script
    assert card.ability_summary


def test_deterministic_generator_returns_valid_base_card():
    generator = DeterministicCardGenerator(seed=11)
    base = generator.generate_card("alpha", "A patient garden fortress", kind=CardKind.BASE)
    assert base.kind is CardKind.BASE
    assert base.cpc is None
    assert base.income >= 1
    assert base.ability_script
    assert base.ability_summary


class FakeTransport:
    def __init__(self):
        self.calls: list[str] = []

    def post_json(self, url, headers, payload, timeout):
        self.calls.append(payload["model"])
        if payload["model"] == "broken-model":
            raise HTTPError(url, 429, "rate limited", hdrs=None, fp=None)
        return json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "name": "Live Test Flier",
                                    "theme": "sharp wind bird",
                                    "attack": 4,
                                    "hp": 4,
                                    "cpc": 4,
                                    "speed": 2,
                                    "range": 1,
                                    "keywords": ["Flying", "Ranged"],
                                    "role_tags": ["attacker"],
                                    "passive": {"type": "none", "magnitude": 0, "text": "No passive ability."},
                                    "ability_summary": "Deals bonus damage when it reaches base.",
                                    "ability_script": 'if api.event == "attack_base":\n    api.add_base_damage(1)',
                                }
                            )
                        }
                    }
                ]
            }
        )


def test_openrouter_generator_retries_candidate_models_before_fallback():
    transport = FakeTransport()
    generator = OpenRouterCardGenerator(
        api_key="test-key",
        model="broken-model",
        transport=transport,
        fallback=DeterministicCardGenerator(seed=5),
    )
    card = generator.generate_card("alpha", "A flying sniper", kind=CardKind.UNIT)
    assert generator.last_backend == "openrouter"
    assert generator.last_model == "openai/gpt-oss-20b:free"
    assert card.name == "Live Test Flier"
    assert "add_base_damage" in card.ability_script
    assert transport.calls[0] == "broken-model"


def test_generated_card_can_be_persisted(tmp_path: Path):
    generator = DeterministicCardGenerator(seed=99)
    card = generator.generate_card("persist-user", "A persistent flying medic", kind=CardKind.UNIT)
    db_path = tmp_path / "sutcg.sqlite3"
    save_card(card, path=db_path)
    owned_cards, owned_bases = load_owned_cards("persist-user", path=db_path)
    assert card.card_id in owned_cards
    assert owned_cards[card.card_id].ability_script == card.ability_script
    assert owned_bases == {}


def test_generated_base_can_be_persisted(tmp_path: Path):
    generator = DeterministicCardGenerator(seed=33)
    base = generator.generate_card("persist-user", "A clockwork combo shrine", kind=CardKind.BASE)
    db_path = tmp_path / "sutcg.sqlite3"
    save_card(base, path=db_path)
    owned_cards, owned_bases = load_owned_cards("persist-user", path=db_path)
    assert owned_cards == {}
    assert base.card_id in owned_bases
    assert owned_bases[base.card_id].ability_script == base.ability_script


def test_deterministic_generator_can_create_name_aware_ability():
    generator = DeterministicCardGenerator(seed=71)
    card = generator.generate_card(
        "alpha",
        "A weird unit that does one damage for every e in the enemy name",
        kind=CardKind.UNIT,
    )
    assert "add_attack_per_enemy_name_char" in card.ability_script
    assert '"e"' in card.ability_script
