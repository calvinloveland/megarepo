from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass

from .bot_sandbox import BotRunResult, run_bot_action
from .db import Bot, Match, MatchBotLog, MatchHand, MatchResult, Rating, db
from .game_state import make_bot_visible_state
from .ratings import EloConfig, clamp_rating, update_elo_pairwise
from .tournament import MatchConfig, run_match


@dataclass(frozen=True)
class RunnerConfig:
    seats: int = 6
    hands: int = 50
    sleep_s: float = 2.0


def _bot_code(bot: Bot) -> str:
    # Prefer most recent submitted version if present; fallback to current code.
    # This keeps matches stable even if someone edits after submitting.
    if bot.versions:
        return bot.versions[0].code
    return bot.code


def _fallback_action(gs: dict) -> dict:
    legal = {a["type"]: a for a in gs.get("legal_actions", [])}
    if "check" in legal:
        return {"type": "check"}
    if "call" in legal:
        return {"type": "call"}
    return {"type": "fold"}


def _append_block(buf: list[str], block: str, *, max_chars: int = 20_000) -> None:
    if not block:
        return
    buf.append(block)
    joined = "\n".join(buf)
    if len(joined) > max_chars:
        tail = joined[-max_chars:]
        buf.clear()
        buf.append(tail)


def _ensure_rating_rows(bots: list[Bot]) -> None:
    for b in bots:
        if db.session.get(Rating, b.id) is None:
            db.session.add(Rating(bot_id=b.id, rating=1500.0, matches_played=0))
    db.session.commit()


def _select_table(*, bots: list[Bot], cfg: RunnerConfig, seed: int) -> list[Bot]:
    rng = random.Random(seed)

    def sort_key(b: Bot):
        status_pri = 0 if b.status == "submitted" else 1
        r = db.session.get(Rating, b.id)
        played = int(r.matches_played) if r is not None else 0
        return (status_pri, played, rng.random())

    bots.sort(key=sort_key)
    table = bots[: min(cfg.seats, len(bots))]
    rng_seats = random.Random(int(seed) ^ 0x5F37_59DF)
    rng_seats.shuffle(table)
    return table


def _make_decider(logs_by_seat: dict[int, list[str]], errors_by_seat: dict[int, list[str]]):
    def _decide(code_str: str, gs: dict) -> dict:
        res: BotRunResult = run_bot_action(code_str, gs)
        seat = int(gs.get("actor_seat") or 0)
        if res.ok and res.action is not None:
            if res.logs:
                header = f"--- {gs.get('hand_id')} {gs.get('street')} seat={seat} ---\n"
                _append_block(logs_by_seat[seat], header + res.logs.rstrip())
            return res.action
        if res.error:
            header = f"--- {gs.get('hand_id')} {gs.get('street')} seat={seat} ERROR ---\n"
            _append_block(errors_by_seat[seat], header + res.error.rstrip(), max_chars=30_000)
        return _fallback_action(gs)

    return _decide


def _persist_hand_rows(match_id: int, result) -> None:
    for hand_index, hr in enumerate(result.hand_results):
        db.session.add(
            MatchHand(
                match_id=match_id,
                hand_index=int(hand_index),
                hand_seed=int(hr.seed),
                dealer_seat=int(hr.dealer_seat),
                board_json=json.dumps(hr.board),
                actions_json=json.dumps(hr.actions),
                winners_json=json.dumps(hr.winners),
                delta_stacks_json=json.dumps(hr.delta_stacks),
                side_pots_json=json.dumps(hr.side_pots),
            )
        )


def _persist_match_results(match_id: int, table: list[Bot], result) -> None:
    for seat, b in enumerate(table):
        db.session.add(
            MatchResult(
                match_id=match_id,
                bot_id=b.id,
                seat=int(seat),
                hands_played=int(result.hands),
                chips_won=int(result.chips_won[seat]),
            )
        )


def _persist_bot_logs(match_id: int, table: list[Bot], logs_by_seat: dict[int, list[str]], errors_by_seat: dict[int, list[str]]) -> None:
    for seat, b in enumerate(table):
        logs_text = "\n".join(logs_by_seat.get(seat, [])).strip()
        err_text = "\n".join(errors_by_seat.get(seat, [])).strip()
        if logs_text or err_text:
            db.session.add(
                MatchBotLog(
                    match_id=match_id,
                    bot_id=b.id,
                    seat=int(seat),
                    logs=logs_text or None,
                    errors=err_text or None,
                )
            )


def _update_ratings(table: list[Bot], result, cfg: RunnerConfig) -> None:
    rating_rows: list[Rating] = []
    for b in table:
        r = db.session.get(Rating, b.id)
        if r is None:
            r = Rating(bot_id=b.id, rating=1500.0, matches_played=0)
            db.session.add(r)
        rating_rows.append(r)

    old = [float(r.rating) for r in rating_rows]
    scores = [float(x) for x in result.chips_won]
    new = update_elo_pairwise(old, scores, cfg=EloConfig())
    for i, r in enumerate(rating_rows):
        r.rating = clamp_rating(new[i])
        r.matches_played = int(r.matches_played) + 1
        db.session.add(r)


def run_one_match(*, cfg: RunnerConfig, seed: int) -> int | None:
    """Run and persist one match. Returns match_id if a match ran, else None."""

    bots = Bot.query.filter(Bot.status.in_(["submitted", "valid"]))
    bots = bots.order_by(Bot.updated_at.desc()).all()

    if len(bots) < 2:
        return None

    _ensure_rating_rows(bots)
    table = _select_table(bots=bots, cfg=cfg, seed=seed)

    mcfg = MatchConfig(hands=cfg.hands, seats=len(table))

    # Record match row first.
    match = Match(seed=int(seed), hands=int(mcfg.hands), seats=int(mcfg.seats), status="running")
    db.session.add(match)
    db.session.commit()

    try:
        logs_by_seat: dict[int, list[str]] = {i: [] for i in range(len(table))}
        errors_by_seat: dict[int, list[str]] = {i: [] for i in range(len(table))}

        result = run_match(
            bot_codes=[_bot_code(b) for b in table],
            seed=seed,
            match_config=mcfg,
            bot_decide=_make_decider(logs_by_seat, errors_by_seat),
            make_state_for_actor=make_bot_visible_state,
        )

        _persist_hand_rows(int(match.id), result)
        _persist_match_results(int(match.id), table, result)
        _persist_bot_logs(int(match.id), table, logs_by_seat, errors_by_seat)
        db.session.flush()
        _update_ratings(table, result, cfg)

        match.status = "finished"
        db.session.add(match)
        db.session.commit()
        return int(match.id)

    except Exception as e:  # noqa: BLE001
        match.status = "error"
        match.error = str(e)
        db.session.add(match)
        db.session.commit()
        return int(match.id)


def run_forever(cfg: RunnerConfig, *, seed: int | None = None) -> None:
    rng = random.Random(seed)
    while True:
        match_seed = rng.randint(1, 2_000_000_000)
        run_one_match(cfg=cfg, seed=match_seed)
        time.sleep(cfg.sleep_s)
