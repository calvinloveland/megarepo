from __future__ import annotations

from tci_framework.models import MarketBundle


class ReplayAdapter:
    def __init__(self, bundle: MarketBundle) -> None:
        self.bundle = bundle

    def load_market_bundle(self, market_id: str) -> MarketBundle:
        if self.bundle.market.market_id != market_id:
            raise ValueError("Replay bundle market id mismatch")
        return self.bundle

    def place_order(
        self,
        market_id: str,
        *,
        amount: float,
        outcome: str,
        limit_prob: float | None = None,
    ) -> dict[str, object]:
        return {
            "status": "replay",
            "marketId": market_id,
            "amount": amount,
            "outcome": outcome,
            "limitProb": limit_prob,
        }
