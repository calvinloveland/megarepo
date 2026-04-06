from __future__ import annotations

import re

from .models import CommentSignal, clamp


def novelty_score(text: str, prior_texts: list[str]) -> float:
    tokens = {token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 3}
    if not tokens:
        return 0.0
    if not prior_texts:
        return 0.7
    max_overlap = 0.0
    for prior in prior_texts:
        prior_tokens = {token for token in re.findall(r"[a-z0-9]+", prior.lower()) if len(token) > 3}
        if not prior_tokens:
            continue
        overlap = len(tokens & prior_tokens) / len(tokens | prior_tokens)
        max_overlap = max(max_overlap, overlap)
    return clamp(1.0 - max_overlap)


def estimate_comment_intelligence(
    comment: CommentSignal,
    market_probability: float,
    prior_texts: list[str] | None = None,
    past_success_rate: float | None = None,
) -> float:
    text = comment.text.strip()
    if not text:
        return 0.0
    prior_texts = prior_texts or []
    words = text.split()
    length_score = min(1.0, len(words) / 120.0)
    structure_markers = ("because", "therefore", "evidence", "source", "study", "data", "according", "http", "%")
    structure_score = min(1.0, sum(1 for marker in structure_markers if marker in text.lower()) / 4.0)
    novelty = novelty_score(text, prior_texts)
    contradiction = 0.0
    if comment.signal_probability is not None:
        contradiction = min(1.0, abs(comment.signal_probability - market_probability) * 1.8)
    success = clamp(past_success_rate if past_success_rate is not None else 0.5)
    score = (
        0.20 * length_score
        + 0.25 * structure_score
        + 0.20 * novelty
        + 0.20 * contradiction
        + 0.15 * success
    )
    return clamp(score)
