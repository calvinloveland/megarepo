from __future__ import annotations

import hashlib
import math
import re
from typing import Any

from .models import CardDefinition, CardKind, KEYWORDS, PASSIVE_TYPES, PassiveAbility, ROLE_TAGS

MAX_UNIT_HP = 12
MAX_UNIT_ATTACK = 8
MAX_UNIT_CPC = 9
MAX_UNIT_SPEED = 3
MAX_UNIT_RANGE = 2

MAX_BASE_HP = 36
MAX_BASE_ATTACK = 7
MAX_BASE_INCOME = 3

KEYWORD_WEIGHTS = {
    "Defender": 2,
    "Ranged": 2,
    "Healing": 1,
    "Charge": 3,
    "Flying": 3,
    "Intercept": 2,
}

PASSIVE_WEIGHTS = {
    "none": 0,
    "income_boost": 3,
    "heal_base": 3,
    "heal_self": 2,
    "fortify": 3,
    "berserk": 2,
    "intercept_flying": 2,
}


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "card"


def _normalize_keywords(raw_keywords: Any) -> tuple[str, ...]:
    normalized: list[str] = []
    for raw in raw_keywords or []:
        if not isinstance(raw, str):
            continue
        candidate = raw.strip().title()
        if candidate in KEYWORDS and candidate not in normalized:
            normalized.append(candidate)
    return tuple(normalized)


def _normalize_role_tags(raw_tags: Any) -> tuple[str, ...]:
    normalized: list[str] = []
    for raw in raw_tags or []:
        if not isinstance(raw, str):
            continue
        candidate = raw.strip().lower()
        if candidate in ROLE_TAGS and candidate not in normalized:
            normalized.append(candidate)
    return tuple(normalized)


def _normalize_passive(raw: Any, keywords: tuple[str, ...]) -> PassiveAbility:
    if not isinstance(raw, dict):
        raw = {}
    passive_type = str(raw.get("type", "none")).strip().lower()
    if passive_type not in PASSIVE_TYPES:
        passive_type = "none"
    magnitude = int(raw.get("magnitude", 0) or 0)
    text = str(raw.get("text", "") or "").strip()
    if passive_type == "none":
        text = text or "No passive ability."
        magnitude = 0
    elif passive_type == "intercept_flying" and "Intercept" not in keywords:
        text = text or "Can intercept flying attackers."
    else:
        text = text or passive_type.replace("_", " ")
    return PassiveAbility(type=passive_type, magnitude=max(0, min(3, magnitude)), text=text)


def _unit_budget(card_attack: int, card_hp: int, speed: int, attack_range: int, keywords: tuple[str, ...], passive: PassiveAbility) -> int:
    return (
        card_attack * 2
        + card_hp
        + speed
        + attack_range * 2
        + sum(KEYWORD_WEIGHTS.get(keyword, 0) for keyword in keywords)
        + PASSIVE_WEIGHTS.get(passive.type, 0)
        + passive.magnitude
    )


def _base_budget(card_attack: int, card_hp: int, income: int, keywords: tuple[str, ...], passive: PassiveAbility) -> int:
    return (
        card_attack * 3
        + card_hp
        + income * 6
        + sum(KEYWORD_WEIGHTS.get(keyword, 0) for keyword in keywords)
        + PASSIVE_WEIGHTS.get(passive.type, 0) * 2
        + passive.magnitude
    )


def _rebalance_unit(
    card_attack: int,
    card_hp: int,
    cpc: int,
    speed: int,
    attack_range: int,
    keywords: tuple[str, ...],
    passive: PassiveAbility,
) -> tuple[int, int, int, int, int]:
    card_attack = max(0, min(MAX_UNIT_ATTACK, card_attack))
    card_hp = max(1, min(MAX_UNIT_HP, card_hp))
    speed = max(1, min(MAX_UNIT_SPEED, speed))
    attack_range = max(0, min(MAX_UNIT_RANGE, attack_range))
    cpc = max(1, min(MAX_UNIT_CPC, cpc))

    required_cpc = max(1, math.ceil(_unit_budget(card_attack, card_hp, speed, attack_range, keywords, passive) / 5))
    cpc = max(cpc, required_cpc)
    while cpc > MAX_UNIT_CPC:
        if card_attack > 1:
            card_attack -= 1
        elif card_hp > 2:
            card_hp -= 1
        elif speed > 1:
            speed -= 1
        elif attack_range > 0:
            attack_range -= 1
        else:
            break
        required_cpc = max(1, math.ceil(_unit_budget(card_attack, card_hp, speed, attack_range, keywords, passive) / 5))
        cpc = max(1, min(MAX_UNIT_CPC, required_cpc))

    return card_attack, card_hp, cpc, speed, attack_range


