from __future__ import annotations

import itertools
from pathlib import Path
from statistics import mean
from typing import Any

from .bots import PrototypeBot, create_bot_roster
from .engine import (
    build_view,
    create_match_context,
    deserialize_context,
    outcome_for_round,
    prepare_round,
    resolve_round,
    run_match,
    serialize_context,
)
from .generation import get_generator
from .models import DECK_SIZE, CardDefinition, CardKind, MatchResult, PlannedPlay, RoundDecision, TrackName
from .storage import (
    StoredDeck,
    StoredLiveMatch,
    active_deck,
    default_db_path,
    hydrate_bot_collection,
    init_db,
    list_decks,
    list_live_matches,
    list_matches,
    load_deck,
    load_live_match,
    load_match,
    load_owned_cards,
    owner_ids,
    save_bot_collection,
    save_card,
    save_deck,
    save_live_match,
    save_match,
    set_active_deck,
)

DEFAULT_BOT_IDS = ("alpha", "beta", "gamma")
DEFAULT_HUMAN_IDS = ("player-one", "player-two")
DEFAULT_OWNER_IDS = DEFAULT_BOT_IDS + DEFAULT_HUMAN_IDS

_DISPLAY_NAMES = {
    "alpha": "Alpha Atelier",
    "beta": "Beta Bastion",
    "gamma": "Gamma Blitz",
    "player-one": "Player One",
    "player-two": "Player Two",
}
_PERSONAS = {
    "alpha": "inventor",
    "beta": "guardian",
    "gamma": "aggressive",
    "player-one": "inventor",
    "player-two": "guardian",
}


def _display_name(owner_id: str) -> str:
    return _DISPLAY_NAMES.get(owner_id, owner_id.replace("-", " ").title())


def _persona(owner_id: str) -> str:
    return _PERSONAS.get(owner_id, "inventor")


def _make_profile(owner_id: str, *, seed: int) -> PrototypeBot:
    return PrototypeBot(owner_id, _display_name(owner_id), _persona(owner_id), seed=seed)


def _hydrated_profile(owner_id: str, *, seed: int, db_path: Path) -> PrototypeBot:
    bot = _make_profile(owner_id, seed=seed)
    hydrate_bot_collection(bot, path=db_path)
    return bot


def _persist_player_collection(player_state, *, db_path: Path) -> None:
    for card in player_state.owned_cards.values():
        save_card(card, path=db_path)
    for base in player_state.owned_bases.values():
        save_card(base, path=db_path)


def _serialize_decision(decision: RoundDecision) -> dict[str, Any]:
    return {
        "generate_prompt": decision.generate_prompt,
        "plays": [
            {
                "card_id": play.card_id,
                "track": play.track.value,
                "stationary": play.stationary,
            }
            for play in decision.plays
        ],
    }


def _deserialize_decision(payload: dict[str, Any]) -> RoundDecision:
    return RoundDecision(
        generate_prompt=None if payload.get("generate_prompt") in (None, "") else str(payload["generate_prompt"]),
        plays=tuple(
            PlannedPlay(
                card_id=str(play["card_id"]),
                track=TrackName(str(play["track"])),
                stationary=bool(play.get("stationary", False)),
            )
            for play in payload.get("plays", [])
        ),
    )


def _deck_summary(deck: StoredDeck | None, collection: tuple[dict[str, CardDefinition], dict[str, CardDefinition]]) -> dict[str, Any] | None:
    if deck is None:
        return None
    owned_cards, owned_bases = collection
    return {
        "deck_id": deck.deck_id,
        "name": deck.name,
        "base_card_id": deck.base_card_id,
        "base": owned_bases.get(deck.base_card_id),
        "cards": [owned_cards[card_id] for card_id in deck.card_ids if card_id in owned_cards],
        "is_active": deck.is_active,
    }


def ensure_builtin_collection(
    owner_id: str,
    *,
    seed: int,
    generator_name: str,
    db_path: Path | None = None,
) -> None:
    resolved_db = db_path or default_db_path()
    init_db(resolved_db)
    bot = _hydrated_profile(owner_id, seed=seed, db_path=resolved_db)
    if bot.profile.owned_cards and bot.profile.owned_bases:
        return
    generator = get_generator(generator_name, seed=seed)
    bot.ensure_collection(generator)
    save_bot_collection(bot, path=resolved_db)


