from __future__ import annotations

import itertools
import random
from dataclasses import dataclass

from .bots import PrototypeBot
from .models import (
    DRAW_COUNT,
    FAST_TRACK_STEP,
    MAX_MATCH_ROUNDS,
    PLAYS_PER_ROUND,
    SLOW_TRACK_STEP,
    STARTING_CARD_POINTS,
    TRACK_LENGTH,
    CardDefinition,
    CardInPlay,
    CardKind,
    MatchResult,
    PlannedPlay,
    PlayerState,
    PlayerView,
    PublicCardSummary,
    RoundDecision,
    TrackName,
)
from .sandbox import execute_ability_script


@dataclass
class MatchContext:
    left: PrototypeBot
    right: PrototypeBot
    left_state: PlayerState
    right_state: PlayerState
    board: list[CardInPlay]
    rng: random.Random
    log: list[str]
    generated_cards: int = 0
    instance_counter: itertools.count = itertools.count(1)


@dataclass
class AbilityRuntime:
    attack_bonus: int = 0
    base_damage_bonus: int = 0
    incoming_damage_reduction: int = 0
    reflect_damage: int = 0


def _opponent_id(player_id: str, left_id: str, right_id: str) -> str:
    return right_id if player_id == left_id else left_id


def _player_state(context: MatchContext, player_id: str) -> PlayerState:
    return context.left_state if player_id == context.left.player_id else context.right_state


def _opponent_state(context: MatchContext, player_id: str) -> PlayerState:
    return context.right_state if player_id == context.left.player_id else context.left_state


def _global_position(card: CardInPlay, left_id: str) -> float:
    if card.owner_id == left_id:
        return card.position
    return TRACK_LENGTH - card.position


def _set_global_position(card: CardInPlay, left_id: str, value: float) -> None:
    if card.owner_id == left_id:
        card.position = max(0.0, min(TRACK_LENGTH, value))
    else:
        card.position = max(0.0, min(TRACK_LENGTH, TRACK_LENGTH - value))


def _card_label(card: CardInPlay) -> str:
    suffix = card.instance_id.split("-")[-1]
    return f"{card.definition.name}#{suffix}"


def _definition_label(card: CardDefinition) -> str:
    parts = card.card_id.split("-")
    token = parts[1] if len(parts) > 2 else card.card_id[:6]
    return f"{card.name}<{token}>"


def _can_attack(card: CardInPlay, round_number: int) -> bool:
    return card.is_alive and (card.entered_round < round_number or card.has_keyword("Charge"))


