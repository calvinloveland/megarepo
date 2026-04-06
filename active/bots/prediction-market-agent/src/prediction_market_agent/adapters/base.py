from __future__ import annotations

from typing import Any, Protocol

from ..models import MarketBundle


class MarketAdapter(Protocol):
    def load_market_bundle(self, market_id: str) -> MarketBundle:
        ...

    def place_order(
        self,
        market_id: str,
        *,
        amount: float,
        outcome: str,
        limit_prob: float | None = None,
    ) -> dict[str, Any]:
        ...
