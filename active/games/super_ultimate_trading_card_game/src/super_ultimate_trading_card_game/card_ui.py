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


def _tokens(card: dict[str, object]) -> set[str]:
    raw = " ".join(
        [
            str(card["name"]),
            str(card["theme"]),
            str(card["ability_summary"]),
            " ".join(str(keyword) for keyword in card["keywords"]),
        ]
    ).replace("-", " ")
    return {token.lower().strip(".,'\"") for token in raw.split() if token}


def _seed_hex(card: dict[str, object]) -> str:
    return sha256(
        "|".join(
            [
                str(card["card_id"]),
                str(card["name"]),
                str(card["theme"]),
                str(card["ability_summary"]),
                str(card["kind"]),
            ]
        ).encode("utf-8")
    ).hexdigest()


def _pick_scene(tokens: set[str], card: dict[str, object]) -> tuple[str, str]:
    keywords = set(card["keywords"])
    kind = str(card["kind"])
    if kind == "base":
        if {"garden", "living", "heal", "vine", "bloom"} & tokens:
            return "garden", "fortress"
        if {"clockwork", "engine", "forge", "metal", "gear"} & tokens:
            return "forge", "machine_fortress"
        if {"storm", "solar", "blazing", "war", "citadel"} & tokens:
            return "storm", "fortress"
        return "ruins", "fortress"
    if "Flying" in keywords or {"bird", "hawk", "phoenix", "wing", "sky"} & tokens:
        return "sky", "bird"
    if {"angel", "halo", "saint", "seraph"} & tokens:
        return "sky", "angel"
    if {"medic", "healer", "repair", "cleric", "mender"} & tokens or "Healing" in keywords:
        return "garden", "healer"
    if {"clockwork", "gear", "engine", "artificer", "machine", "robot"} & tokens:
        return "forge", "machine"
    if {"beast", "wolf", "raider", "corsair", "dragon", "monster"} & tokens:
        return "storm", "beast"
    if {"vine", "tree", "bloom", "flower", "garden", "forest"} & tokens:
        return "garden", "plant"
    if {"archer", "sniper", "beam", "ranged"} & tokens or "Ranged" in keywords:
        return "ruins", "archer"
    if {"lancer", "knight", "charge", "spear"} & tokens or "Charge" in keywords:
        return "sunrise", "lancer"
    return "arcane", "spirit"


def _palette(backdrop: str) -> dict[str, str]:
    palettes = {
        "sky": {"top": "#77bdfb", "mid": "#b8dfff", "bottom": "#f7d9a8", "ground": "#42536a", "accent": "#ffe07c"},
        "garden": {"top": "#8ed1a5", "mid": "#bfeec8", "bottom": "#f4e6b8", "ground": "#2d5b3d", "accent": "#ffd785"},
        "forge": {"top": "#50314f", "mid": "#a05b43", "bottom": "#f7b36d", "ground": "#241b22", "accent": "#ffd36f"},
        "storm": {"top": "#33466c", "mid": "#6573ab", "bottom": "#c7a7c6", "ground": "#1f273b", "accent": "#fff1a8"},
        "ruins": {"top": "#53627d", "mid": "#95a3b8", "bottom": "#e9d0a3", "ground": "#47423f", "accent": "#fff0b7"},
        "arcane": {"top": "#49306c", "mid": "#7d62b2", "bottom": "#d3baf5", "ground": "#251d38", "accent": "#dff7ff"},
        "sunrise": {"top": "#ec8b58", "mid": "#f6c27c", "bottom": "#f8e6b5", "ground": "#59403a", "accent": "#fff0c6"},
    }
    return palettes[backdrop]