def _berserk_bonus(card: CardInPlay) -> int:
    if card.definition.passive.type != "berserk":
        return 0
    if card.current_hp > max(1, card.definition.hp // 2):
        return 0
    return max(1, card.definition.passive.magnitude)


def _effective_attack(card: CardInPlay) -> int:
    attack = card.definition.attack
    attack += _berserk_bonus(card)
    return attack


def _mitigated_damage(target: CardInPlay, raw_damage: int, scripted_reduction: int = 0) -> int:
    if target.definition.passive.type == "fortify":
        raw_damage -= max(1, target.definition.passive.magnitude)
    raw_damage -= scripted_reduction
    return max(0, raw_damage)


def _can_block(attacker: CardInPlay, blocker: CardInPlay) -> bool:
    if attacker.has_keyword("Flying"):
        return blocker.has_keyword("Flying") or blocker.has_keyword("Intercept") or blocker.definition.passive.type == "intercept_flying"
    return True


def _reshuffle_if_needed(player: PlayerState, rng: random.Random) -> None:
    if player.draw_pile:
        return
    if not player.discard_pile:
        return
    rng.shuffle(player.discard_pile)
    player.draw_pile = list(player.discard_pile)
    player.discard_pile.clear()


def _draw_cards(player: PlayerState, rng: random.Random, count: int) -> None:
    for _ in range(count):
        _reshuffle_if_needed(player, rng)
        if not player.draw_pile:
            return
        player.hand.append(player.draw_pile.pop(0))


def _ability_name(card: CardInPlay) -> str:
    return card.definition.ability_summary if card.definition.ability_summary != "No scripted ability." else "its scripted ability"


def _base_ability_name(base_card: CardDefinition) -> str:
    return base_card.ability_summary if base_card.ability_summary != "No scripted ability." else "its scripted ability"


def _heal_card(card: CardInPlay, amount: int) -> int:
    before = card.current_hp
    card.current_hp = min(card.definition.hp, card.current_hp + amount)
    return card.current_hp - before


def _heal_best_ally(context: MatchContext, player: PlayerState, source_card: CardInPlay, amount: int) -> tuple[str, int] | None:
    damaged_allies = [
        card
        for card in context.board
        if card.owner_id == player.player_id
        and card.is_alive
        and card.instance_id != source_card.instance_id
        and card.current_hp < card.definition.hp
    ]
    if damaged_allies:
        target = max(damaged_allies, key=lambda card: (card.definition.hp - card.current_hp, card.definition.hp))
        healed = _heal_card(target, amount)
        if healed > 0:
            return _card_label(target), healed
        return None
    if player.base_hp < player.base_card.hp:
        before = player.base_hp
        player.base_hp = min(player.base_card.hp, player.base_hp + amount)
        healed = player.base_hp - before
        if healed > 0:
            return f"{player.display_name}'s base", healed
    return None


class AbilityAPI:
    def __init__(
        self,
        context: MatchContext,
        player: PlayerState,
        card: CardInPlay,
        *,
        event: str,
        runtime: AbilityRuntime,
        enemy_name: str | None = None,
    ):
        self._context = context
        self._player = player
        self._card = card
        self.event = event
        self._runtime = runtime
        self._enemy_name = enemy_name

    def _clamp(self, amount: int) -> int:
        return max(0, min(3, int(amount)))

    def _enemy_name_count(self, char: str) -> int:
        if not self._enemy_name:
            return 0
        target = char.lower()
        return min(8, self._enemy_name.lower().count(target))

    def heal_self(self, amount: int) -> None:
        healed = _heal_card(self._card, self._clamp(amount))
        if healed > 0:
            self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} to heal itself for {healed}.")

    def heal_ally(self, amount: int) -> None:
        result = _heal_best_ally(self._context, self._player, self._card, self._clamp(amount))
        if result is not None:
            target_label, healed = result
            self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} to heal {target_label} for {healed}.")

    def heal_base(self, amount: int) -> None:
        before = self._player.base_hp
        self._player.base_hp = min(self._player.base_card.hp, self._player.base_hp + self._clamp(amount))
        healed = self._player.base_hp - before
        if healed > 0:
            self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} to heal {self._player.display_name}'s base for {healed}.")

    def gain_card_points(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._player.card_points += granted
        self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} to gain +{granted} card points.")

    def add_attack(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.attack_bonus += granted
        self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} for +{granted} attack.")

    def add_attack_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.attack_bonus += granted
        self._context.log.append(
            f"{_card_label(self._card)} used {_ability_name(self._card)} for +{granted} attack from '{char}' in {self._enemy_name}."
        )

    def add_base_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.base_damage_bonus += granted
        self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} for +{granted} base damage.")

    def add_base_damage_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.base_damage_bonus += granted
        self._context.log.append(
            f"{_card_label(self._card)} used {_ability_name(self._card)} for +{granted} base damage from '{char}' in {self._enemy_name}."
        )

    def reduce_incoming_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.incoming_damage_reduction += granted
        self._context.log.append(f"{_card_label(self._card)} used {_ability_name(self._card)} to reduce incoming damage by {granted}.")

    def reflect_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.reflect_damage += granted
        self._context.log.append(f"{_card_label(self._card)} primed {_ability_name(self._card)} to reflect {granted} damage.")

    def reflect_damage_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.reflect_damage += granted
        self._context.log.append(
            f"{_card_label(self._card)} primed {_ability_name(self._card)} to reflect {granted} damage from '{char}' in {self._enemy_name}."
        )

    def log(self, message: str) -> None:
        if message:
            self._context.log.append(f"{_card_label(self._card)} ability note: {message}")


