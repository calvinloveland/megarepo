from __future__ import annotations

from ..ingestion import capture_market_bundle
from ..manifold_api import ManifoldClient
from ..models import MarketBundle


class ManifoldAdapter:
    def __init__(self, client: ManifoldClient) -> None:
        self.client = client

    def load_market_bundle(self, market_id: str) -> MarketBundle:
        return capture_market_bundle(self.client, market_id)

    def place_order(
        self,
        market_id: str,
        *,
        amount: float,
        outcome: str,
        limit_prob: float | None = None,
    ) -> dict[str, object]:
        return self.client.place_bet(market_id, amount=amount, outcome=outcome, limit_prob=limit_prob)