def _background_svg(backdrop: str, seed: str, colors: dict[str, str]) -> str:
    hill_y = 208 + int(seed[0:2], 16) % 24
    sun_x = 56 + int(seed[2:4], 16) % 118
    sun_y = 52 + int(seed[4:6], 16) % 54
    moon = '<circle cx="182" cy="58" r="16" fill="rgba(255,255,255,0.35)"/>' if backdrop in {"arcane", "ruins"} else ""
    extras = {
        "sky": '<path d="M34 84c18-16 42-14 56 0M122 74c16-12 36-10 50 0" stroke="rgba(255,255,255,0.45)" stroke-width="8" stroke-linecap="round"/>',
        "garden": (
            '<path d="M24 240c20-22 30-52 34-78M214 240c-20-22-30-52-34-78" stroke="rgba(36,85,46,0.46)" '
            'stroke-width="10" stroke-linecap="round"/>'
        ),
        "forge": '<path d="M36 154 58 126 72 146 92 116 108 144" stroke="rgba(255,210,127,0.45)" stroke-width="8" stroke-linecap="round"/>',
        "storm": '<path d="M162 48 144 94 170 94 134 156" stroke="rgba(255,255,210,0.82)" stroke-width="10" stroke-linejoin="round"/>',
        "ruins": '<path d="M28 180h28M186 172h22" stroke="rgba(255,255,255,0.18)" stroke-width="10" stroke-linecap="round"/>',
        "arcane": '<circle cx="56" cy="92" r="8" fill="rgba(255,255,255,0.18)"/><circle cx="172" cy="84" r="6" fill="rgba(255,255,255,0.14)"/>',
        "sunrise": '<path d="M40 108h162" stroke="rgba(255,255,255,0.24)" stroke-width="6" stroke-linecap="round"/>',
    }[backdrop]
    return f"""
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{colors['top']}"/>
      <stop offset="55%" stop-color="{colors['mid']}"/>
      <stop offset="100%" stop-color="{colors['bottom']}"/>
    </linearGradient>
  </defs>
  <rect width="240" height="336" rx="26" fill="url(#sky)"/>
  <circle cx="{sun_x}" cy="{sun_y}" r="32" fill="{colors['accent']}" opacity="0.75"/>
  {moon}
  {extras}
  <path d="M0 {hill_y}C58 {hill_y - 20} 114 {hill_y + 12} 180 {hill_y - 18}C212 {hill_y - 26} 228 {hill_y - 10} 240 {hill_y - 6}V336H0Z" fill="{colors['ground']}"/>
""".strip()