def ensure_default_deck(
    owner_id: str,
    *,
    seed: int = 1,
    generator_name: str = "deterministic",
    db_path: Path | None = None,
) -> StoredDeck:
    resolved_db = db_path or default_db_path()
    ensure_builtin_collection(owner_id, seed=seed, generator_name=generator_name, db_path=resolved_db)
    current = active_deck(owner_id, path=resolved_db)
    if current is not None:
        return current
    bot = _hydrated_profile(owner_id, seed=seed, db_path=resolved_db)
    deck_cards = bot.build_deck()
    base = bot.choose_base()
    deck_id = save_deck(
        owner_id=owner_id,
        name="Starter Deck",
        base_card_id=base.card_id,
        card_ids=[card.card_id for card in deck_cards[:DECK_SIZE]],
        path=resolved_db,
        active=True,
    )
    saved = load_deck(deck_id, path=resolved_db)
    if saved is None:
        raise RuntimeError("Failed to create default deck.")
    return saved


def _load_collection(owner_id: str, *, db_path: Path, ensure_seed: bool = True) -> tuple[dict[str, CardDefinition], dict[str, CardDefinition]]:
    if ensure_seed:
        ensure_builtin_collection(owner_id, seed=1, generator_name="deterministic", db_path=db_path)
    return load_owned_cards(owner_id, path=db_path)