def _trigger_scripted_ability(
    context: MatchContext,
    player: PlayerState,
    card: CardInPlay,
    event: str,
    *,
    enemy_name: str | None = None,
) -> AbilityRuntime:
    runtime = AbilityRuntime()
    if not card.definition.has_scripted_ability or not card.is_alive:
        return runtime
    execute_ability_script(
        card.definition.ability_script,
        AbilityAPI(context, player, card, event=event, runtime=runtime, enemy_name=enemy_name),
    )
    return runtime


class BaseAbilityAPI:
    def __init__(
        self,
        context: MatchContext,
        player: PlayerState,
        *,
        event: str,
        runtime: AbilityRuntime,
        enemy_name: str | None = None,
    ):
        self._context = context
        self._player = player
        self.event = event
        self._runtime = runtime
        self._enemy_name = enemy_name

    def _clamp(self, amount: int) -> int:
        return max(0, min(3, int(amount)))

    def _enemy_name_count(self, char: str) -> int:
        if not self._enemy_name:
            return 0
        target = char.lower()
        return min(8, self._enemy_name.lower().count(target))

    def heal_self(self, amount: int) -> None:
        self.heal_base(amount)

    def heal_ally(self, amount: int) -> None:
        pseudo_source = CardInPlay(
            instance_id=f"{self._player.player_id}-base",
            definition=self._player.base_card,
            owner_id=self._player.player_id,
            track=TrackName.FAST,
            position=0.0,
            stationary=True,
            entered_round=0,
            current_hp=self._player.base_hp,
        )
        result = _heal_best_ally(self._context, self._player, pseudo_source, self._clamp(amount))
        if result is not None:
            target_label, healed = result
            self._context.log.append(
                f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} to heal {target_label} for {healed}."
            )

    def heal_base(self, amount: int) -> None:
        before = self._player.base_hp
        self._player.base_hp = min(self._player.base_card.hp, self._player.base_hp + self._clamp(amount))
        healed = self._player.base_hp - before
        if healed > 0:
            self._context.log.append(
                f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} to heal itself for {healed}."
            )

    def gain_card_points(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._player.card_points += granted
        self._context.log.append(
            f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} to gain +{granted} card points."
        )

    def add_attack(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.attack_bonus += granted
        self._context.log.append(
            f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} for +{granted} counterattack."
        )

    def add_attack_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.attack_bonus += granted
        self._context.log.append(
            f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} for +{granted} counterattack from '{char}' in {self._enemy_name}."
        )

    def add_base_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.base_damage_bonus += granted

    def add_base_damage_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.base_damage_bonus += granted

    def reduce_incoming_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.incoming_damage_reduction += granted
        self._context.log.append(
            f"{self._player.display_name}'s base used {_base_ability_name(self._player.base_card)} to reduce incoming damage by {granted}."
        )

    def reflect_damage(self, amount: int) -> None:
        granted = self._clamp(amount)
        if granted <= 0:
            return
        self._runtime.reflect_damage += granted
        self._context.log.append(
            f"{self._player.display_name}'s base primed {_base_ability_name(self._player.base_card)} to reflect {granted} damage."
        )

    def reflect_damage_per_enemy_name_char(self, char: str) -> None:
        granted = self._enemy_name_count(char)
        if granted <= 0:
            return
        self._runtime.reflect_damage += granted
        self._context.log.append(
            f"{self._player.display_name}'s base primed {_base_ability_name(self._player.base_card)} to reflect {granted} damage from '{char}' in {self._enemy_name}."
        )

    def log(self, message: str) -> None:
        if message:
            self._context.log.append(f"{self._player.display_name}'s base ability note: {message}")


