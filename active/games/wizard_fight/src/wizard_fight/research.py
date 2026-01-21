from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
import random
from typing import Any, Dict, Optional

from urllib import request

from wizard_fight.validators import validate_spell


@dataclass(frozen=True)
class SpellDesign:
    name: str
    description: str

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description}


def design_spell(prompt: str) -> SpellDesign:
    design_payload = _design_with_llm(prompt)
    name = str(design_payload.get("name") or _format_name(prompt))
    description = str(
        design_payload.get("description")
        or f"A balanced spell inspired by {prompt.lower()} with a clear downside."
    )
    return SpellDesign(name=name, description=description)


def build_spell_spec(prompt: str, design: SpellDesign) -> Dict[str, Any]:
    spec = _dsl_with_llm(prompt, design)
    spec.setdefault("name", design.name)
    spec["name"] = design.name
    spec.setdefault("emoji", _choose_emoji(prompt, spec))
    errors = validate_spell(spec)
    if errors:
        spec = _fallback_spell_spec(prompt, design)
    return spec


def research_spell(prompt: str) -> Dict[str, Any]:
    design = design_spell(prompt)
    return build_spell_spec(prompt, design)


def upgrade_spell(spec: Dict[str, Any], prompt: str) -> Dict[str, Any]:
    upgraded = {**spec}
    rng = random.Random(_seed_from_prompt(prompt + spec.get("name", "")))
    upgraded["name"] = f"{spec.get('name', 'Spell')} Mk II"
    if "emoji" in spec:
        upgraded["emoji"] = spec["emoji"]

    if "spawn_units" in spec:
        units = [dict(unit) for unit in spec["spawn_units"]]
        for unit in units:
            unit["hp"] = _clamp(unit["hp"] + rng.randint(-5, 10), 1, 120)
            unit["speed"] = round(_clamp(float(unit["speed"]) + rng.uniform(-0.5, 0.8), 0.5, 6.0), 1)
            unit["damage"] = round(_clamp(float(unit["damage"]) + rng.uniform(-1.0, 2.5), 0.5, 25.0), 1)
        upgraded["spawn_units"] = units
    if "projectiles" in spec:
        projectiles = [dict(projectile) for projectile in spec["projectiles"]]
        for projectile in projectiles:
            projectile["damage"] = round(
                _clamp(float(projectile["damage"]) + rng.uniform(-2.0, 4.0), 1.0, 30.0),
                1,
            )
            projectile["speed"] = round(
                _clamp(float(projectile["speed"]) + rng.uniform(-1.0, 2.5), 1.0, 15.0),
                1,
            )
        upgraded["projectiles"] = projectiles
    if "effects" in spec:
        effects = [dict(effect) for effect in spec["effects"]]
        for effect in effects:
            effect["magnitude"] = round(
                _clamp(float(effect["magnitude"]) + rng.uniform(-0.3, 0.7), 0.1, 5.0),
                1,
            )
            effect["duration"] = round(
                _clamp(float(effect["duration"]) + rng.uniform(-1.0, 2.0), 0.5, 10.0),
                1,
            )
        upgraded["effects"] = effects

    errors = validate_spell(upgraded)
    if errors:
        return spec
    return upgraded


def _extract_keyword(prompt: str) -> str:
    tokens = [token for token in prompt.replace("-", " ").split() if token.isalpha()]
    return tokens[0] if tokens else "arcane"


def _format_name(prompt: str) -> str:
    keyword = _extract_keyword(prompt)
    return f"{keyword.title()} Surge"


def _seed_from_prompt(prompt: str) -> int:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _choose_effect_type(prompt: str, rng: random.Random) -> str:
    lowered = prompt.lower()
    if any(word in lowered for word in ["summon", "spawn", "monkey", "golem"]):
        return "spawn_units"
    if any(word in lowered for word in ["bolt", "blast", "fire", "arrow"]):
        return "projectiles"
    if any(word in lowered for word in ["shield", "slow", "haste", "curse"]):
        return "effects"
    return rng.choice(["spawn_units", "projectiles", "effects"])


