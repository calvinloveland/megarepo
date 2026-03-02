from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from .game_state import normalize_action
from .poker_eval import best_of_7, compare_best_of_7


@dataclass(frozen=True)
class TableConfig:
    seats: int = 6
    starting_stack: int = 1000
    small_blind: int = 10
    big_blind: int = 20
    max_actions_per_street: int = 200


@dataclass
class PlayerState:
    stack: int
    folded: bool = False
    all_in: bool = False
    hole_cards: list[str] | None = None


@dataclass
class HandResult:
    seed: int
    dealer_seat: int
    board: list[str]
    hole_cards: list[list[str] | None]
    actions: list[dict[str, Any]]
    delta_stacks: list[int]
    final_stacks: list[int]
    winners: list[int]
    side_pots: list[dict[str, Any]]


def _make_deck() -> list[str]:
    ranks = "23456789TJQKA"
    suits = "cdhs"
    return [r + s for r in ranks for s in suits]


def _next_active_seat(seats: int, start: int, is_active) -> int | None:
    for i in range(1, seats + 1):
        s = (start + i) % seats
        if is_active(s):
            return s
    return None


def _iter_order(seats: int, start: int):
    for i in range(seats):
        yield (start + i) % seats


def _count_in_hand(players: list[PlayerState]) -> int:
    return sum(1 for p in players if not p.folded and (p.hole_cards is not None))


def _compute_side_pots(contrib_total: list[int], eligible: list[bool]) -> list[dict[str, Any]]:
    # Standard side pot construction.
    # contrib_total includes folded players (their chips stay in pots),
    # eligible marks who can win (not folded).
    levels = sorted({c for c in contrib_total if c > 0})
    pots: list[dict[str, Any]] = []
    prev = 0
    for lvl in levels:
        involved = [i for i, c in enumerate(contrib_total) if c >= lvl]
        if not involved:
            continue
        size = (lvl - prev) * len(involved)
        elig = [i for i in involved if eligible[i]]
        pots.append({"amount": size, "eligible_seats": elig})
        prev = lvl
    return pots


def _empty_hand_result(seed: int, dealer_seat: int, players: list[PlayerState], actions: list[dict[str, Any]]) -> HandResult:
    final_stacks = [p.stack for p in players]
    return HandResult(
        seed=seed,
        dealer_seat=dealer_seat,
        board=[],
        hole_cards=[p.hole_cards for p in players],
        actions=actions,
        delta_stacks=[0 for _ in players],
        final_stacks=final_stacks,
        winners=[i for i, p in enumerate(players) if p.stack > 0],
        side_pots=[],
    )


def _find_blinds(config: TableConfig, players: list[PlayerState], dealer_seat: int) -> tuple[int | None, int | None]:
    active_players = [i for i in range(config.seats) if players[i].stack > 0]
    if len(active_players) == 2:
        sb_seat = dealer_seat if players[dealer_seat].stack > 0 else active_players[0]
        bb_seat = _next_active_seat(config.seats, sb_seat, lambda s: players[s].stack > 0)
        return sb_seat, bb_seat
    sb_seat = _next_active_seat(config.seats, dealer_seat, lambda s: players[s].stack > 0)
    bb_seat = None if sb_seat is None else _next_active_seat(config.seats, sb_seat, lambda s: players[s].stack > 0)
    return sb_seat, bb_seat


def _can_act(players: list[PlayerState], seat: int) -> bool:
    p = players[seat]
    return (not p.folded) and (p.hole_cards is not None) and (not p.all_in)


def _round_complete(
    players: list[PlayerState],
    contributed_street: list[int],
    current_bet: int,
    acted_since_raise: list[bool],
) -> bool:
    for s, p in enumerate(players):
        if p.folded or p.hole_cards is None or p.all_in:
            continue
        if contributed_street[s] != current_bet or not acted_since_raise[s]:
            return False
    return True


def _next_actor(config: TableConfig, players: list[PlayerState], start_idx: int) -> int | None:
    idx = start_idx
    for _ in range(config.seats):
        if _can_act(players, idx):
            return idx
        idx = (idx + 1) % config.seats
    return None