def _subject_svg(subject: str, colors: dict[str, str], seed: str) -> str:
    accent = colors["accent"]
    if subject == "fortress":
        return f"""
  <g transform="translate(34 92)">
    <rect x="22" y="80" width="128" height="90" rx="8" fill="#cfd6df"/>
    <rect x="0" y="48" width="36" height="122" rx="8" fill="#b7c0cc"/>
    <rect x="136" y="58" width="34" height="112" rx="8" fill="#b7c0cc"/>
    <rect x="68" y="114" width="36" height="56" rx="18" fill="#6a4f3d"/>
    <path d="M18 80h22M56 80h20M100 80h20M136 80h18" stroke="#8f99aa" stroke-width="8" />
    <path d="M18 48v-18h12v18M146 58V34h10v24M80 80V42h12v38" stroke="{accent}" stroke-width="8" stroke-linecap="round"/>
  </g>
""".strip()
    if subject == "machine_fortress":
        return f"""
  <g transform="translate(30 90)">
    <rect x="18" y="88" width="142" height="82" rx="10" fill="#c6a38e"/>
    <rect x="0" y="52" width="42" height="118" rx="10" fill="#8f7770"/>
    <rect x="138" y="44" width="42" height="126" rx="10" fill="#8f7770"/>
    <circle cx="90" cy="108" r="24" fill="none" stroke="{accent}" stroke-width="10"/>
    <path d="M90 74v22M90 120v22M56 108h22M102 108h22" stroke="{accent}" stroke-width="10" stroke-linecap="round"/>
    <path d="M30 78h20M130 78h20" stroke="#5f4a46" stroke-width="8" />
  </g>
""".strip()
    if subject == "bird":
        wing_lift = int(seed[6:8], 16) % 18
        return f"""
  <g transform="translate(24 78)">
    <path d="M44 138c12-60 48-102 96-112-18 24-24 48-18 70 18-2 36 6 54 26-42 6-74 10-92 16-24 8-44 10-58 0 18-2 28-2 30 0-6-10-10-24-12-40Z" fill="#f5f7fb"/>
    <path d="M88 70c18-20 42-32 70-36-18 14-28 30-30 48" stroke="{accent}" stroke-width="10" stroke-linecap="round"/>
    <path d="M56 136c16-{wing_lift} 34-{wing_lift + 6} 58-{wing_lift + 10}" stroke="#6d5563" stroke-width="8" stroke-linecap="round"/>
  </g>
""".strip()
    if subject == "angel":
        return f"""
  <g transform="translate(34 82)">
    <circle cx="86" cy="22" r="16" fill="{accent}" opacity="0.85"/>
    <path d="M34 126c12-50 28-84 52-102-6 20-6 36 0 54-14 10-26 26-34 48Z" fill="#eff3ff"/>
    <path d="M138 126c-12-50-28-84-52-102 6 20 6 36 0 54 14 10 26 26 34 48Z" fill="#eff3ff"/>
    <path d="M86 52c26 24 34 54 34 116H52C52 106 60 76 86 52Z" fill="#fff7f0"/>
    <path d="M86 52v116" stroke="#d5c6d0" stroke-width="8" stroke-linecap="round"/>
  </g>
""".strip()
    if subject == "healer":
        return f"""
  <g transform="translate(48 86)">
    <circle cx="70" cy="34" r="22" fill="#f6d9c2"/>
    <path d="M42 168c4-62 18-100 28-112 10 12 24 50 28 112Z" fill="#f9f6ee"/>
    <path d="M70 72v64M38 104h64" stroke="{accent}" stroke-width="14" stroke-linecap="round"/>
    <path d="M26 168h88" stroke="#6b7d56" stroke-width="10" stroke-linecap="round"/>
  </g>
""".strip()
    if subject == "machine":
        return f"""
  <g transform="translate(42 92)">
    <rect x="34" y="42" width="72" height="76" rx="12" fill="#d6b5a6"/>
    <circle cx="70" cy="80" r="18" fill="none" stroke="{accent}" stroke-width="10"/>
    <path d="M70 50v14M70 96v14M40 80h14M86 80h14" stroke="{accent}" stroke-width="8" stroke-linecap="round"/>
    <path d="M34 118 22 158M106 118 118 158M52 50 32 30M88 50 108 30" stroke="#2a2b34" stroke-width="10" stroke-linecap="round"/>
  </g>
""".strip()
    if subject == "plant":
        bloom = 16 + int(seed[8:10], 16) % 16
        return f"""
  <g transform="translate(40 86)">
    <path d="M80 170C76 118 82 86 88 42" stroke="#2f6b44" stroke-width="12" stroke-linecap="round"/>
    <path d="M84 62c-26-12-44-6-54 16 22 4 40 0 54-16ZM92 84c26-12 44-6 54 16-22 4-40 0-54-16Z" fill="#75b568"/>
    <circle cx="88" cy="34" r="{bloom}" fill="{accent}"/>
    <circle cx="64" cy="42" r="18" fill="#ffd0d8"/>
    <circle cx="112" cy="44" r="18" fill="#f5f3f0"/>
  </g>
""".strip()
    if subject == "archer":
        return f"""
  <g transform="translate(50 86)">
    <circle cx="66" cy="28" r="20" fill="#f0d1b8"/>
    <path d="M66 54c26 20 34 54 36 114H30c2-60 10-94 36-114Z" fill="#d9dbe8"/>
    <path d="M102 94c18 10 26 24 30 42M90 86c18-10 34-24 48-44" stroke="{accent}" stroke-width="10" stroke-linecap="round"/>
    <path d="M120 72c-6 24-8 52-8 90" stroke="#44363f" stroke-width="8" />
  </g>
""".strip()
    if subject == "lancer":
        return f"""
  <g transform="translate(42 84)">
    <circle cx="78" cy="28" r="20" fill="#f0cfb4"/>
    <path d="M78 54c28 22 38 56 40 118H38c2-62 12-96 40-118Z" fill="#f3f1ea"/>
    <path d="M116 22 160 2 132 60" fill="{accent}"/>
    <path d="M118 16 92 170" stroke="#58484c" stroke-width="8" stroke-linecap="round"/>
    <path d="M48 88h42v42H48Z" fill="#d6d9e2"/>
  </g>
""".strip()
    if subject == "beast":
        horn = 18 + int(seed[10:12], 16) % 12
        return f"""
  <g transform="translate(32 100)">
    <path d="M44 118c4-52 32-92 84-98 40 6 62 34 68 88-14 30-48 52-104 56-30-4-46-18-48-46Z" fill="#1f2430"/>
    <path d="M92 22 74 {22 - horn} 92 8M124 22 142 {22 - horn} 124 8" stroke="{accent}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="90" cy="92" r="8" fill="{accent}"/>
    <circle cx="126" cy="92" r="8" fill="{accent}"/>
  </g>
""".strip()
    return f"""
  <g transform="translate(52 92)">
    <path d="M68 18c24 18 36 42 38 74-2 34-18 60-50 78-30-18-46-44-48-78 2-32 14-56 36-74 8 18 16 28 24 30Z" fill="#f3efff"/>
    <circle cx="58" cy="72" r="18" fill="{accent}" opacity="0.78"/>
    <path d="M16 160c28-10 58-10 84 0" stroke="{accent}" stroke-width="8" stroke-linecap="round"/>
  </g>
""".strip()


def card_art_svg(card, fallback_kind: str = "unit") -> str:
    normalized = normalize_card(card, fallback_kind)
    seed = _seed_hex(normalized)
    tokens = _tokens(normalized)
    backdrop, subject = _pick_scene(tokens, normalized)
    colors = _palette(backdrop)
    return f"""
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="336" viewBox="0 0 240 336" fill="none" role="img" aria-label="{normalized['name']} artwork">
  {_background_svg(backdrop, seed, colors)}
  {_subject_svg(subject, colors, seed)}
  <rect x="14" y="14" width="212" height="308" rx="22" fill="none" stroke="rgba(255,255,255,0.24)" />
</svg>
""".strip()


def card_art_data_uri(card, fallback_kind: str = "unit") -> str:
    return "data:image/svg+xml;utf8," + quote(card_art_svg(card, fallback_kind))