def _trigger_base_scripted_ability(
    context: MatchContext,
    player: PlayerState,
    event: str,
    *,
    enemy_name: str | None = None,
) -> AbilityRuntime:
    runtime = AbilityRuntime()
    if not player.base_card.has_scripted_ability:
        return runtime
    execute_ability_script(
        player.base_card.ability_script,
        BaseAbilityAPI(context, player, event=event, runtime=runtime, enemy_name=enemy_name),
    )
    return runtime


def _apply_round_income_and_healing(context: MatchContext) -> None:
    for player in (context.left_state, context.right_state):
        base_income = player.base_card.income
        bonus_income = 0
        _trigger_base_scripted_ability(context, player, "round_start")
        if player.base_card.passive.type == "income_boost":
            granted = max(1, player.base_card.passive.magnitude)
            bonus_income += granted
            context.log.append(f"{player.display_name}'s base passive granted +{granted} card points.")
        if player.base_card.passive.type == "heal_base":
            before = player.base_hp
            player.base_hp = min(player.base_card.hp, player.base_hp + max(1, player.base_card.passive.magnitude))
            healed = player.base_hp - before
            if healed > 0:
                context.log.append(f"{player.display_name}'s base passive healed the base for {healed}.")
        for card in context.board:
            if card.owner_id != player.player_id or not card.is_alive:
                continue
            if card.definition.passive.type == "income_boost":
                granted = max(1, card.definition.passive.magnitude)
                bonus_income += granted
                context.log.append(f"{_card_label(card)} triggered Income Boost for +{granted} card points.")
            if card.definition.passive.type == "heal_base":
                before = player.base_hp
                player.base_hp = min(player.base_card.hp, player.base_hp + max(1, card.definition.passive.magnitude))
                healed = player.base_hp - before
                if healed > 0:
                    context.log.append(f"{_card_label(card)} healed {player.display_name}'s base for {healed}.")
            if card.definition.passive.type == "heal_self":
                before = card.current_hp
                card.current_hp = min(card.definition.hp, card.current_hp + max(1, card.definition.passive.magnitude))
                healed = card.current_hp - before
                if healed > 0:
                    context.log.append(f"{_card_label(card)} healed itself for {healed}.")
            _trigger_scripted_ability(context, player, card, "round_start")
        total_income = base_income + bonus_income
        player.card_points += total_income
        context.log.append(
            f"{player.display_name} gained {total_income} card points ({base_income} base + {bonus_income} bonus)."
        )


def _build_view(context: MatchContext, player_id: str, round_number: int) -> PlayerView:
    player = _player_state(context, player_id)
    opponent = _opponent_state(context, player_id)
    board = tuple(
        PublicCardSummary(
            instance_id=card.instance_id,
            owner_id=card.owner_id,
            name=card.definition.name,
            track=card.track,
            position=round(_global_position(card, context.left.player_id), 2),
            current_hp=card.current_hp,
            stationary=card.stationary,
            engaged=card.engaged_with is not None,
            keywords=card.definition.keywords,
        )
        for card in context.board
        if card.is_alive
    )
    return PlayerView(
        player_id=player_id,
        round_number=round_number,
        card_points=player.card_points,
        own_base_hp=player.base_hp,
        opponent_base_hp=opponent.base_hp,
        own_hand=tuple(player.hand),
        own_draw_count=len(player.draw_pile),
        own_discard_count=len(player.discard_pile),
        opponent_draw_count=len(opponent.draw_pile),
        board=board,
        owned_cards=tuple(player.all_owned_units()),
        owned_bases=tuple(player.owned_bases.values()),
    )


def _decide_rounds(context: MatchContext, round_number: int) -> dict[str, RoundDecision]:
    return {
        context.left.player_id: context.left.decide_round(_build_view(context, context.left.player_id, round_number)),
        context.right.player_id: context.right.decide_round(_build_view(context, context.right.player_id, round_number)),
    }


