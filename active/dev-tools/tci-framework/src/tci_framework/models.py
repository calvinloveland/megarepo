from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from typing import Any


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


class AgentVariant(str, Enum):
    V1 = "v1"
    V2 = "v2"
    V3 = "v3"
    V4 = "v4"


class ExecutionMode(str, Enum):
    SHADOW = "shadow"
    LIVE = "live"


class ActionType(str, Enum):
    BUY_YES = "buy_yes"
    BUY_NO = "buy_no"
    HOLD = "hold"


@dataclass(frozen=True)
class ActorProfile:
    user_id: str
    username: str
    created_time_ms: int = 0
    balance: float = 0.0
    total_deposits: float = 0.0
    last_bet_time_ms: int | None = None
    is_bot: bool = False
    is_admin: bool = False
    is_trustworthy: bool = False
    historical_accuracy: float | None = None
    consistency: float = 0.5
    past_success_rate: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def account_age_days(self, now_ms: int) -> float:
        if self.created_time_ms <= 0:
            return 0.0
        return max(0.0, now_ms - self.created_time_ms) / 86_400_000.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ActorProfile":
        return cls(**data)


@dataclass(frozen=True)
class MarketSnapshot:
    market_id: str
    question: str
    probability: float
    volume: float
    total_liquidity: float
    creator_id: str
    created_time_ms: int
    close_time_ms: int | None = None
    is_resolved: bool = False
    resolution: str | None = None
    resolution_probability: float | None = None
    url: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MarketSnapshot":
        return cls(**data)


@dataclass(frozen=True)
class CommentSignal:
    comment_id: str
    market_id: str
    user_id: str
    username: str
    text: str
    created_time_ms: int
    reply_to_comment_id: str | None = None
    signal_probability: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CommentSignal":
        return cls(**data)


@dataclass(frozen=True)
class MarketBundle:
    market: MarketSnapshot
    comments: list[CommentSignal]
    actors: dict[str, ActorProfile]
    captured_time_ms: int
    source: str = "live"
    scenario_name: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MarketBundle":
        return cls(
            market=MarketSnapshot.from_dict(data["market"]),
            comments=[CommentSignal.from_dict(item) for item in data["comments"]],
            actors={key: ActorProfile.from_dict(value) for key, value in data["actors"].items()},
            captured_time_ms=data["captured_time_ms"],
            source=data.get("source", "live"),
            scenario_name=data.get("scenario_name"),
        )


@dataclass(frozen=True)
class EvaluatedInput:
    comment_id: str
    user_id: str
    username: str
    text_excerpt: str
    signal_probability: float | None
    trust_score: float
    intelligence_score: float
    skepticism: float
    effective_weight: float
    aligned_with_market: bool


@dataclass(frozen=True)
class PolicySnapshot:
    allowed_bet_size: float
    capability_scale: float
    adversarial_pressure: float
    should_trade: bool
    reasons: list[str]


@dataclass(frozen=True)
class Decision:
    variant: AgentVariant
    action: ActionType
    market_id: str
    market_question: str
    market_probability: float
    target_probability: float
    confidence: float
    bet_amount: float
    mode: ExecutionMode
    rationale: list[str]
    evaluated_inputs: list[EvaluatedInput]
    policy: PolicySnapshot


@dataclass(frozen=True)
class AgentRunResult:
    bundle: MarketBundle
    decision: Decision
    metrics: dict[str, Any]
    execution_result: dict[str, Any] | None = None


def resolution_to_probability(resolution: str | None) -> float | None:
    if resolution == "YES":
        return 1.0
    if resolution == "NO":
        return 0.0
    return None


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {key: to_jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    return value