def _rebalance_base(
    card_attack: int,
    card_hp: int,
    income: int,
    keywords: tuple[str, ...],
    passive: PassiveAbility,
) -> tuple[int, int, int]:
    card_attack = max(0, min(MAX_BASE_ATTACK, card_attack))
    card_hp = max(16, min(MAX_BASE_HP, card_hp))
    income = max(1, min(MAX_BASE_INCOME, income))
    while _base_budget(card_attack, card_hp, income, keywords, passive) > 58:
        if income > 2:
            income -= 1
        elif card_attack > 3:
            card_attack -= 1
        elif card_hp > 22:
            card_hp -= 2
        else:
            break
    return card_attack, card_hp, income


def validate_and_balance_card(
    raw_payload: dict[str, Any],
    *,
    owner_id: str,
    prompt: str,
    kind: CardKind,
) -> CardDefinition:
    name = str(raw_payload.get("name", "Nameless Wonder")).strip() or "Nameless Wonder"
    theme = str(raw_payload.get("theme", "mysterious prototype")).strip() or "mysterious prototype"
    keywords = _normalize_keywords(raw_payload.get("keywords"))
    role_tags = _normalize_role_tags(raw_payload.get("role_tags"))
    passive = _normalize_passive(raw_payload.get("passive"), keywords)

    if kind is CardKind.BASE:
        raw_attack = int(raw_payload.get("attack", 2) or 2)
        raw_hp = int(raw_payload.get("hp", 28) or 28)
        raw_income = int(raw_payload.get("income", 2) or 2)
        balanced_attack, balanced_hp, balanced_income = _rebalance_base(raw_attack, raw_hp, raw_income, keywords, passive)
        digest = hashlib.sha1(f"{owner_id}|base|{prompt}|{name}|{theme}".encode("utf-8")).hexdigest()[:12]
        return CardDefinition(
            card_id=f"base-{digest}-{_slugify(name)}",
            name=name,
            theme=theme,
            prompt=prompt,
            owner_id=owner_id,
            kind=CardKind.BASE,
            hp=balanced_hp,
            attack=balanced_attack,
            cpc=None,
            speed=0,
            attack_range=0,
            income=balanced_income,
            keywords=keywords,
            role_tags=role_tags,
            passive=passive,
        )

    raw_attack = int(raw_payload.get("attack", 2) or 2)
    raw_hp = int(raw_payload.get("hp", 4) or 4)
    raw_cpc = int(raw_payload.get("cpc", 2) or 2)
    raw_speed = int(raw_payload.get("speed", 1) or 1)
    raw_range = int(raw_payload.get("range", 1 if "Ranged" in keywords else 0) or 0)
    balanced_attack, balanced_hp, balanced_cpc, balanced_speed, balanced_range = _rebalance_unit(
        raw_attack,
        raw_hp,
        raw_cpc,
        raw_speed,
        raw_range,
        keywords,
        passive,
    )
    digest = hashlib.sha1(f"{owner_id}|unit|{prompt}|{name}|{theme}".encode("utf-8")).hexdigest()[:12]
    return CardDefinition(
        card_id=f"card-{digest}-{_slugify(name)}",
        name=name,
        theme=theme,
        prompt=prompt,
        owner_id=owner_id,
        kind=CardKind.UNIT,
        hp=balanced_hp,
        attack=balanced_attack,
        cpc=balanced_cpc,
        speed=balanced_speed,
        attack_range=balanced_range,
        income=0,
        keywords=keywords,
        role_tags=role_tags,
        passive=passive,
    )
