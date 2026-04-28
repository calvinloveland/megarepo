from __future__ import annotations

import random
from dataclasses import dataclass, field

from .generation import CardGenerator
from .models import CardDefinition, CardKind, PlannedPlay, PlayerState, PlayerView, RoundDecision, TrackName
from .starter_data import starter_pool


@dataclass
class BotProfile:
    player_id: str
    display_name: str
    persona: str
    owned_cards: dict[str, CardDefinition] = field(default_factory=dict)
    owned_bases: dict[str, CardDefinition] = field(default_factory=dict)


class PrototypeBot:
    def __init__(self, player_id: str, display_name: str, persona: str, *, seed: int = 0):
        self.profile = BotProfile(player_id=player_id, display_name=display_name, persona=persona)
        self.rng = random.Random(seed)

    @property
    def player_id(self) -> str:
        return self.profile.player_id

    @property
    def display_name(self) -> str:
        return self.profile.display_name

    def ensure_collection(self, generator: CardGenerator) -> None:
        if not self.profile.owned_bases:
            base_prompt = self._base_prompt()
            base = generator.generate_card(self.profile.player_id, base_prompt, kind=CardKind.BASE)
            self.profile.owned_bases[base.card_id] = base
        if not self.profile.owned_cards:
            for card in starter_pool(self.profile.player_id):
                self.profile.owned_cards[card.card_id] = card
            for _ in range(4):
                prompt = self._generation_prompt(needs=None)
                card = generator.generate_card(self.profile.player_id, prompt, kind=CardKind.UNIT)
                self.profile.owned_cards[card.card_id] = card

    def choose_base(self) -> CardDefinition:
        return max(self.profile.owned_bases.values(), key=lambda card: card.hp + card.income * 4 + card.attack)

    def build_deck(self) -> list[CardDefinition]:
        cards = list(self.profile.owned_cards.values())
        if not cards:
            return []
        scored = sorted(cards, key=self._deck_score, reverse=True)
        deck: list[CardDefinition] = []
        while len(deck) < 6:
            pick = scored[len(deck) % min(3, len(scored))]
            deck.append(pick)
        return deck

    def decide_round(self, view: PlayerView) -> RoundDecision:
        generate_prompt = None
        if self._should_generate(view):
            generate_prompt = self._generation_prompt(needs=self._board_need(view))

        playable = [card for card in view.own_hand if card.cpc is not None and card.cpc <= view.card_points]
        chosen_cards = sorted(playable, key=lambda card: self._play_score(card, view), reverse=True)[:2]
        remaining_points = view.card_points
        plays: list[PlannedPlay] = []
        for card in chosen_cards:
            if card.cpc is None or card.cpc > remaining_points:
                continue
            stationary = "Defender" in card.keywords and self._wants_defender(view)
            track = self._choose_track(card, view, stationary=stationary)
            plays.append(PlannedPlay(card_id=card.card_id, track=track, stationary=stationary))
            remaining_points -= card.cpc
        return RoundDecision(generate_prompt=generate_prompt, plays=tuple(plays))

    def register_generated_card(self, card: CardDefinition) -> None:
        if card.kind is CardKind.BASE:
            self.profile.owned_bases[card.card_id] = card
        else:
            self.profile.owned_cards[card.card_id] = card

    def _base_prompt(self) -> str:
        prompts = {
            "aggressive": "A blazing war citadel that rewards all-out attacks",
            "guardian": "A patient living fortress that protects and heals",
            "inventor": "A strange clockwork shrine that fuels creative combos",
        }
        return prompts.get(self.profile.persona, "A surprising magical fortress")

    def _should_generate(self, view: PlayerView) -> bool:
        if len(view.owned_cards) < 8:
            return True
        if view.card_points <= 1:
            return False
        return self.rng.random() < 0.7

    def _board_need(self, view: PlayerView) -> str:
        if any(card.owner_id != view.player_id and "Flying" in card.keywords for card in view.board):
            return "anti_air"
        if view.own_base_hp < view.opponent_base_hp:
            return "support"
        if view.own_base_hp <= 10:
            return "defense"
        if view.opponent_base_hp <= 8:
            return "finisher"
        if not any("Defender" in card.keywords for card in view.own_hand):
            return "defender"
        if self.profile.persona == "inventor" and view.card_points <= 3:
            return "economy"
        return "pressure"

    def _generation_prompt(self, needs: str | None) -> str:
        persona_themes = {
            "aggressive": ["stormblade", "phoenix cavalry", "shock raider", "solar lancer"],
            "guardian": ["vine guardian", "marble angel", "warding tortoise", "lifebloom sentinel"],
            "inventor": ["clockwork medic", "singing engine", "copper dragonfly", "glass artificer"],
        }
        themes = persona_themes.get(self.profile.persona, ["strange knight", "moon beast"])
        theme = self.rng.choice(themes)
        if needs == "anti_air":
            return f"An intercept hunter {theme} that can catch flying attackers"
        if needs == "support":
            return f"A healing medic repair {theme} that restores allies and stabilizes the board"
        if needs == "defense":
            return f"A sturdy shield wall bramble {theme} that buys time and protects the base"
        if needs == "finisher":
            return f"A dramatic flying charge siege {theme} that can break through for lethal pressure"
        if needs == "pressure":
            return f"A creative ranged blitz {theme} for aggressive track pressure"
        if needs == "defender":
            return f"A weird shield guard {theme} that can anchor a lane"
        if needs == "economy":
            return f"A clever engine forge {theme} that generates extra card points"
        return f"A surprising {theme} with a fun passive ability"

    def _deck_score(self, card: CardDefinition) -> float:
        score = float(card.attack * 2 + card.hp + card.speed + (card.income * 3))
        if "gain_card_points" in card.ability_script:
            score += 4.0
        if "heal_base" in card.ability_script or "heal_ally" in card.ability_script:
            score += 2.5
        if "reduce_incoming_damage" in card.ability_script or "reflect_damage" in card.ability_script:
            score += 2.5
        if "add_base_damage" in card.ability_script:
            score += 2.5
        if self.profile.persona == "aggressive":
            score += 2.0 * card.attack
            if "Charge" in card.keywords or "Flying" in card.keywords:
                score += 3.0
            if "add_attack" in card.ability_script or "add_base_damage" in card.ability_script:
                score += 2.5
        elif self.profile.persona == "guardian":
            if "Defender" in card.keywords:
                score += 4.0
            if card.passive.type in ("heal_base", "fortify"):
                score += 3.0
            if "heal_base" in card.ability_script or "heal_ally" in card.ability_script:
                score += 3.0
            if "reduce_incoming_damage" in card.ability_script or "reflect_damage" in card.ability_script:
                score += 3.0
        else:
            if card.passive.type == "income_boost":
                score += 4.0
            if "Ranged" in card.keywords:
                score += 2.0
        if card.cpc:
            score -= card.cpc * 0.8
        return score

    def _play_score(self, card: CardDefinition, view: PlayerView) -> float:
        score = self._deck_score(card)
        if view.own_base_hp < 12 and "Defender" in card.keywords:
            score += 4.0
        if view.own_base_hp < 12 and ("heal_base" in card.ability_script or "heal_ally" in card.ability_script):
            score += 3.0
        if view.opponent_base_hp < 12 and ("Flying" in card.keywords or "Charge" in card.keywords):
            score += 4.0
        if view.opponent_base_hp < 12 and "add_base_damage" in card.ability_script:
            score += 3.0
        return score

    def _wants_defender(self, view: PlayerView) -> bool:
        return view.own_base_hp <= view.opponent_base_hp or self.profile.persona == "guardian"

    def _choose_track(self, card: CardDefinition, view: PlayerView, *, stationary: bool) -> TrackName:
        if stationary:
            return self._most_threatened_track(view)
        if "Flying" in card.keywords or "Charge" in card.keywords:
            return TrackName.FAST
        if self.profile.persona == "guardian":
            return self._most_threatened_track(view)
        if view.opponent_base_hp <= 10:
            return TrackName.FAST
        return TrackName.SLOW if "Ranged" in card.keywords else TrackName.FAST

    def _most_threatened_track(self, view: PlayerView) -> TrackName:
        scores = {
            TrackName.FAST: 0.0,
            TrackName.SLOW: 0.0,
        }
        for card in view.board:
            if card.owner_id == view.player_id:
                continue
            if view.player_id == "alpha":
                distance_to_base = card.position
            else:
                distance_to_base = 10.0 - card.position
            threat = max(0.5, 10.0 - distance_to_base)
            scores[card.track] += threat
        return max(scores, key=scores.get)


def create_default_bots(seed: int) -> tuple[PrototypeBot, PrototypeBot]:
    return (
        PrototypeBot("alpha", "Alpha Atelier", "inventor", seed=seed),
        PrototypeBot("beta", "Beta Bastion", "guardian", seed=seed + 1),
    )


def create_bot_roster(seed: int) -> list[PrototypeBot]:
    return [
        PrototypeBot("alpha", "Alpha Atelier", "inventor", seed=seed),
        PrototypeBot("beta", "Beta Bastion", "guardian", seed=seed + 1),
        PrototypeBot("gamma", "Gamma Blitz", "aggressive", seed=seed + 2),
    ]