def _build_legal_actions(
    *,
    seat: int,
    to_call: int,
    current_bet: int,
    last_raise: int,
    contributed_street: list[int],
    players: list[PlayerState],
    config: TableConfig,
) -> list[dict[str, Any]]:
    p = players[seat]
    legal: list[dict[str, Any]] = [{"type": "fold"}]
    if to_call == 0:
        legal.append({"type": "check"})
    else:
        legal.append({"type": "call", "amount": min(to_call, p.stack)})
    if p.stack <= to_call:
        return legal
    min_total = current_bet + max(last_raise, config.big_blind) if current_bet > 0 else config.big_blind
    min_total = max(min_total, current_bet + 1)
    max_total = contributed_street[seat] + p.stack
    if max_total >= min_total:
        legal.append({"type": "raise", "min": int(min_total), "max": int(max_total)})
    return legal


def _apply_call(
    *,
    players: list[PlayerState],
    seat: int,
    to_call: int,
    contributed_street: list[int],
    contrib_total: list[int],
    actions: list[dict[str, Any]],
    street: str,
) -> None:
    p = players[seat]
    pay = min(to_call, p.stack)
    p.stack -= pay
    contributed_street[seat] += pay
    contrib_total[seat] += pay
    if p.stack == 0:
        p.all_in = True
    actions.append({"street": street, "seat": seat, "type": "call", "amount": pay})


