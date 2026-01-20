from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import os
import random
from typing import Any, Dict, Optional

from wizard_fight.validators import validate_spell


@dataclass(frozen=True)
class SpellDesign:
    prompt: str
    theme: str
    intended_use: str
    strengths: str
    weaknesses: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def design_spell(prompt: str) -> SpellDesign:
    keyword = _extract_keyword(prompt)
    theme = f"{keyword.title()} Studies"
    intended_use = f"Pressuring the enemy with {keyword.lower()}-themed magic."
    strengths = f"Reliable, mid-power {keyword.lower()} effects."
    weaknesses = "Limited burst and predictable timing."
    return SpellDesign(
        prompt=prompt,
        theme=theme,
        intended_use=intended_use,
        strengths=strengths,
        weaknesses=weaknesses,
    )


def build_spell_spec(design: SpellDesign) -> Dict[str, Any]:
    seed = _seed_from_prompt(design.prompt)
    rng = random.Random(seed)
    name = _format_name(design.prompt)
    school = rng.choice(["Conjuration", "Evocation", "Illusion", "Geomancy", "Aeromancy"])
    mana_cost = rng.randint(10, 40)
    cooldown = round(rng.uniform(2.0, 12.0), 1)

    spec: Dict[str, Any] = {
        "name": name,
        "school": school,
        "mana_cost": mana_cost,
        "cooldown": cooldown,
        "duration": 0,
    }

    effect_hint = _local_model_hint(design.prompt)
    effect_type = _choose_effect_type(effect_hint or design.prompt, rng)
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


def research_spell(prompt: str) -> Dict[str, Any]:
    design = design_spell(prompt)
    return build_spell_spec(design)


def upgrade_spell(spec: Dict[str, Any], prompt: str) -> Dict[str, Any]:
    upgraded = {**spec}
    rng = random.Random(_seed_from_prompt(prompt + spec.get("name", "")))
    upgraded["name"] = f"{spec.get('name', 'Spell')} Mk II"

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