def _handle_generation(context: MatchContext, decisions: dict[str, RoundDecision]) -> None:
    for bot, player in ((context.left, context.left_state), (context.right, context.right_state)):
        prompt = decisions[player.player_id].generate_prompt
        if not prompt:
            continue
        card = context.generator.generate_card(player.player_id, prompt, kind=CardKind.UNIT)  # type: ignore[attr-defined]
        player.owned_cards[card.card_id] = card
        player.generated_cards.append(card)
        player.discard_pile.append(card)
        bot.register_generated_card(card)
        context.generated_cards += 1
        context.log.append(f"{player.display_name} generated {_definition_label(card)} from prompt '{prompt}'.")


def _remove_from_hand(player: PlayerState, card_id: str) -> CardDefinition | None:
    for index, card in enumerate(player.hand):
        if card.card_id == card_id:
            return player.hand.pop(index)
    return None


def _apply_plays(context: MatchContext, decisions: dict[str, RoundDecision], round_number: int) -> None:
    for player in (context.left_state, context.right_state):
        for card in list(player.hand):
            if card not in player.hand:
                continue
        selected = decisions[player.player_id].plays[:PLAYS_PER_ROUND]
        for play in selected:
            _play_card(context, player, play, round_number)
        for card in list(player.hand):
            player.discard_pile.append(card)
        player.hand.clear()


def _play_card(context: MatchContext, player: PlayerState, play: PlannedPlay, round_number: int) -> None:
    card = _remove_from_hand(player, play.card_id)
    if card is None or card.cpc is None or card.cpc > player.card_points:
        return
    player.card_points -= card.cpc
    instance_id = f"instance-{next(context.instance_counter)}"
    in_play = CardInPlay(
        instance_id=instance_id,
        definition=card,
        owner_id=player.player_id,
        track=play.track,
        position=0.0,
        stationary=play.stationary and card.has_keyword("Defender"),
        entered_round=round_number,
        current_hp=card.hp,
    )
    context.board.append(in_play)
    mode = "as a defender" if in_play.stationary else f"onto the {play.track.value} track"
    context.log.append(f"{player.display_name} played {_card_label(in_play)} {mode}.")


def _enemies_in_path(context: MatchContext, mover: CardInPlay, target_global: float) -> list[CardInPlay]:
    enemies = [card for card in context.board if card.owner_id != mover.owner_id and card.track == mover.track and card.is_alive and card.engaged_with is None]
    if not enemies:
        return []
    mover_position = _global_position(mover, context.left.player_id)
    candidates: list[CardInPlay] = []
    if mover.owner_id == context.left.player_id:
        for enemy in enemies:
            enemy_pos = _global_position(enemy, context.left.player_id)
            if mover_position < enemy_pos <= target_global:
                candidates.append(enemy)
        return sorted(candidates, key=lambda card: _global_position(card, context.left.player_id))
    for enemy in enemies:
        enemy_pos = _global_position(enemy, context.left.player_id)
        if target_global <= enemy_pos < mover_position:
            candidates.append(enemy)
    return sorted(candidates, key=lambda card: _global_position(card, context.left.player_id), reverse=True)


