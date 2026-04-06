from __future__ import annotations

from tci_framework.intelligence import estimate_comment_intelligence
from tci_framework.models import CommentSignal


def test_intelligence_scores_reasoned_argument_above_noise():
    thoughtful = CommentSignal(
        comment_id="1",
        market_id="m1",
        user_id="u1",
        username="alice",
        text="I think YES because the latest filing showed 78% completion and the official source posted a timeline update.",
        created_time_ms=1,
        signal_probability=0.78,
    )
    noise = CommentSignal(
        comment_id="2",
        market_id="m1",
        user_id="u2",
        username="bob",
        text="lol no",
        created_time_ms=2,
        signal_probability=0.35,
    )

    assert estimate_comment_intelligence(thoughtful, 0.5) > estimate_comment_intelligence(noise, 0.5)