def _local_model_hint(prompt: str) -> Optional[str]:
    mode = os.getenv("WIZARD_FIGHT_LLM_MODE", "local").lower()
    if mode != "local":
        return None
    try:
        from transformers import pipeline  # type: ignore
    except Exception:
        return None

    model_name = os.getenv("WIZARD_FIGHT_LOCAL_MODEL", "sshleifer/tiny-gpt2")
    try:
        generator = pipeline(
            "text-generation",
            model=model_name,
            device=-1,
        )
        output = generator(
            f"Spell idea: {prompt}. Effect:",
            max_new_tokens=20,
            do_sample=True,
            temperature=0.9,
        )
        if not output:
            return None
        return str(output[0].get("generated_text", ""))
    except Exception:
        return None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _design_with_llm(prompt: str) -> Dict[str, Any]:
    system = (
        "You are a game balance assistant for Wizard Fight. "
        "Create a spell name and short description (1-2 sentences). "
        "Reward creativity with a small power boost, but add drawbacks if the prompt "
        "attempts instant-win or overwhelming effects. Keep it fair and readable. "
        "Return only JSON with keys: name, description."
    )
    user = f"Player prompt: {prompt}"
    response = _call_llm(system=system, user=user)
    payload = _parse_json(response)
    if payload and isinstance(payload, dict):
        return payload
    keyword = _extract_keyword(prompt)
    return {
        "name": f"{keyword.title()} Echo",
        "description": f"A creative {keyword.lower()} spell that trades power for timing and control.",
    }


def _dsl_with_llm(prompt: str, design: SpellDesign) -> Dict[str, Any]:
    system = (
        "You convert Wizard Fight spell concepts into DSL JSON. "
        "Return only JSON that matches the schema. Include a single emoji in the 'emoji' field. "
        "Keep values within limits and avoid instant-win power."
    )
    user = (
        "Prompt: {prompt}\n"
        "Name: {name}\n"
        "Description: {description}\n"
        "Output only JSON.".format(prompt=prompt, name=design.name, description=design.description)
    )
    response = _call_llm(system=system, user=user)
    payload = _parse_json(response)
    if payload and isinstance(payload, dict):
        return payload
    return _fallback_spell_spec(prompt, design)


def _call_llm(system: str, user: str) -> str:
    mode = os.getenv("WIZARD_FIGHT_LLM_MODE", "local").lower()
    if mode == "openai":
        return _call_openai(system, user)
    if mode == "local":
        return _call_local_model(system, user)
    return ""