def _move_cards(context: MatchContext, round_number: int) -> None:
    for card in sorted(context.board, key=lambda item: (item.track.value, _global_position(item, context.left.player_id))):
        if not card.is_alive or card.stationary or card.engaged_with is not None:
            continue
        step = (FAST_TRACK_STEP if card.track is TrackName.FAST else SLOW_TRACK_STEP) * max(1, card.definition.speed)
        current = _global_position(card, context.left.player_id)
        target = min(TRACK_LENGTH, current + step) if card.owner_id == context.left.player_id else max(0.0, current - step)
        enemies_in_path = _enemies_in_path(context, card, target)
        enemy = next((candidate for candidate in enemies_in_path if _can_block(card, candidate)), None)
        if enemy is not None:
            enemy_position = _global_position(enemy, context.left.player_id)
            _set_global_position(card, context.left.player_id, enemy_position)
            card.engaged_with = enemy.instance_id
            enemy.engaged_with = card.instance_id
            if card.has_keyword("Flying") and not enemy.has_keyword("Flying"):
                context.log.append(f"{_card_label(enemy)} intercepted flying attacker {_card_label(card)}.")
            context.log.append(f"{_card_label(card)} engaged {_card_label(enemy)} on the {card.track.value} track.")
            continue
        if card.has_keyword("Flying"):
            bypassed = [candidate for candidate in enemies_in_path if not _can_block(card, candidate)]
            if bypassed:
                context.log.append(
                    f"{_card_label(card)} flew past "
                    + ", ".join(_card_label(candidate) for candidate in bypassed)
                    + f" on the {card.track.value} track."
                )
        _set_global_position(card, context.left.player_id, target)
        if (card.owner_id == context.left.player_id and target >= TRACK_LENGTH) or (
            card.owner_id != context.left.player_id and target <= 0.0
        ):
            context.log.append(f"{_card_label(card)} reached the enemy base on the {card.track.value} track.")


def _ranged_supporters(context: MatchContext, frontline: CardInPlay) -> list[CardInPlay]:
    frontline_global = _global_position(frontline, context.left.player_id)
    supporters: list[CardInPlay] = []
    for card in context.board:
        if not card.is_alive or card.owner_id != frontline.owner_id or card.track != frontline.track:
            continue
        if card.instance_id == frontline.instance_id or card.engaged_with is not None:
            continue
        if not card.has_keyword("Ranged"):
            continue
        position = _global_position(card, context.left.player_id)
        if frontline.owner_id == context.left.player_id and position < frontline_global:
            supporters.append(card)
        elif frontline.owner_id != context.left.player_id and position > frontline_global:
            supporters.append(card)
    return supporters


def _resolve_engagements(context: MatchContext, round_number: int) -> None:
    processed: set[str] = set()
    for card in context.board:
        if not card.is_alive or not card.engaged_with or card.instance_id in processed:
            continue
        enemy = next((item for item in context.board if item.instance_id == card.engaged_with), None)
        if enemy is None or not enemy.is_alive:
            card.engaged_with = None
            continue
        processed.add(card.instance_id)
        processed.add(enemy.instance_id)
        left_damage = 0
        right_damage = 0
        card_runtime = AbilityRuntime()
        enemy_runtime = AbilityRuntime()
        if _can_attack(card, round_number):
            if card.entered_round == round_number and card.has_keyword("Charge"):
                context.log.append(f"{_card_label(card)} used Charge to attack immediately.")
            if _berserk_bonus(card) > 0:
                context.log.append(f"{_card_label(card)} triggered Berserk for +{_berserk_bonus(card)} attack.")
            card_runtime = _trigger_scripted_ability(
                context,
                _player_state(context, card.owner_id),
                card,
                "combat",
                enemy_name=enemy.definition.name,
            )
            left_damage += _effective_attack(card) + card_runtime.attack_bonus
        if _can_attack(enemy, round_number):
            if enemy.entered_round == round_number and enemy.has_keyword("Charge"):
                context.log.append(f"{_card_label(enemy)} used Charge to attack immediately.")
            if _berserk_bonus(enemy) > 0:
                context.log.append(f"{_card_label(enemy)} triggered Berserk for +{_berserk_bonus(enemy)} attack.")
            enemy_runtime = _trigger_scripted_ability(
                context,
                _player_state(context, enemy.owner_id),
                enemy,
                "combat",
                enemy_name=card.definition.name,
            )
            right_damage += _effective_attack(enemy) + enemy_runtime.attack_bonus
        for supporter in _ranged_supporters(context, card):
            if _can_attack(supporter, round_number):
                support_damage = _effective_attack(supporter)
                left_damage += support_damage
                context.log.append(f"{_card_label(supporter)} used Ranged to support {_card_label(card)} for {support_damage} damage.")
        for supporter in _ranged_supporters(context, enemy):
            if _can_attack(supporter, round_number):
                support_damage = _effective_attack(supporter)
                right_damage += support_damage
                context.log.append(f"{_card_label(supporter)} used Ranged to support {_card_label(enemy)} for {support_damage} damage.")
        enemy_taken = _mitigated_damage(enemy, left_damage, enemy_runtime.incoming_damage_reduction)
        card_taken = _mitigated_damage(card, right_damage, card_runtime.incoming_damage_reduction)
        if enemy_taken < left_damage:
            context.log.append(f"{_card_label(enemy)} reduced damage by {left_damage - enemy_taken} with Fortify.")
        if card_taken < right_damage:
            context.log.append(f"{_card_label(card)} reduced damage by {right_damage - card_taken} with Fortify.")
        enemy.current_hp -= enemy_taken
        card.current_hp -= card_taken
        if card_runtime.reflect_damage > 0 and card_taken > 0 and enemy.is_alive:
            enemy.current_hp -= card_runtime.reflect_damage
            context.log.append(f"{_card_label(card)} reflected {card_runtime.reflect_damage} damage back to {_card_label(enemy)}.")
        if enemy_runtime.reflect_damage > 0 and enemy_taken > 0 and card.is_alive:
            card.current_hp -= enemy_runtime.reflect_damage
            context.log.append(f"{_card_label(enemy)} reflected {enemy_runtime.reflect_damage} damage back to {_card_label(card)}.")
        context.log.append(
            f"{_card_label(card)} and {_card_label(enemy)} traded {left_damage}/{right_damage} damage "
            f"({enemy_taken}/{card_taken} after mitigation)."
        )


