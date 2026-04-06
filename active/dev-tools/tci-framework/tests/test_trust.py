from __future__ import annotations

from tci_framework.config import TCIConfig
from tci_framework.models import ActorProfile
from tci_framework.trust import score_actor, update_trust_score


def test_score_actor_prefers_older_consistent_profile():
    config = TCIConfig()
    now_ms = 2_000_000_000_000
    veteran = ActorProfile(
        user_id="trusted",
        username="trusted",
        created_time_ms=now_ms - 300 * 86_400_000,
        total_deposits=5000,
        consistency=0.9,
        historical_accuracy=0.8,
        is_trustworthy=True,
    )
    newcomer = ActorProfile(
        user_id="new",
        username="new",
        created_time_ms=now_ms - 3 * 86_400_000,
        total_deposits=10,
        consistency=0.3,
        historical_accuracy=0.4,
        is_bot=True,
    )

    assert score_actor(veteran, now_ms, config) > score_actor(newcomer, now_ms, config)


def test_update_trust_score_penalizes_betrayal_more_than_slow_decay():
    config = TCIConfig()
    decayed = update_trust_score(0.8, realized_accuracy=0.8, elapsed_days=5.0, config=config)
    betrayed = update_trust_score(0.8, realized_accuracy=0.1, elapsed_days=5.0, config=config, betrayal_factor=1.0)

    assert decayed > betrayed
    assert betrayed < 0.5