def _call_openai(system: str, user: str) -> str:
    endpoint = os.getenv("WIZARD_FIGHT_LLM_ENDPOINT", "https://api.openai.com/v1/chat/completions")
    api_key = os.getenv("WIZARD_FIGHT_LLM_API_KEY")
    model = os.getenv("WIZARD_FIGHT_LLM_MODEL", "gpt-4o-mini")
    if not api_key:
        return ""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(endpoint, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            body = json.loads(raw)
            return str(body["choices"][0]["message"]["content"])
    except Exception:
        return ""


def _call_local_model(system: str, user: str) -> str:
    backend = os.getenv("WIZARD_FIGHT_LOCAL_BACKEND", "ollama").lower()
    if backend == "ollama":
        response = _call_ollama(system, user)
        if response:
            return response
    if backend != "transformers":
        response = _call_ollama(system, user)
        if response:
            return response

    try:
        from transformers import pipeline  # type: ignore
    except Exception:
        return ""

    model_name = os.getenv("WIZARD_FIGHT_LOCAL_MODEL", "sshleifer/tiny-gpt2")
    try:
        generator = pipeline(
            "text-generation",
            model=model_name,
            device=-1,
        )
        output = generator(
            f"{system}\n{user}\nJSON:",
            max_new_tokens=160,
            do_sample=True,
            temperature=0.8,
        )
        if not output:
            return ""
        return str(output[0].get("generated_text", ""))
    except Exception:
        return ""


def _call_ollama(system: str, user: str) -> str:
    url = os.getenv("WIZARD_FIGHT_OLLAMA_URL", "http://localhost:11434/api/generate")
    model = os.getenv("WIZARD_FIGHT_OLLAMA_MODEL", "llama3.2")
    payload = {
        "model": model,
        "prompt": f"{system}\n{user}\nJSON:",
        "stream": False,
        "options": {
            "temperature": float(os.getenv("WIZARD_FIGHT_LLM_TEMPERATURE", "0.7")),
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            body = json.loads(raw)
            return str(body.get("response", ""))
    except Exception:
        return ""


def _parse_json(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    snippet = text[start : end + 1]
    try:
        return json.loads(snippet)
    except Exception:
        return None


def _fallback_spell_spec(prompt: str, design: SpellDesign) -> Dict[str, Any]:
    seed = _seed_from_prompt(prompt)
    rng = random.Random(seed)
    school = rng.choice(["Conjuration", "Evocation", "Illusion", "Geomancy", "Aeromancy"])
    mana_cost = rng.randint(10, 40)
    cooldown = round(rng.uniform(2.0, 12.0), 1)

    spec: Dict[str, Any] = {
        "name": design.name,
        "school": school,
        "mana_cost": mana_cost,
        "cooldown": cooldown,
        "duration": 0,
        "emoji": _choose_emoji(prompt, {}),
    }

    effect_hint = _local_model_hint(prompt)
    effect_type = _choose_effect_type(effect_hint or prompt, rng)
    if effect_type == "spawn_units":
        spec["duration"] = round(rng.uniform(4.0, 12.0), 1)
        spec["spawn_units"] = [
            {
                "type": rng.choice(["flying_monkey", "arcane_sprite", "stone_golem"]),
                "hp": rng.randint(20, 80),
                "speed": round(rng.uniform(1.5, 5.5), 1),
                "damage": round(rng.uniform(3.0, 12.0), 1),
                "target": "wizard",
            }
        ]
    elif effect_type == "projectiles":
        spec["projectiles"] = [
            {
                "speed": round(rng.uniform(5.0, 12.0), 1),
                "damage": round(rng.uniform(6.0, 18.0), 1),
                "pierce": rng.randint(0, 2),
                "target": "wizard",
            }
        ]
    else:
        spec["duration"] = round(rng.uniform(4.0, 10.0), 1)
        spec["effects"] = [
            {
                "type": rng.choice(
                    ["slow", "haste", "shield", "burn", "knockback", "fog", "wind", "gravity"]
                ),
                "magnitude": round(rng.uniform(0.8, 3.5), 1),
                "duration": round(rng.uniform(3.0, 8.0), 1),
                "target": rng.choice(["self", "enemy", "area"]),
            }
        ]

    errors = validate_spell(spec)
    if errors:
        raise ValueError(f"Generated spell invalid: {errors}")
    return spec


def _choose_emoji(prompt: str, spec: Dict[str, Any]) -> str:
    lowered = prompt.lower()
    if "monkey" in lowered or "summon" in lowered or "spawn" in lowered:
        return "🐒"
    if "shield" in lowered or "barrier" in lowered:
        return "🛡️"
    if "fire" in lowered or "ember" in lowered or "burn" in lowered:
        return "🔥"
    if "ice" in lowered or "frost" in lowered:
        return "❄️"
    if "wind" in lowered or "storm" in lowered:
        return "🌪️"
    if "bolt" in lowered or "arcane" in lowered:
        return "✨"
    if spec.get("projectiles"):
        return "⚡"
    if spec.get("effects"):
        return "🌀"
    return "🔮"