def _attackers_at_base(context: MatchContext, defender_id: str, track: TrackName) -> list[CardInPlay]:
    attackers: list[CardInPlay] = []
    for card in context.board:
        if not card.is_alive or card.track is not track or card.engaged_with is not None:
            continue
        if defender_id == context.right.player_id and card.owner_id == context.left.player_id and _global_position(card, context.left.player_id) >= TRACK_LENGTH:
            attackers.append(card)
        if defender_id == context.left.player_id and card.owner_id == context.right.player_id and _global_position(card, context.left.player_id) <= 0.0:
            attackers.append(card)
    return attackers


def _resolve_base_attacks(context: MatchContext, round_number: int) -> None:
    for defender_state in (context.left_state, context.right_state):
        for track in (TrackName.FAST, TrackName.SLOW):
            attackers = [card for card in _attackers_at_base(context, defender_state.player_id, track) if _can_attack(card, round_number)]
            if not attackers:
                continue
            target = max(attackers, key=_effective_attack)
            base_runtime = _trigger_base_scripted_ability(
                context,
                defender_state,
                "base_attacked",
                enemy_name=target.definition.name,
            )
            total_damage = 0
            for attacker in attackers:
                runtime = _trigger_scripted_ability(
                    context,
                    _player_state(context, attacker.owner_id),
                    attacker,
                    "attack_base",
                    enemy_name=defender_state.base_card.name,
                )
                total_damage += _effective_attack(attacker) + runtime.attack_bonus + runtime.base_damage_bonus
            total_damage = max(0, total_damage - base_runtime.incoming_damage_reduction)
            defender_state.base_hp -= total_damage
            counterattack = defender_state.base_card.attack + base_runtime.attack_bonus
            target.current_hp -= counterattack
            if base_runtime.reflect_damage > 0:
                target.current_hp -= base_runtime.reflect_damage
                context.log.append(
                    f"{defender_state.display_name}'s base reflected {base_runtime.reflect_damage} damage back to {_card_label(target)}."
                )
            context.log.append(
                f"{defender_state.display_name}'s base took {total_damage} damage on the {track.value} track and counterattacked {_card_label(target)}."
            )