def _legal_raise_action(legal: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((a for a in legal if a["type"] == "raise"), None)


def _apply_raise(
    *,
    norm: dict[str, Any],
    legal: list[dict[str, Any]],
    seat: int,
    street: str,
    config: TableConfig,
    players: list[PlayerState],
    contributed_street: list[int],
    contrib_total: list[int],
    acted_since_raise: list[bool],
    actions: list[dict[str, Any]],
    current_bet: int,
) -> tuple[int, int] | None:
    ra = _legal_raise_action(legal)
    if ra is None:
        return None
    raise_to_req = int(norm.get("amount", 0))
    raise_to = max(int(ra["min"]), min(int(ra["max"]), raise_to_req))
    if raise_to <= current_bet:
        raise_to = int(ra["min"])
    p = players[seat]
    pay = min(raise_to - contributed_street[seat], p.stack)
    prev_bet = current_bet
    p.stack -= pay
    contributed_street[seat] += pay
    contrib_total[seat] += pay
    new_bet = max(current_bet, contributed_street[seat])
    new_last_raise = max(1, new_bet - prev_bet)
    if p.stack == 0:
        p.all_in = True
    for s in range(config.seats):
        acted_since_raise[s] = False
    acted_since_raise[seat] = True
    actions.append({"street": street, "seat": seat, "type": "raise", "to": new_bet, "amount": pay})
    return new_bet, new_last_raise


def _apply_fallback_or_check(
    *,
    to_call: int,
    players: list[PlayerState],
    seat: int,
    contributed_street: list[int],
    contrib_total: list[int],
    actions: list[dict[str, Any]],
    street: str,
) -> None:
    if to_call == 0:
        actions.append({"street": street, "seat": seat, "type": "check"})
        return
    _apply_call(
        players=players,
        seat=seat,
        to_call=to_call,
        contributed_street=contributed_street,
        contrib_total=contrib_total,
        actions=actions,
        street=street,
    )


def _apply_action(
    *,
    atype: str,
    norm: dict[str, Any],
    to_call: int,
    players: list[PlayerState],
    seat: int,
    street: str,
    config: TableConfig,
    contributed_street: list[int],
    contrib_total: list[int],
    acted_since_raise: list[bool],
    actions: list[dict[str, Any]],
    legal: list[dict[str, Any]],
    current_bet: int,
    last_raise: int,
) -> tuple[int, int]:
    if atype == "fold":
        players[seat].folded = True
        acted_since_raise[seat] = True
        actions.append({"street": street, "seat": seat, "type": "fold"})
        return current_bet, last_raise
    if atype == "check":
        _apply_fallback_or_check(
            to_call=to_call,
            players=players,
            seat=seat,
            contributed_street=contributed_street,
            contrib_total=contrib_total,
            actions=actions,
            street=street,
        )
        acted_since_raise[seat] = True
        return current_bet, last_raise
    if atype == "call":
        _apply_call(
            players=players,
            seat=seat,
            to_call=to_call,
            contributed_street=contributed_street,
            contrib_total=contrib_total,
            actions=actions,
            street=street,
        )
        acted_since_raise[seat] = True
        return current_bet, last_raise
    if atype == "raise":
        raised = _apply_raise(
            norm=norm,
            legal=legal,
            seat=seat,
            street=street,
            config=config,
            players=players,
            contributed_street=contributed_street,
            contrib_total=contrib_total,
            acted_since_raise=acted_since_raise,
            actions=actions,
            current_bet=current_bet,
        )
        if raised is not None:
            return raised
    _apply_fallback_or_check(
        to_call=to_call,
        players=players,
        seat=seat,
        contributed_street=contributed_street,
        contrib_total=contrib_total,
        actions=actions,
        street=street,
    )
    acted_since_raise[seat] = True
    return current_bet, last_raise


def _build_actor_state(
    *,
    seed: int,
    street: str,
    dealer_seat: int,
    seat: int,
    players: list[PlayerState],
    board: list[str],
    contributed_street: list[int],
    contrib_total: list[int],
    actions: list[dict[str, Any]],
    legal: list[dict[str, Any]],
    make_state_for_actor,
) -> dict[str, Any]:
    return make_state_for_actor(
        seed=seed,
        street=street,
        dealer_seat=dealer_seat,
        actor_seat=seat,
        hole_cards=players[seat].hole_cards or [],
        board_cards=board,
        stacks=[pl.stack for pl in players],
        contributed_this_street=contributed_street,
        contributed_total=contrib_total,
        action_history=actions,
        legal_actions=legal,
        active_seats=[i for i, pl in enumerate(players) if (not pl.folded) and (pl.hole_cards is not None)],
    )


def _normalize_or_default_action(raw_action: Any, to_call: int) -> dict[str, Any]:
    ok, _, norm = normalize_action(raw_action)
    if ok and norm is not None:
        return norm
    return {"type": "check"} if to_call == 0 else {"type": "call"}


def _betting_round_step(
    *,
    config: TableConfig,
    players: list[PlayerState],
    idx: int,
    current_bet: int,
    last_raise: int,
    contributed_street: list[int],
    acted_since_raise: list[bool],
    street: str,
    seed: int,
    dealer_seat: int,
    board: list[str],
    contrib_total: list[int],
    actions: list[dict[str, Any]],
    bot_codes: list[str],
    bot_decide,
    make_state_for_actor,
) -> tuple[int, int, int] | None:
    seat = _next_actor(config, players, idx)
    if seat is None:
        return None
    to_call = max(0, current_bet - contributed_street[seat])
    legal = _build_legal_actions(
        seat=seat,
        to_call=to_call,
        current_bet=current_bet,
        last_raise=last_raise,
        contributed_street=contributed_street,
        players=players,
        config=config,
    )
    game_state = _build_actor_state(
        seed=seed,
        street=street,
        dealer_seat=dealer_seat,
        seat=seat,
        players=players,
        board=board,
        contributed_street=contributed_street,
        contrib_total=contrib_total,
        actions=actions,
        legal=legal,
        make_state_for_actor=make_state_for_actor,
    )
    norm = _normalize_or_default_action(bot_decide(bot_codes[seat], game_state), to_call)
    new_bet, new_raise = _apply_action(
        atype=norm["type"],
        norm=norm,
        to_call=to_call,
        players=players,
        seat=seat,
        street=street,
        config=config,
        contributed_street=contributed_street,
        contrib_total=contrib_total,
        acted_since_raise=acted_since_raise,
        actions=actions,
        legal=legal,
        current_bet=current_bet,
        last_raise=last_raise,
    )
    return seat, new_bet, new_raise


def _round_should_end(
    players: list[PlayerState],
    contributed_street: list[int],
    current_bet: int,
    acted_since_raise: list[bool],
) -> bool:
    if _count_in_hand(players) <= 1:
        return True
    return _round_complete(players, contributed_street, current_bet, acted_since_raise)


def _betting_round(
    *,
    street: str,
    first_to_act: int,
    initial_bet: int,
    initial_last_raise: int,
    config: TableConfig,
    players: list[PlayerState],
    board: list[str],
    actions: list[dict[str, Any]],
    contrib_total: list[int],
    initial_stacks: list[int],
    sb_seat: int,
    bb_seat: int,
    seed: int,
    dealer_seat: int,
    bot_codes: list[str],
    bot_decide,
    make_state_for_actor,
) -> None:
    contributed_street = [0 for _ in range(config.seats)]
    if street == "preflop":
        contributed_street[sb_seat] = min(config.small_blind, initial_stacks[sb_seat])
        contributed_street[bb_seat] = min(config.big_blind, initial_stacks[bb_seat])

    current_bet = initial_bet
    last_raise = initial_last_raise
    acted_since_raise = [False for _ in range(config.seats)]
    idx = first_to_act
    action_count = 0

    if bot_decide is None or make_state_for_actor is None:
        raise ValueError("bot_decide and make_state_for_actor must be provided")

    while True:
        if _round_should_end(players, contributed_street, current_bet, acted_since_raise):
            return
        step = _betting_round_step(
            config=config,
            players=players,
            idx=idx,
            current_bet=current_bet,
            last_raise=last_raise,
            contributed_street=contributed_street,
            acted_since_raise=acted_since_raise,
            street=street,
            seed=seed,
            dealer_seat=dealer_seat,
            board=board,
            contrib_total=contrib_total,
            actions=actions,
            bot_codes=bot_codes,
            bot_decide=bot_decide,
            make_state_for_actor=make_state_for_actor,
        )
        if step is None:
            return
        seat, current_bet, last_raise = step
        action_count += 1
        if action_count >= config.max_actions_per_street:
            return
        idx = (seat + 1) % config.seats


def _deal_board(deck: list[str], board: list[str], n: int) -> None:
    deck.pop()
    for _ in range(n):
        board.append(deck.pop())


def _run_postflop_round(
    *,
    street: str,
    cards_to_deal: int,
    deck: list[str],
    board: list[str],
    config: TableConfig,
    players: list[PlayerState],
    dealer_seat: int,
    actions: list[dict[str, Any]],
    contrib_total: list[int],
    initial_stacks: list[int],
    sb_seat: int,
    bb_seat: int,
    seed: int,
    bot_codes: list[str],
    bot_decide,
    make_state_for_actor,
) -> None:
    if _count_in_hand(players) <= 1:
        return
    _deal_board(deck, board, cards_to_deal)
    first_postflop = _next_active_seat(config.seats, dealer_seat, lambda s: not players[s].folded and not players[s].all_in)
    if first_postflop is None:
        return
    _betting_round(
        street=street,
        first_to_act=first_postflop,
        initial_bet=0,
        initial_last_raise=config.big_blind,
        config=config,
        players=players,
        board=board,
        actions=actions,
        contrib_total=contrib_total,
        initial_stacks=initial_stacks,
        sb_seat=sb_seat,
        bb_seat=bb_seat,
        seed=seed,
        dealer_seat=dealer_seat,
        bot_codes=bot_codes,
        bot_decide=bot_decide,
        make_state_for_actor=make_state_for_actor,
    )


def _showdown_board(board: list[str], deck: list[str]) -> list[str]:
    board5 = board + [deck.pop() for _ in range(max(0, 5 - len(board)))]
    return board5[:5]


def _best_seats_for_pot(players: list[PlayerState], board5: list[str], elig_seats: list[int]) -> list[int]:
    best = elig_seats[0]
    tied = [best]
    for s in elig_seats[1:]:
        best_cards = (players[best].hole_cards or []) + board5
        seat_cards = (players[s].hole_cards or []) + board5
        cmp = compare_best_of_7(seat_cards, best_cards)
        if cmp > 0:
            best = s
            tied = [s]
        elif cmp == 0:
            tied.append(s)
    return tied


def _award_tied_players(players: list[PlayerState], tied: list[int], amount: int) -> None:
    share = amount // len(tied)
    rem = amount % len(tied)
    for i, seat in enumerate(tied):
        players[seat].stack += share + (1 if i < rem else 0)


def _award_pots(players: list[PlayerState], board: list[str], deck: list[str], contrib_total: list[int]) -> tuple[list[int], list[dict[str, Any]]]:
    eligible = [(not p.folded) and (p.hole_cards is not None) for p in players]
    remaining = [i for i, ok in enumerate(eligible) if ok]
    side_pots = _compute_side_pots(contrib_total, eligible)
    if len(remaining) == 1:
        winner = remaining[0]
        players[winner].stack += sum(contrib_total)
        return [winner], side_pots

    board5 = _showdown_board(board, deck)
    all_winners: set[int] = set()
    for pot in side_pots:
        elig_seats = pot["eligible_seats"]
        if not elig_seats:
            continue
        tied = _best_seats_for_pot(players, board5, elig_seats)
        _award_tied_players(players, tied, int(pot["amount"]))
        pot["winner_seats"] = tied
        all_winners.update(tied)
    return sorted(all_winners) if all_winners else remaining, side_pots


def _normalize_inputs(
    bot_codes: list[str],
    config: TableConfig | None,
    initial_stacks: list[int] | None,
) -> tuple[TableConfig, list[int]]:
    cfg = config or TableConfig(seats=len(bot_codes))
    if len(bot_codes) != cfg.seats:
        raise ValueError("bot_codes length must equal config.seats")
    stacks = initial_stacks if initial_stacks is not None else [cfg.starting_stack for _ in range(cfg.seats)]
    if len(stacks) != cfg.seats:
        raise ValueError("initial_stacks length must equal config.seats")
    return cfg, stacks


def _init_players(config: TableConfig, initial_stacks: list[int], deck: list[str]) -> list[PlayerState]:
    players = [PlayerState(stack=int(initial_stacks[i])) for i in range(config.seats)]
    for seat in range(config.seats):
        if players[seat].stack > 0:
            players[seat].hole_cards = [deck.pop(), deck.pop()]
    return players


def _run_preflop_round(
    *,
    config: TableConfig,
    players: list[PlayerState],
    bb_seat: int,
    board: list[str],
    actions: list[dict[str, Any]],
    contrib_total: list[int],
    initial_stacks: list[int],
    sb_seat: int,
    seed: int,
    dealer_seat: int,
    bot_codes: list[str],
    bot_decide,
    make_state_for_actor,
) -> None:
    first_preflop = _next_active_seat(
        config.seats,
        bb_seat,
        lambda s: not players[s].folded and not players[s].all_in and players[s].hole_cards is not None,
    )
    if first_preflop is None:
        return
    _betting_round(
        street="preflop",
        first_to_act=first_preflop,
        initial_bet=config.big_blind,
        initial_last_raise=config.big_blind,
        config=config,
        players=players,
        board=board,
        actions=actions,
        contrib_total=contrib_total,
        initial_stacks=initial_stacks,
        sb_seat=sb_seat,
        bb_seat=bb_seat,
        seed=seed,
        dealer_seat=dealer_seat,
        bot_codes=bot_codes,
        bot_decide=bot_decide,
        make_state_for_actor=make_state_for_actor,
    )


def _run_all_postflop_rounds(
    *,
    deck: list[str],
    board: list[str],
    config: TableConfig,
    players: list[PlayerState],
    dealer_seat: int,
    actions: list[dict[str, Any]],
    contrib_total: list[int],
    initial_stacks: list[int],
    sb_seat: int,
    bb_seat: int,
    seed: int,
    bot_codes: list[str],
    bot_decide,
    make_state_for_actor,
) -> None:
    for street, cards_to_deal in (("flop", 3), ("turn", 1), ("river", 1)):
        _run_postflop_round(
            street=street,
            cards_to_deal=cards_to_deal,
            deck=deck,
            board=board,
            config=config,
            players=players,
            dealer_seat=dealer_seat,
            actions=actions,
            contrib_total=contrib_total,
            initial_stacks=initial_stacks,
            sb_seat=sb_seat,
            bb_seat=bb_seat,
            seed=seed,
            bot_codes=bot_codes,
            bot_decide=bot_decide,
            make_state_for_actor=make_state_for_actor,
        )


def simulate_hand(
    bot_codes: list[str],
    seed: int,
    config: TableConfig | None = None,
    dealer_seat: int = 0,
    initial_stacks: list[int] | None = None,
    bot_decide=None,
    make_state_for_actor=None,
) -> HandResult:
    """Simulate a single multi-player no-limit Hold'em hand.

    This engine is intentionally minimal but real:
    - blinds
    - betting rounds with fold/check/call/raise
    - all-in and side pots
    - showdown via 7-card evaluator

    `bot_decide(code, game_state) -> dict` and `make_state_for_actor(...) -> dict`
    are injected by the web layer so we can keep this module pure.
    """

    config, initial_stacks = _normalize_inputs(bot_codes, config, initial_stacks)

    rng = random.Random(seed)
    deck = _make_deck()
    rng.shuffle(deck)
    players = _init_players(config, initial_stacks, deck)

    actions: list[dict[str, Any]] = []
    contrib_total = [0 for _ in range(config.seats)]

    def post_blind(seat: int, kind: str, amount: int) -> None:
        pay = min(amount, players[seat].stack)
        players[seat].stack -= pay
        contrib_total[seat] += pay
        if players[seat].stack == 0:
            players[seat].all_in = True
        actions.append({"street": "preflop", "seat": seat, "type": kind, "amount": pay})

    active_players = [i for i in range(config.seats) if players[i].stack > 0]
    if len(active_players) < 2:
        return _empty_hand_result(seed, dealer_seat, players, actions)

    sb_seat, bb_seat = _find_blinds(config, players, dealer_seat)
    if sb_seat is None or bb_seat is None:
        return _empty_hand_result(seed, dealer_seat, players, actions)

    post_blind(sb_seat, "post_sb", config.small_blind)
    post_blind(bb_seat, "post_bb", config.big_blind)
    board: list[str] = []

    _run_preflop_round(
        config=config,
        players=players,
        bb_seat=bb_seat,
        board=board,
        actions=actions,
        contrib_total=contrib_total,
        initial_stacks=initial_stacks,
        sb_seat=sb_seat,
        seed=seed,
        dealer_seat=dealer_seat,
        bot_codes=bot_codes,
        bot_decide=bot_decide,
        make_state_for_actor=make_state_for_actor,
    )

    _run_all_postflop_rounds(
        deck=deck,
        board=board,
        config=config,
        players=players,
        dealer_seat=dealer_seat,
        actions=actions,
        contrib_total=contrib_total,
        initial_stacks=initial_stacks,
        sb_seat=sb_seat,
        bb_seat=bb_seat,
        seed=seed,
        bot_codes=bot_codes,
        bot_decide=bot_decide,
        make_state_for_actor=make_state_for_actor,
    )

    winners, side_pots = _award_pots(players, board, deck, contrib_total)

    final_stacks = [p.stack for p in players]
    delta = [final_stacks[i] - int(initial_stacks[i]) for i in range(config.seats)]

    return HandResult(
        seed=seed,
        dealer_seat=dealer_seat,
        board=board,
        hole_cards=[p.hole_cards for p in players],
        actions=actions,
        delta_stacks=delta,
        final_stacks=final_stacks,
        winners=winners,
        side_pots=side_pots,
    )
