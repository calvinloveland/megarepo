from __future__ import annotations

from hashlib import sha256
from urllib.parse import quote


def _lookup(card, key: str, default=None):
    if isinstance(card, dict):
        return card.get(key, default)
    value = getattr(card, key, default)
    if hasattr(value, "value"):
        return value.value
    return value


def normalize_card(card, fallback_kind: str = "unit") -> dict[str, object]:
    keywords = tuple(_lookup(card, "keywords", ()) or ())
    kind = str(_lookup(card, "kind", fallback_kind) or fallback_kind)
    hp = int(_lookup(card, "max_hp", _lookup(card, "hp", 0)) or 0)
    current_hp = int(_lookup(card, "current_hp", hp) or hp)
    return {
        "card_id": str(_lookup(card, "card_id", _lookup(card, "instance_id", "card"))),
        "name": str(_lookup(card, "name", "Unknown Card")),
        "owner_id": str(_lookup(card, "owner_id", "")),
        "kind": kind,
        "theme": str(_lookup(card, "theme", "")),
        "attack": int(_lookup(card, "attack", 0) or 0),
        "hp": hp,
        "current_hp": current_hp,
        "cpc": _lookup(card, "cpc"),
        "income": _lookup(card, "income"),
        "speed": _lookup(card, "speed"),
        "attack_range": _lookup(card, "attack_range"),
        "track": _lookup(card, "track"),
        "position": _lookup(card, "position"),
        "stationary": bool(_lookup(card, "stationary", False)),
        "engaged": bool(_lookup(card, "engaged", False)),
        "keywords": keywords,
        "ability_summary": str(_lookup(card, "ability_summary", "No scripted ability.")),
    }


def _color_triplet(seed: str, offset: int) -> tuple[int, int, int]:
    return (
        int(seed[offset : offset + 2], 16),
        int(seed[offset + 2 : offset + 4], 16),
        int(seed[offset + 4 : offset + 6], 16),
    )


def _rgb(value: tuple[int, int, int], alpha: float = 1.0) -> str:
    return f"rgba({value[0]}, {value[1]}, {value[2]}, {alpha})"


def _icon_svg(card: dict[str, object], accent: str) -> str:
    keywords = set(card["keywords"])
    kind = card["kind"]
    if kind == "base" or "Defender" in keywords:
        return (
            f'<path d="M112 44 174 72 166 152 112 194 58 152 50 72Z" fill="none" stroke="{accent}" '
            'stroke-width="10" stroke-linejoin="round"/>'
        )
    if "Flying" in keywords:
        return (
            f'<path d="M48 132c30-54 84-88 128-88-18 20-28 42-30 68 20 8 36 20 48 38-54-2-104-8-146-18Z" '
            f'fill="none" stroke="{accent}" stroke-width="10" stroke-linejoin="round"/>'
        )
    if "Healing" in keywords:
        return (
            f'<path d="M112 58v108M58 112h108" stroke="{accent}" stroke-width="16" stroke-linecap="round"/>'
        )
    if "Ranged" in keywords:
        return (
            f'<circle cx="112" cy="112" r="54" fill="none" stroke="{accent}" stroke-width="10"/>'
            f'<circle cx="112" cy="112" r="16" fill="{accent}"/>'
            f'<path d="M112 36v26M112 162v26M36 112h26M162 112h26" stroke="{accent}" stroke-width="10" stroke-linecap="round"/>'
        )
    return (
        f'<path d="M112 42 148 94 126 94 144 180 112 152 80 180 98 94 76 94Z" fill="none" stroke="{accent}" '
        'stroke-width="10" stroke-linejoin="round"/>'
    )


def card_art_svg(card, fallback_kind: str = "unit") -> str:
    normalized = normalize_card(card, fallback_kind)
    seed = sha256(
        "|".join(
            [
                str(normalized["card_id"]),
                str(normalized["name"]),
                str(normalized["theme"]),
                str(normalized["ability_summary"]),
                str(normalized["kind"]),
            ]
        ).encode("utf-8")
    ).hexdigest()
    base_a = _color_triplet(seed, 0)
    base_b = _color_triplet(seed, 6)
    base_c = _color_triplet(seed, 12)
    accent = _rgb(_color_triplet(seed, 18), 0.9)
    horizon = 120 + int(seed[24:26], 16) % 44
    orb_x = 54 + int(seed[26:28], 16) % 112
    orb_y = 48 + int(seed[28:30], 16) % 82
    ridge = [
        (0, 210),
        (34, 170 + int(seed[30:32], 16) % 46),
        (84, 146 + int(seed[32:34], 16) % 54),
        (126, 166 + int(seed[34:36], 16) % 38),
        (178, 138 + int(seed[36:38], 16) % 56),
        (224, 206),
    ]
    ridge_path = " ".join(f"{x},{y}" for x, y in ridge)
    spark_path = " ".join(
        f"{24 + index * 28},{56 + int(seed[38 + index * 2 : 40 + index * 2], 16) % 70}"
        for index in range(5)
    )
    return f"""
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="336" viewBox="0 0 240 336" fill="none" role="img" aria-label="{normalized['name']} artwork">
  <defs>
    <linearGradient id="bg" x1="16" y1="0" x2="224" y2="336" gradientUnits="userSpaceOnUse">
      <stop stop-color="{_rgb(base_a)}"/>
      <stop offset="0.55" stop-color="{_rgb(base_b)}"/>
      <stop offset="1" stop-color="{_rgb(base_c)}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="rgba(255,255,255,0.55)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
  </defs>
  <rect width="240" height="336" rx="26" fill="url(#bg)"/>
  <rect x="12" y="12" width="216" height="312" rx="20" fill="rgba(8,12,24,0.18)" stroke="rgba(255,255,255,0.18)" />
  <circle cx="{orb_x}" cy="{orb_y}" r="38" fill="rgba(255,255,255,0.16)"/>
  <path d="M0 {horizon}C64 {horizon - 20} 152 {horizon + 18} 240 {horizon - 8}V336H0Z" fill="rgba(10,12,24,0.22)"/>
  <polyline points="{spark_path}" stroke="rgba(255,255,255,0.22)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="{ridge_path}" fill="rgba(7,10,18,0.42)"/>
  <g transform="translate(8 0)">
    {_icon_svg(normalized, accent)}
  </g>
  <rect x="24" y="24" width="192" height="80" rx="18" fill="url(#shine)"/>
</svg>
""".strip()


def card_art_data_uri(card, fallback_kind: str = "unit") -> str:
    return "data:image/svg+xml;utf8," + quote(card_art_svg(card, fallback_kind))
