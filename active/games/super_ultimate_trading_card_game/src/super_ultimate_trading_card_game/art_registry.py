from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


def _lookup(card, key: str, default=None):
    if isinstance(card, dict):
        return card.get(key, default)
    value = getattr(card, key, default)
    if hasattr(value, "value"):
        return value.value
    return value


@dataclass(frozen=True)
class CardArtVariant:
    variant_id: str
    label: str
    rarity: str | None
    static_path: str
    card_names: tuple[str, ...] = ()
    prompts: tuple[str, ...] = ()
    card_id_suffixes: tuple[str, ...] = ()

    def matches_card(self, card) -> bool:
        card_id = str(_lookup(card, "card_id", ""))
        name = str(_lookup(card, "name", ""))
        prompt = str(_lookup(card, "prompt", ""))
        return (
            name in self.card_names
            or prompt in self.prompts
            or any(card_id.endswith(suffix) for suffix in self.card_id_suffixes)
        )


_TRACK_LANCER_ALT = CardArtVariant(
    variant_id="track-lancer-velocity-rare",
    label="Velocity Charge",
    rarity="Rare Alt Art",
    static_path="card_art/track-lancer-velocity-rare.png",
    prompts=("starter attacker lancer",),
    card_id_suffixes=("starter-lancer",),
)

ART_VARIANTS = {
    _TRACK_LANCER_ALT.variant_id: _TRACK_LANCER_ALT,
}


def card_art_variant(card) -> CardArtVariant | None:
    explicit_variant_id = _lookup(card, "art_variant_id")
    if explicit_variant_id:
        return ART_VARIANTS.get(str(explicit_variant_id))
    for variant in ART_VARIANTS.values():
        if variant.matches_card(card):
            return variant
    return None


def card_art_variant_path(card) -> Path | None:
    variant = card_art_variant(card)
    if variant is None:
        return None
    asset_path = Path(__file__).resolve().parent / "static" / variant.static_path
    if asset_path.exists():
        return asset_path
    return None