def load_collection_result(
    *,
    owner_id: str,
    db_path: Path | None = None,
    ensure_seed: bool = True,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    owned_cards, owned_bases = _load_collection(owner_id, db_path=resolved_db, ensure_seed=ensure_seed)
    decks = list_decks(owner_id, path=resolved_db)
    return {
        "owner_id": owner_id,
        "display_name": _display_name(owner_id),
        "bases": [
            {
                "card_id": base.card_id,
                "kind": base.kind.value,
                "owner_id": base.owner_id,
                "name": base.name,
                "theme": base.theme,
                "hp": base.hp,
                "attack": base.attack,
                "current_hp": base.hp,
                "income": base.income,
                "speed": base.speed,
                "attack_range": base.attack_range,
                "keywords": list(base.keywords),
                "ability_summary": base.ability_summary,
            }
            for base in owned_bases.values()
        ],
        "cards": [
            {
                "card_id": card.card_id,
                "kind": card.kind.value,
                "owner_id": card.owner_id,
                "name": card.name,
                "theme": card.theme,
                "cpc": card.cpc,
                "hp": card.hp,
                "current_hp": card.hp,
                "attack": card.attack,
                "speed": card.speed,
                "attack_range": card.attack_range,
                "keywords": list(card.keywords),
                "ability_summary": card.ability_summary,
            }
            for card in owned_cards.values()
        ],
        "decks": [
            {
                "deck_id": deck.deck_id,
                "name": deck.name,
                "base_card_id": deck.base_card_id,
                "card_ids": list(deck.card_ids),
                "is_active": deck.is_active,
            }
            for deck in decks
        ],
    }


def deck_builder_result(
    *,
    owner_id: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    ensure_default_deck(owner_id, db_path=resolved_db)
    collection = _load_collection(owner_id, db_path=resolved_db, ensure_seed=True)
    decks = list_decks(owner_id, path=resolved_db)
    return {
        "owner_id": owner_id,
        "display_name": _display_name(owner_id),
        "owned_cards": list(collection[0].values()),
        "owned_bases": list(collection[1].values()),
        "decks": [_deck_summary(deck, collection) for deck in decks],
        "active_deck": _deck_summary(next((deck for deck in decks if deck.is_active), None), collection),
        "deck_size": DECK_SIZE,
    }


def save_deck_result(
    *,
    owner_id: str,
    name: str,
    base_card_id: str,
    card_ids: list[str],
    db_path: Path | None = None,
    deck_id: int | None = None,
    activate: bool = True,
) -> int:
    resolved_db = db_path or default_db_path()
    ensure_builtin_collection(owner_id, seed=1, generator_name="deterministic", db_path=resolved_db)
    owned_cards, owned_bases = load_owned_cards(owner_id, path=resolved_db)
    trimmed_card_ids = [card_id for card_id in card_ids if card_id][:DECK_SIZE]
    if len(trimmed_card_ids) != DECK_SIZE:
        raise ValueError(f"Choose exactly {DECK_SIZE} cards for a deck.")
    for card_id in trimmed_card_ids:
        if card_id not in owned_cards:
            raise ValueError(f"Unknown card in deck: {card_id}")
    if base_card_id not in owned_bases:
        raise ValueError(f"Unknown base card: {base_card_id}")
    return save_deck(
        owner_id=owner_id,
        name=name.strip() or "Custom Deck",
        base_card_id=base_card_id,
        card_ids=trimmed_card_ids,
        path=resolved_db,
        deck_id=deck_id,
        active=activate,
    )


def activate_deck_result(*, owner_id: str, deck_id: int, db_path: Path | None = None) -> None:
    resolved_db = db_path or default_db_path()
    set_active_deck(owner_id, deck_id, path=resolved_db)


def known_owner_ids(*, db_path: Path | None = None) -> list[str]:
    resolved_db = db_path or default_db_path()
    init_db(resolved_db)
    discovered = owner_ids(path=resolved_db)
    merged = list(dict.fromkeys([*DEFAULT_OWNER_IDS, *discovered]))
    for owner_id in merged:
        ensure_builtin_collection(owner_id, seed=1, generator_name="deterministic", db_path=resolved_db)
    return merged


def run_saved_match(
    *,
    seed: int,
    generator_name: str,
    left_id: str,
    right_id: str,
    db_path: Path | None = None,
) -> tuple[int, MatchResult]:
    resolved_db = db_path or default_db_path()
    if left_id == right_id:
        raise ValueError("Choose two different players.")
    left = _hydrated_profile(left_id, seed=seed, db_path=resolved_db)
    right = _hydrated_profile(right_id, seed=seed + 1, db_path=resolved_db)
    generator = get_generator(generator_name, seed=seed)
    result = run_match(left, right, generator, seed=seed)
    save_bot_collection(left, path=resolved_db)
    save_bot_collection(right, path=resolved_db)
    match_id = save_match(
        seed=seed,
        generator=generator_name,
        left_player=left.player_id,
        right_player=right.player_id,
        result=result,
        path=resolved_db,
    )
    return match_id, result


def run_playtest_batch(
    *,
    matches: int,
    seed: int,
    generator_name: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    generator = get_generator(generator_name, seed=seed)
    roster = create_bot_roster(seed)
    for bot in roster:
        hydrate_bot_collection(bot, path=resolved_db)
        bot.ensure_collection(generator)
    pairings = list(itertools.combinations(range(len(roster)), 2))
    results: list[MatchResult] = []
    pairing_results: dict[str, dict[str, int]] = {}
    for index in range(matches):
        left_index, right_index = pairings[index % len(pairings)]
        left = roster[left_index]
        right = roster[right_index]
        result = run_match(left, right, generator, seed=seed + index)
        save_bot_collection(left, path=resolved_db)
        save_bot_collection(right, path=resolved_db)
        save_match(
            seed=seed + index,
            generator=generator_name,
            left_player=left.player_id,
            right_player=right.player_id,
            result=result,
            path=resolved_db,
        )
        results.append(result)
        pairing_key = f"{left.player_id}-vs-{right.player_id}"
        pairing_results.setdefault(pairing_key, {"draw": 0, left.player_id: 0, right.player_id: 0})
        pairing_results[pairing_key][result.winner_id or "draw"] += 1
    wins = {"draw": 0}
    for bot in roster:
        wins[bot.player_id] = 0
    for result in results:
        wins[result.winner_id or "draw"] += 1
    return {
        "matches": matches,
        "generator": generator_name,
        "average_rounds": round(mean(result.rounds_played for result in results), 2) if results else 0.0,
        "average_generated_cards": round(mean(result.generated_cards for result in results), 2) if results else 0.0,
        "wins": wins,
        "pairings": pairing_results,
    }


def generate_card_result(
    *,
    prompt: str,
    kind: CardKind,
    generator_name: str,
    owner_id: str,
    db_path: Path | None = None,
    save: bool = False,
) -> CardDefinition:
    resolved_db = db_path or default_db_path()
    init_db(resolved_db)
    generator = get_generator(generator_name, seed=1)
    card = generator.generate_card(owner_id, prompt, kind=kind)
    if save:
        save_card(card, path=resolved_db)
    return card


def recent_matches(limit: int = 10, db_path: Path | None = None):
    return list_matches(limit=limit, path=db_path or default_db_path())


def stored_match(match_id: int, db_path: Path | None = None):
    return load_match(match_id, path=db_path or default_db_path())


def _materialize_deck(owner_id: str, deck_id: int | None, *, seed: int, db_path: Path) -> tuple[StoredDeck, list[CardDefinition], CardDefinition]:
    ensure_default_deck(owner_id, seed=seed, db_path=db_path)
    deck = active_deck(owner_id, path=db_path) if deck_id is None else load_deck(deck_id, path=db_path)
    if deck is None:
        raise ValueError(f"No deck found for {owner_id}.")
    owned_cards, owned_bases = load_owned_cards(owner_id, path=db_path)
    cards = [owned_cards[card_id] for card_id in deck.card_ids if card_id in owned_cards]
    if len(cards) != len(deck.card_ids):
        raise ValueError(f"Deck {deck.name} references missing cards.")
    if deck.base_card_id not in owned_bases:
        raise ValueError(f"Deck {deck.name} references a missing base.")
    return deck, cards, owned_bases[deck.base_card_id]


def _player_spec(owner_id: str, controller: str, *, deck_id: int | None, seed: int, db_path: Path) -> dict[str, Any]:
    ensure_builtin_collection(owner_id, seed=seed, generator_name="deterministic", db_path=db_path)
    deck, cards, base = _materialize_deck(owner_id, deck_id, seed=seed, db_path=db_path)
    owned_cards, owned_bases = load_owned_cards(owner_id, path=db_path)
    return {
        "owner_id": owner_id,
        "display_name": _display_name(owner_id),
        "controller": controller,
        "persona": _persona(owner_id),
        "deck_id": deck.deck_id,
        "deck_name": deck.name,
        "deck_cards": cards,
        "base_card": base,
        "owned_cards": owned_cards,
        "owned_bases": owned_bases,
    }


def _rebuild_ai(player_spec: dict[str, Any], *, seed: int, player_state) -> PrototypeBot:
    bot = PrototypeBot(player_spec["owner_id"], player_spec["display_name"], player_spec["persona"], seed=seed)
    bot.profile.owned_cards = dict(player_state.owned_cards)
    bot.profile.owned_bases = dict(player_state.owned_bases)
    return bot


def _maybe_fill_ai_decisions(state: dict[str, Any]) -> dict[str, Any]:
    context = deserialize_context(state["context"])
    pending = dict(state["pending_decisions"])
    for seat_name in ("left", "right"):
        spec = state[seat_name]
        player_id = spec["owner_id"]
        if spec["controller"] != "ai" or player_id in pending:
            continue
        player_state = context.left_state if context.left.player_id == player_id else context.right_state
        ai = _rebuild_ai(spec, seed=state["seed"] + state["round_number"], player_state=player_state)
        pending[player_id] = _serialize_decision(build_ai_decision(ai, context, round_number=state["round_number"]))
    state["pending_decisions"] = pending
    return state


def build_ai_decision(bot: PrototypeBot, context, *, round_number: int) -> RoundDecision:
    return bot.decide_round(build_view(context, bot.player_id, round_number))


def _persist_live_state(record: StoredLiveMatch, state: dict[str, Any], *, db_path: Path) -> int:
    return save_live_match(
        mode=record.mode,
        status=state["status"],
        seed=record.seed,
        generator=record.generator,
        left_player=record.left_player,
        right_player=record.right_player,
        state=state,
        path=db_path,
        match_id=record.match_id,
    )


def _advance_if_ready(record: StoredLiveMatch, *, db_path: Path) -> dict[str, Any]:
    state = _maybe_fill_ai_decisions(dict(record.state))
    left_ready = state["left"]["owner_id"] in state["pending_decisions"]
    right_ready = state["right"]["owner_id"] in state["pending_decisions"]
    if not (left_ready and right_ready):
        _persist_live_state(record, state, db_path=db_path)
        return state
    context = deserialize_context(state["context"])
    decisions = {
        player_id: _deserialize_decision(payload)
        for player_id, payload in state["pending_decisions"].items()
    }
    generator = get_generator(record.generator, seed=record.seed)
    resolve_round(context, decisions, round_number=state["round_number"], generator=generator)
    _persist_player_collection(context.left_state, db_path=db_path)
    _persist_player_collection(context.right_state, db_path=db_path)
    result = outcome_for_round(context, state["round_number"], state["max_rounds"])
    if result is not None:
        match_id = save_match(
            seed=record.seed,
            generator=record.generator,
            left_player=record.left_player,
            right_player=record.right_player,
            result=result,
            path=db_path,
        )
        state["status"] = "complete"
        state["result"] = {
            "winner_id": result.winner_id,
            "rounds_played": result.rounds_played,
            "reason": result.reason,
            "generated_cards": result.generated_cards,
            "saved_match_id": match_id,
        }
        state["context"] = serialize_context(context)
        state["pending_decisions"] = {}
        _persist_live_state(record, state, db_path=db_path)
        return state
    state["round_number"] += 1
    state["pending_decisions"] = {}
    prepare_round(context, state["round_number"])
    state["context"] = serialize_context(context)
    _persist_live_state(record, state, db_path=db_path)
    return state


def create_live_match(
    *,
    mode: str,
    left_owner_id: str,
    right_owner_id: str,
    left_controller: str,
    right_controller: str,
    generator_name: str,
    seed: int,
    db_path: Path | None = None,
    left_deck_id: int | None = None,
    right_deck_id: int | None = None,
    max_rounds: int = 18,
) -> int:
    resolved_db = db_path or default_db_path()
    if left_owner_id == right_owner_id:
        raise ValueError("Choose two different players.")
    left = _player_spec(left_owner_id, left_controller, deck_id=left_deck_id, seed=seed, db_path=resolved_db)
    right = _player_spec(right_owner_id, right_controller, deck_id=right_deck_id, seed=seed + 1, db_path=resolved_db)
    context = create_match_context(
        seed=seed,
        left_id=left["owner_id"],
        left_name=left["display_name"],
        left_deck=left["deck_cards"],
        left_base=left["base_card"],
        left_owned_cards=left["owned_cards"],
        left_owned_bases=left["owned_bases"],
        right_id=right["owner_id"],
        right_name=right["display_name"],
        right_deck=right["deck_cards"],
        right_base=right["base_card"],
        right_owned_cards=right["owned_cards"],
        right_owned_bases=right["owned_bases"],
    )
    prepare_round(context, 1)
    state = {
        "status": "active",
        "mode": mode,
        "round_number": 1,
        "max_rounds": max_rounds,
        "generator": generator_name,
        "seed": seed,
        "left": {key: value for key, value in left.items() if key not in {"deck_cards", "base_card", "owned_cards", "owned_bases"}},
        "right": {key: value for key, value in right.items() if key not in {"deck_cards", "base_card", "owned_cards", "owned_bases"}},
        "pending_decisions": {},
        "context": serialize_context(context),
        "result": None,
    }
    return save_live_match(
        mode=mode,
        status="active",
        seed=seed,
        generator=generator_name,
        left_player=left_owner_id,
        right_player=right_owner_id,
        state=state,
        path=resolved_db,
    )


def submit_live_turn(
    *,
    match_id: int,
    player_id: str,
    prompt: str,
    plays: list[dict[str, Any]],
    db_path: Path | None = None,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    record = load_live_match(match_id, path=resolved_db)
    if record is None:
        raise ValueError("Live match not found.")
    state = dict(record.state)
    if state["status"] != "active":
        raise ValueError("This match is already complete.")
    player_spec = next((state[seat] for seat in ("left", "right") if state[seat]["owner_id"] == player_id), None)
    if player_spec is None or player_spec["controller"] != "human":
        raise ValueError("Only human players can submit turns.")
    if player_id in state["pending_decisions"]:
        raise ValueError("That player has already locked in a turn.")
    context = deserialize_context(state["context"])
    view = build_view(context, player_id, state["round_number"])
    hand_ids = {card.card_id for card in view.own_hand}
    chosen_plays: list[PlannedPlay] = []
    for play in plays[:2]:
        card_id = str(play["card_id"]).strip()
        if not card_id:
            continue
        if card_id not in hand_ids:
            raise ValueError(f"{card_id} is not in hand.")
        if any(existing.card_id == card_id for existing in chosen_plays):
            raise ValueError("Choose each card at most once.")
        chosen_plays.append(
            PlannedPlay(
                card_id=card_id,
                track=TrackName(str(play["track"])),
                stationary=bool(play.get("stationary", False)),
            )
        )
    state["pending_decisions"][player_id] = _serialize_decision(
        RoundDecision(generate_prompt=prompt.strip() or None, plays=tuple(chosen_plays))
    )
    _persist_live_state(record, state, db_path=resolved_db)
    refreshed = load_live_match(match_id, path=resolved_db)
    if refreshed is None:
        raise RuntimeError("Live match disappeared after saving.")
    return _advance_if_ready(refreshed, db_path=resolved_db)


def advance_live_match(*, match_id: int, db_path: Path | None = None) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    record = load_live_match(match_id, path=resolved_db)
    if record is None:
        raise ValueError("Live match not found.")
    if record.state["status"] != "active":
        return record.state
    return _advance_if_ready(record, db_path=resolved_db)


def autoplay_live_match(*, match_id: int, db_path: Path | None = None) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    state = advance_live_match(match_id=match_id, db_path=resolved_db)
    while state["status"] == "active" and state["left"]["controller"] == "ai" and state["right"]["controller"] == "ai":
        state = advance_live_match(match_id=match_id, db_path=resolved_db)
    return state


def live_match_result(
    *,
    match_id: int,
    viewer_id: str | None = None,
    db_path: Path | None = None,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    record = load_live_match(match_id, path=resolved_db)
    if record is None:
        raise ValueError("Live match not found.")
    state = dict(record.state)
    viewer = viewer_id
    if viewer is None:
        viewer = next(
            (
                state[seat]["owner_id"]
                for seat in ("left", "right")
                if state[seat]["controller"] == "human"
            ),
            state["left"]["owner_id"],
        )
    context = deserialize_context(state["context"])
    pending_ids = set(state["pending_decisions"])
    viewer_view = None
    if viewer in {state["left"]["owner_id"], state["right"]["owner_id"]}:
        seat = "left" if state["left"]["owner_id"] == viewer else "right"
        if state[seat]["controller"] == "human":
            viewer_view = build_view(context, viewer, state["round_number"])
    return {
        "match_id": record.match_id,
        "mode": record.mode,
        "status": state["status"],
        "seed": record.seed,
        "generator": record.generator,
        "round_number": state["round_number"],
        "max_rounds": state["max_rounds"],
        "viewer_id": viewer,
        "viewer_view": viewer_view,
        "left": state["left"],
        "right": state["right"],
        "pending_players": [player_id for player_id in pending_ids],
        "can_advance": state["status"] == "active" and state["left"]["controller"] == "ai" and state["right"]["controller"] == "ai",
        "can_autoplay": state["status"] == "active" and state["left"]["controller"] == "ai" and state["right"]["controller"] == "ai",
        "result": state["result"],
        "event_log": list(context.log),
        "board": build_view(context, state["left"]["owner_id"], state["round_number"]).board,
    }


def recent_live_matches_result(limit: int = 20, db_path: Path | None = None) -> list[dict[str, Any]]:
    resolved_db = db_path or default_db_path()
    return [
        {
            "match_id": record.match_id,
            "mode": record.mode,
            "status": record.status,
            "seed": record.seed,
            "generator": record.generator,
            "left_player": record.left_player,
            "right_player": record.right_player,
            "round_number": int(record.state.get("round_number", 1)),
            "result": record.state.get("result"),
        }
        for record in list_live_matches(limit=limit, path=resolved_db)
    ]