def _cleanup_destroyed(context: MatchContext) -> None:
    destroyed_ids = {card.instance_id for card in context.board if card.current_hp <= 0}
    if not destroyed_ids:
        return
    for card in context.board:
        if card.engaged_with in destroyed_ids:
            card.engaged_with = None
    for card in context.board:
        if card.instance_id in destroyed_ids:
            context.log.append(f"{_card_label(card)} was destroyed.")
    context.board = [card for card in context.board if card.current_hp > 0]


def _round_status_line(context: MatchContext) -> str:
    left = context.left_state
    right = context.right_state
    return (
        f"Status | {left.display_name}: base={left.base_hp}/{left.base_card.hp} cp={left.card_points} "
        f"hand={len(left.hand)} deck={len(left.draw_pile)} discard={len(left.discard_pile)} "
        f"| {right.display_name}: base={right.base_hp}/{right.base_card.hp} cp={right.card_points} "
        f"hand={len(right.hand)} deck={len(right.draw_pile)} discard={len(right.discard_pile)}"
    )


def _winner(context: MatchContext) -> tuple[str | None, str] | None:
    left_dead = context.left_state.base_hp <= 0
    right_dead = context.right_state.base_hp <= 0
    if left_dead and right_dead:
        return None, "both bases destroyed"
    if left_dead:
        return context.right.player_id, "left base destroyed"
    if right_dead:
        return context.left.player_id, "right base destroyed"
    return None


def _create_player_state(bot: PrototypeBot, deck: list[CardDefinition], base: CardDefinition, rng: random.Random) -> PlayerState:
    shuffled_deck = list(deck)
    rng.shuffle(shuffled_deck)
    return PlayerState(
        player_id=bot.profile.player_id,
        display_name=bot.profile.display_name,
        base_card=base,
        base_hp=base.hp,
        card_points=STARTING_CARD_POINTS,
        draw_pile=shuffled_deck,
        discard_pile=[],
        owned_cards=dict(bot.profile.owned_cards),
        owned_bases=dict(bot.profile.owned_bases),
    )


def run_match(
    left: PrototypeBot,
    right: PrototypeBot,
    generator,
    *,
    seed: int,
    max_rounds: int = MAX_MATCH_ROUNDS,
) -> MatchResult:
    rng = random.Random(seed)
    left.ensure_collection(generator)
    right.ensure_collection(generator)
    left_deck = left.build_deck()
    right_deck = right.build_deck()
    context = MatchContext(
        left=left,
        right=right,
        left_state=_create_player_state(left, left_deck, left.choose_base(), rng),
        right_state=_create_player_state(right, right_deck, right.choose_base(), rng),
        board=[],
        rng=rng,
        log=[],
    )
    context.generator = generator  # type: ignore[attr-defined]

    for round_number in range(1, max_rounds + 1):
        context.log.append(f"=== Round {round_number} ===")
        _apply_round_income_and_healing(context)
        _draw_cards(context.left_state, rng, DRAW_COUNT)
        _draw_cards(context.right_state, rng, DRAW_COUNT)
        context.log.append(_round_status_line(context))
        decisions = _decide_rounds(context, round_number)
        _handle_generation(context, decisions)
        _apply_plays(context, decisions, round_number)
        _move_cards(context, round_number)
        _resolve_engagements(context, round_number)
        _resolve_base_attacks(context, round_number)
        _cleanup_destroyed(context)
        outcome = _winner(context)
        if outcome is not None:
            winner_id, reason = outcome
            return MatchResult(
                winner_id=winner_id,
                rounds_played=round_number,
                reason=reason,
                event_log=context.log,
                generated_cards=context.generated_cards,
            )
    left_score = context.left_state.base_hp - context.right_state.base_hp
    winner_id = context.left.player_id if left_score > 0 else context.right.player_id if left_score < 0 else None
    reason = "round limit reached"
    return MatchResult(
        winner_id=winner_id,
        rounds_played=max_rounds,
        reason=reason,
        event_log=context.log,
        generated_cards=context.generated_cards,
    )
