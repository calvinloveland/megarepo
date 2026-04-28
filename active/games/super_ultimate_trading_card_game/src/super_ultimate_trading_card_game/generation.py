from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Any, Protocol
from urllib import request

from .models import CardDefinition, CardKind
from .validation import validate_and_balance_card

DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-20b:free"
DEFAULT_OPENROUTER_MODEL_CANDIDATES = (
    "openai/gpt-oss-20b:free",
    "google/gemma-3-27b-it:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
)


class ChatTransport(Protocol):
    def post_json(self, url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> str:
        ...


class UrllibChatTransport:
    def post_json(self, url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> str:
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(url, data=data, method="POST")
        for key, value in headers.items():
            req.add_header(key, value)
        with request.urlopen(req, timeout=timeout) as response:
            return response.read().decode("utf-8")


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    raw_text = raw_text.strip()
    if not raw_text:
        return None
    try:
        data = json.loads(raw_text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(raw_text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def load_openrouter_api_key(path: str | Path | None = None) -> str | None:
    key_path = Path(path or "~/.openrouter_free_key").expanduser()
    if not key_path.exists():
        return None
    value = key_path.read_text(encoding="utf-8").strip()
    return value or None


class CardGenerator:
    def generate_card(self, owner_id: str, prompt: str, *, kind: CardKind) -> CardDefinition:
        raise NotImplementedError


class DeterministicCardGenerator(CardGenerator):
    """Offline generator used for tests and fallback behavior."""

    def __init__(self, seed: int = 0):
        self._seed = seed
        self.last_backend = "deterministic"

    def generate_card(self, owner_id: str, prompt: str, *, kind: CardKind) -> CardDefinition:
        seed_value = hash((self._seed, owner_id, prompt, kind.value)) & 0xFFFFFFFF
        rng = random.Random(seed_value)
        tokens = [token for token in prompt.lower().replace("-", " ").split() if token]
        focus = tokens[-1] if tokens else "mystery"
        adjective = rng.choice(["glimmering", "stubborn", "feral", "clockwork", "solar", "stormbound"])
        noun = rng.choice(["guardian", "raider", "beast", "angel", "medic", "corsair", "engine"])
        role_tags: list[str] = []
        keywords: list[str] = []
        passive_type = "none"
        passive_text = "No passive ability."
        passive_magnitude = 0
        ability_summary = "No scripted ability."
        ability_script = ""
        attack = 2 + rng.randint(0, 3)
        hp = 3 + rng.randint(0, 4)
        speed = 1 + (1 if "fast" in tokens or "charge" in tokens else 0)
        attack_range = 0

        if kind is CardKind.BASE:
            attack = 2 + rng.randint(0, 2)
            hp = 24 + rng.randint(0, 10)
            income = 2 + rng.randint(0, 1)
            base_keywords: list[str] = []
            base_role_tags: list[str] = ["support"]
            summary_parts: list[str] = []
            round_start_lines: list[str] = []
            base_attacked_lines: list[str] = []
            if any(word in tokens for word in ("heal", "garden", "living", "restore")):
                round_start_lines.append("api.heal_base(2)")
                summary_parts.append("heals itself each round")
            if any(word in tokens for word in ("clockwork", "engine", "combo", "fuel", "creative", "shrine")):
                round_start_lines.append("api.gain_card_points(1)")
                summary_parts.append("generates extra card points each round")
                base_role_tags.append("economy")
            if any(word in tokens for word in ("protect", "fortress", "shield", "wall", "patient")):
                base_attacked_lines.append("api.reduce_incoming_damage(2)")
                summary_parts.append("reduces incoming base damage when attacked")
                base_role_tags.append("defender")
            if any(word in tokens for word in ("blazing", "war", "attack", "assault", "citadel")):
                base_attacked_lines.append("api.add_attack(2)")
                summary_parts.append("counterattacks harder when struck")
                base_role_tags.append("attacker")
            if any(word in tokens for word in ("thorn", "spike", "mirror", "vengeful", "retaliation")):
                base_attacked_lines.append("api.reflect_damage(2)")
                summary_parts.append("reflects damage back to attackers")
                base_role_tags.append("defender")
            if not round_start_lines and not base_attacked_lines:
                round_start_lines.extend(["api.heal_ally(1)", "api.heal_base(1)"])
                summary_parts.append("bolsters itself and its defenders each round")
            script_lines: list[str] = []
            if round_start_lines:
                script_lines.append('if api.event == "round_start":')
                script_lines.extend(f"    {line}" for line in round_start_lines)
            if base_attacked_lines:
                script_lines.append('if api.event == "base_attacked":')
                script_lines.extend(f"    {line}" for line in base_attacked_lines)
            ability_summary = ", ".join(summary_parts).capitalize() + "."
            ability_script = "\n".join(script_lines)
            payload = {
                "name": f"{adjective.title()} {focus.title()} {noun.title()}",
                "theme": f"{adjective} {focus} {noun}",
                "attack": attack,
                "hp": hp,
                "income": income,
                "keywords": sorted(set(base_keywords)),
                "role_tags": sorted(set(base_role_tags)),
                "passive": {
                    "type": passive_type,
                    "magnitude": passive_magnitude,
                    "text": passive_text,
                },
                "ability_summary": ability_summary,
                "ability_script": ability_script,
            }
            return validate_and_balance_card(payload, owner_id=owner_id, prompt=prompt, kind=kind)

        if any(word in tokens for word in ("thorn", "thorns", "bramble", "spike", "spiked")):
            role_tags.append("defender")
            keywords.append("Defender")
            ability_summary = "Reflects damage back at attackers in combat."
            ability_script = 'if api.event == "combat":\n    api.reflect_damage(1)'
            hp += 3
            attack = max(1, attack - 1)
        elif any(word in tokens for word in ("medic", "repair", "mend", "mender")):
            role_tags.append("support")
            keywords.append("Healing")
            ability_summary = "Repairs wounded allies at the start of each round."
            ability_script = 'if api.event == "round_start":\n    api.heal_ally(2)'
            attack = max(1, attack - 1)
        elif any(word in tokens for word in ("heal", "restore", "angel", "sanctuary")):
            role_tags.append("support")
            keywords.append("Healing")
            ability_summary = "Heals its base at the start of each round."
            ability_script = 'if api.event == "round_start":\n    api.heal_base(1)'
            attack = max(1, attack - 1)
        elif any(word in tokens for word in ("siege", "breaker", "demolish", "hammer")):
            role_tags.append("attacker")
            ability_summary = "Deals bonus damage when striking an enemy base."
            ability_script = 'if api.event == "attack_base":\n    api.add_base_damage(2)'
            attack += 1
        elif any(word in tokens for word in ("fly", "wing", "sky", "phoenix")):
            role_tags.append("attacker")
            keywords.append("Flying")
            ability_summary = "Fights harder when it enters combat."
            ability_script = 'if api.event == "combat":\n    api.add_attack(1)'
            speed += 1
        elif any(word in tokens for word in ("range", "sniper", "archer", "beam")):
            role_tags.append("ranged")
            keywords.append("Ranged")
            attack_range = 1
            ability_summary = "Adds extra pressure while firing from range."
            ability_script = 'if api.event == "combat":\n    api.add_attack(1)'
        elif any(word in tokens for word in ("economy", "gold", "engine", "forge")):
            role_tags.append("economy")
            ability_summary = "Generates extra card points each round."
            ability_script = 'if api.event == "round_start":\n    api.gain_card_points(1)'
            attack = max(1, attack - 1)
        elif any(word in tokens for word in ("defend", "wall", "shield", "guard")):
            role_tags.append("defender")
            keywords.append("Defender")
            ability_summary = "Reduces incoming combat damage."
            ability_script = 'if api.event == "combat":\n    api.reduce_incoming_damage(1)'
            hp += 3
            attack = max(1, attack - 1)
        else:
            role_tags.append("attacker")
            ability_summary = "Pushes harder in combat."
            ability_script = 'if api.event == "combat":\n    api.add_attack(1)'

        if "charge" in tokens or "blitz" in tokens:
            keywords.append("Charge")
        if "intercept" in tokens:
            keywords.append("Intercept")
            passive_type = "intercept_flying"
            passive_magnitude = 1
            passive_text = "Can catch flying enemies."

        payload: dict[str, Any] = {
            "name": f"{adjective.title()} {focus.title()} {noun.title()}",
            "theme": f"{adjective} {focus} {noun}",
            "attack": attack,
            "hp": hp,
            "keywords": sorted(set(keywords)),
            "role_tags": sorted(set(role_tags)),
            "passive": {
                "type": passive_type,
                "magnitude": passive_magnitude,
                "text": passive_text,
            },
            "ability_summary": ability_summary,
            "ability_script": ability_script,
        }
        payload["cpc"] = 2 + rng.randint(0, 3)
        payload["speed"] = max(1, min(3, speed))
        payload["range"] = attack_range

        return validate_and_balance_card(payload, owner_id=owner_id, prompt=prompt, kind=kind)


class OpenRouterCardGenerator(CardGenerator):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        endpoint: str | None = None,
        transport: ChatTransport | None = None,
        fallback: CardGenerator | None = None,
    ):
        self.api_key = api_key or load_openrouter_api_key()
        self.model = model or os.getenv("SUTCG_OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL)
        self.endpoint = endpoint or os.getenv("SUTCG_OPENROUTER_URL", DEFAULT_OPENROUTER_URL)
        self.transport = transport or UrllibChatTransport()
        self.fallback = fallback or DeterministicCardGenerator()
        self.last_backend = "uninitialized"
        self.last_model = ""
        if not self.api_key:
            raise RuntimeError("OpenRouter API key not available.")

    def generate_card(self, owner_id: str, prompt: str, *, kind: CardKind) -> CardDefinition:
        system = (
            "You design balanced JSON cards for a deterministic card game prototype. "
            "Output JSON only. Tactical keywords are optional and limited to these traits when useful: "
            "Defender, Ranged, Healing, Charge, Flying, Intercept. "
            "Special abilities should be expressed primarily through short Python scripts. "
            "Scripts may only use if api.event == supported_event and these methods: "
            "api.heal_self(n), api.heal_ally(n), api.heal_base(n), api.gain_card_points(n), "
            "api.add_attack(n), api.add_base_damage(n), api.reduce_incoming_damage(n), api.reflect_damage(n), "
            "api.log(\"text\"). "
            "Supported events are unit: round_start, combat, attack_base. "
            "Supported events are base: round_start, base_attacked. "
            "No imports, loops, variables, function definitions, or attribute access besides api.event."
        )
        if kind is CardKind.BASE:
            user = (
                "Generate a base card as JSON with fields: "
                "name, theme, hp, attack, income, keywords, role_tags, ability_summary, ability_script, "
                "passive:{type,magnitude,text}. "
                "The base starts in play, does not use CPC, and should feel creative but fair. "
                "For bases, set passive to none unless you intentionally need a simple fixed passive; prefer ability_script. "
                "Base ability_script may only react to round_start or base_attacked. "
                f"Prompt: {prompt}"
            )
        else:
            user = (
                "Generate a unit card as JSON with fields: "
                "name, theme, attack, hp, cpc, speed, range, keywords, role_tags, "
                "ability_summary, ability_script, passive:{type,magnitude,text}. "
                "For units, set passive to none unless you need intercept_flying for an Intercept unit. "
                "Make ability_script valid for the restricted sandbox API. "
                f"Prompt: {prompt}"
            )

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        referer = os.getenv("SUTCG_OPENROUTER_REFERER")
        title = os.getenv("SUTCG_OPENROUTER_TITLE", "sutcg-sim")
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-Title"] = title

        models = self._candidate_models()
        for model in models:
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "response_format": {"type": "json_object"},
                "plugins": [{"id": "response-healing"}],
                "temperature": 0.9,
                "max_tokens": 300,
                "user": owner_id,
            }
            for _ in range(2):
                try:
                    raw_body = self.transport.post_json(self.endpoint, headers, payload, timeout=30)
                    body = json.loads(raw_body)
                    content = str(body["choices"][0]["message"]["content"])
                    parsed = _extract_json_object(content)
                    if parsed is not None:
                        card = validate_and_balance_card(parsed, owner_id=owner_id, prompt=prompt, kind=kind)
                        if kind in (CardKind.UNIT, CardKind.BASE) and not card.ability_script:
                            continue
                        self.last_backend = "openrouter"
                        self.last_model = model
                        return card
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
                    continue
        self.last_backend = "fallback"
        self.last_model = ""
        return self.fallback.generate_card(owner_id, prompt, kind=kind)

    def _candidate_models(self) -> tuple[str, ...]:
        explicit = os.getenv("SUTCG_OPENROUTER_MODEL")
        if explicit:
            return (explicit,)
        ordered = [self.model]
        for model in DEFAULT_OPENROUTER_MODEL_CANDIDATES:
            if model not in ordered:
                ordered.append(model)
        return tuple(ordered)


def get_generator(generator_name: str, *, seed: int = 0) -> CardGenerator:
    normalized = generator_name.lower()
    deterministic = DeterministicCardGenerator(seed=seed)
    if normalized == "deterministic":
        return deterministic
    if normalized == "openrouter":
        return OpenRouterCardGenerator(fallback=deterministic)
    if normalized == "auto":
        api_key = load_openrouter_api_key()
        if api_key:
            return OpenRouterCardGenerator(api_key=api_key, fallback=deterministic)
        return deterministic
    raise ValueError(f"Unknown generator mode: {generator_name}")
