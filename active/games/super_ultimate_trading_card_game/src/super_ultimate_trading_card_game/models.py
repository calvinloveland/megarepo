from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

TRACK_LENGTH = 10.0
FAST_TRACK_STEP = 5.0
SLOW_TRACK_STEP = 2.0
DRAW_COUNT = 3
PLAYS_PER_ROUND = 2
DECK_SIZE = 6
STARTING_CARD_POINTS = 0
TARGET_MATCH_ROUNDS = 12
MAX_MATCH_ROUNDS = 18

ROLE_TAGS = ("attacker", "defender", "economy", "support", "ranged")
KEYWORDS = ("Defender", "Ranged", "Healing", "Charge", "Flying", "Intercept")
PASSIVE_TYPES = (
    "none",
    "income_boost",
    "heal_base",
    "heal_self",
    "fortify",
    "berserk",
    "intercept_flying",
)


class CardKind(str, Enum):
    BASE = "base"
    UNIT = "unit"


class TrackName(str, Enum):
    FAST = "fast"
    SLOW = "slow"


TRACK_STEPS = {
    TrackName.FAST: FAST_TRACK_STEP,
    TrackName.SLOW: SLOW_TRACK_STEP,
}


@dataclass(frozen=True)
class PassiveAbility:
    type: str = "none"
    magnitude: int = 0
    text: str = "No passive ability."


@dataclass(frozen=True)
class CardDefinition:
    card_id: str
    name: str
    theme: str
    prompt: str
    owner_id: str
    kind: CardKind
    hp: int
    attack: int
    cpc: Optional[int]
    speed: int
    attack_range: int
    income: int
    keywords: tuple[str, ...] = ()
    role_tags: tuple[str, ...] = ()
    passive: PassiveAbility = PassiveAbility()
    ability_summary: str = "No scripted ability."
    ability_script: str = ""

    def has_keyword(self, keyword: str) -> bool:
        return keyword in self.keywords

    @property
    def has_scripted_ability(self) -> bool:
        return bool(self.ability_script.strip())


@dataclass
class CardInPlay:
    instance_id: str
    definition: CardDefinition
    owner_id: str
    track: TrackName
    position: float
    stationary: bool
    entered_round: int
    current_hp: int
    engaged_with: Optional[str] = None

    def has_keyword(self, keyword: str) -> bool:
        return self.definition.has_keyword(keyword)

    @property
    def is_alive(self) -> bool:
        return self.current_hp > 0


@dataclass
class PlayerState:
    player_id: str
    display_name: str
    base_card: CardDefinition
    base_hp: int
    card_points: int
    draw_pile: list[CardDefinition]
    discard_pile: list[CardDefinition]
    hand: list[CardDefinition] = field(default_factory=list)
    owned_cards: dict[str, CardDefinition] = field(default_factory=dict)
    owned_bases: dict[str, CardDefinition] = field(default_factory=dict)
    generated_cards: list[CardDefinition] = field(default_factory=list)

    def all_owned_units(self) -> list[CardDefinition]:
        return list(self.owned_cards.values())


@dataclass(frozen=True)
class PlannedPlay:
    card_id: str
    track: TrackName
    stationary: bool = False


@dataclass(frozen=True)
class RoundDecision:
    generate_prompt: Optional[str]
    plays: tuple[PlannedPlay, ...]


@dataclass(frozen=True)
class PublicCardSummary:
    instance_id: str
    owner_id: str
    name: str
    track: TrackName
    position: float
    attack: int
    max_hp: int
    current_hp: int
    cpc: Optional[int]
    stationary: bool
    engaged: bool
    keywords: tuple[str, ...]
    ability_summary: str


@dataclass(frozen=True)
class PlayerView:
    player_id: str
    round_number: int
    card_points: int
    own_base_hp: int
    opponent_base_hp: int
    own_hand: tuple[CardDefinition, ...]
    own_draw_count: int
    own_discard_count: int
    opponent_draw_count: int
    board: tuple[PublicCardSummary, ...]
    owned_cards: tuple[CardDefinition, ...]
    owned_bases: tuple[CardDefinition, ...]


@dataclass
class MatchResult:
    winner_id: Optional[str]
    rounds_played: int
    reason: str
    event_log: list[str]
    generated_cards: int
