import json

from urllib.error import HTTPError

from super_ultimate_trading_card_game.generation import DeterministicCardGenerator
from super_ultimate_trading_card_game.generation import OpenRouterCardGenerator
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
    assert transport.calls[0] == "broken-model"
