from __future__ import annotations

import re
import time
from typing import Any, Iterable

from .manifold_api import ManifoldClient
from .models import ActorProfile, CommentSignal, MarketBundle, MarketSnapshot, clamp, resolution_to_probability


def _extract_text_from_content(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(part for item in value if (part := _extract_text_from_content(item)))
    if isinstance(value, dict):
        ordered_parts = []
        for key in ("text", "content", "value", "html"):
            if key in value:
                part = _extract_text_from_content(value[key])
                if part:
                    ordered_parts.append(part)
        return " ".join(ordered_parts)
    return str(value)


def infer_signal_probability(text: str, market_probability: float) -> float | None:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return None
    percent_match = re.search(r"(\d{1,3}(?:\.\d+)?)\s*%", cleaned)
    if percent_match:
        return clamp(float(percent_match.group(1)) / 100.0)

    lower = cleaned.lower()
    yes_keywords = ("yes", "likely", "probable", "bull", "upside", "true", "will happen")
    no_keywords = ("no", "unlikely", "improbable", "bear", "downside", "false", "won't happen")
    yes_hits = sum(1 for keyword in yes_keywords if keyword in lower)
    no_hits = sum(1 for keyword in no_keywords if keyword in lower)
    if yes_hits == no_hits:
        return None
    strength = min(0.30, 0.05 + len(cleaned.split()) / 300.0)
    if yes_hits > no_hits:
        return clamp(market_probability + strength)
    return clamp(market_probability - strength)


def build_market_snapshot(raw_market: dict[str, Any]) -> MarketSnapshot:
    probability = raw_market.get("probability")
    if probability is None and raw_market.get("resolutionProbability") is not None:
        probability = raw_market["resolutionProbability"]
    probability = clamp(float(probability if probability is not None else 0.5))
    resolution_probability = raw_market.get("resolutionProbability")
    if resolution_probability is None:
        resolution_probability = resolution_to_probability(raw_market.get("resolution"))
    return MarketSnapshot(
        market_id=str(raw_market["id"]),
        question=str(raw_market.get("question", "")),
        probability=probability,
        volume=float(raw_market.get("volume", 0.0) or 0.0),
        total_liquidity=float(raw_market.get("totalLiquidity", 0.0) or 0.0),
        creator_id=str(raw_market.get("creatorId", "")),
        created_time_ms=int(raw_market.get("createdTime", 0) or 0),
        close_time_ms=raw_market.get("closeTime"),
        is_resolved=bool(raw_market.get("isResolved", False)),
        resolution=raw_market.get("resolution"),
        resolution_probability=resolution_probability,
        url=raw_market.get("url"),
        raw=raw_market,
    )


def build_actor_profile(raw_user: dict[str, Any]) -> ActorProfile:
    return ActorProfile(
        user_id=str(raw_user["id"]),
        username=str(raw_user.get("username") or raw_user.get("name") or raw_user["id"]),
        created_time_ms=int(raw_user.get("createdTime", 0) or 0),
        balance=float(raw_user.get("balance", 0.0) or 0.0),
        total_deposits=float(raw_user.get("totalDeposits", 0.0) or 0.0),
        last_bet_time_ms=raw_user.get("lastBetTime"),
        is_bot=bool(raw_user.get("isBot", False)),
        is_admin=bool(raw_user.get("isAdmin", False)),
        is_trustworthy=bool(raw_user.get("isTrustworthy", False)),
        consistency=float(raw_user.get("consistency", 0.5) or 0.5),
        extra={
            key: value
            for key, value in raw_user.items()
            if key
            not in {
                "id",
                "username",
                "createdTime",
                "balance",
                "totalDeposits",
                "lastBetTime",
                "isBot",
                "isAdmin",
                "isTrustworthy",
                "consistency",
            }
        },
    )


def build_comment_signal(raw_comment: dict[str, Any], market: MarketSnapshot) -> CommentSignal:
    text = _extract_text_from_content(raw_comment.get("text") or raw_comment.get("content"))
    username = str(
        raw_comment.get("userUsername")
        or raw_comment.get("userName")
        or raw_comment.get("userId")
        or "unknown"
    )
    return CommentSignal(
        comment_id=str(raw_comment.get("id", "unknown-comment")),
        market_id=market.market_id,
        user_id=str(raw_comment.get("userId", "unknown-user")),
        username=username,
        text=text[:2000],
        created_time_ms=int(raw_comment.get("createdTime", 0) or 0),
        reply_to_comment_id=raw_comment.get("replyToCommentId"),
        signal_probability=infer_signal_probability(text, market.probability),
        raw=raw_comment,
    )


def _load_actor_profiles(client: ManifoldClient, comments: Iterable[CommentSignal]) -> dict[str, ActorProfile]:
    profiles: dict[str, ActorProfile] = {}
    for comment in comments:
        if comment.user_id in profiles:
            continue
        raw_user = client.get_user_by_id(comment.user_id)
        profiles[comment.user_id] = build_actor_profile(raw_user)
    return profiles


def capture_market_bundle(client: ManifoldClient, market_id: str, now_ms: int | None = None) -> MarketBundle:
    raw_market = client.get_market(market_id)
    market = build_market_snapshot(raw_market)
    raw_comments = client.list_comments(market.market_id)
    comments = [build_comment_signal(comment, market) for comment in raw_comments]
    actors = _load_actor_profiles(client, comments)
    return MarketBundle(
        market=market,
        comments=comments,
        actors=actors,
        captured_time_ms=now_ms if now_ms is not None else int(time.time() * 1000),
        source="live",
    )
