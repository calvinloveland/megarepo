from __future__ import annotations

from .belief import compute_uncertainty, counterfactual_without_suspicious, update_belief
from .config import TCIConfig
from .intelligence import estimate_comment_intelligence
from .metrics import compute_run_metrics
from .models import (
    ActionType,
    ActorProfile,
    AgentRunResult,
    AgentVariant,
    Decision,
    EvaluatedInput,
    ExecutionMode,
    MarketBundle,
    clamp,
)
from .policy import evaluate_policy
from .trust import score_actor


def _direction_from_signal(signal_probability: float | None, market_probability: float) -> int:
    if signal_probability is None:
        return 0
    if signal_probability > market_probability:
        return 1
    if signal_probability < market_probability:
        return -1
    return 0


def _evaluate_inputs(bundle: MarketBundle, variant: AgentVariant, config: TCIConfig) -> list[EvaluatedInput]:
    prior_texts: list[str] = []
    evaluated: list[EvaluatedInput] = []
    for comment in bundle.comments:
        profile = bundle.actors.get(comment.user_id, ActorProfile(user_id=comment.user_id, username=comment.username))
        trust_score = 0.5 if variant == AgentVariant.V1 else score_actor(profile, bundle.captured_time_ms, config)
        intelligence_score = estimate_comment_intelligence(
            comment,
            bundle.market.probability,
            prior_texts=prior_texts,
            past_success_rate=profile.past_success_rate,
        )
        prior_texts.append(comment.text)
        skepticism = 0.0
        if variant in {AgentVariant.V3, AgentVariant.V4}:
            skepticism = intelligence_score * (1.0 - trust_score)
        if variant == AgentVariant.V1:
            effective_weight = 1.0 if comment.signal_probability is not None else 0.0
        elif variant == AgentVariant.V2:
            effective_weight = trust_score if comment.signal_probability is not None else 0.0
        elif variant == AgentVariant.V3:
            if trust_score < config.low_trust_threshold and intelligence_score >= config.suspicious_intelligence_threshold:
                effective_weight = trust_score * config.low_trust_influence_cap * (1.0 - intelligence_score)
            else:
                effective_weight = trust_score * (1.0 - config.intelligence_penalty_weight * skepticism)
        else:
            effective_weight = trust_score * (1.0 - config.intelligence_penalty_weight * skepticism)
            if trust_score < config.low_trust_threshold:
                effective_weight *= config.low_trust_influence_cap
        evaluated.append(
            EvaluatedInput(
                comment_id=comment.comment_id,
                user_id=comment.user_id,
                username=comment.username,
                text_excerpt=comment.text[:160],
                signal_probability=comment.signal_probability,
                trust_score=round(trust_score, 6),
                intelligence_score=round(intelligence_score, 6),
                skepticism=round(skepticism, 6),
                effective_weight=round(max(0.0, effective_weight), 6),
                aligned_with_market=_direction_from_signal(comment.signal_probability, bundle.market.probability) >= 0,
            )
        )
    return evaluated


def run_agent_variant(
    bundle: MarketBundle,
    variant: AgentVariant,
    config: TCIConfig,
    *,
    mode: ExecutionMode = ExecutionMode.SHADOW,
    available_capital: float = 100.0,
    current_exposure: float = 0.0,
) -> AgentRunResult:
    evaluated_inputs = _evaluate_inputs(bundle, variant, config)
    uncertainty = compute_uncertainty(bundle.market.probability, evaluated_inputs)
    damping = 0.10 if variant == AgentVariant.V1 else 0.15 if variant == AgentVariant.V2 else 0.25 * uncertainty
    target_probability = update_belief(
        bundle.market.probability,
        evaluated_inputs,
        market_anchor_weight=config.market_anchor_weight,
        damping=damping,
    )
    confidence = clamp(abs(target_probability - bundle.market.probability) * 2.5)
    policy = evaluate_policy(
        market_probability=bundle.market.probability,
        target_probability=target_probability,
        confidence=confidence,
        uncertainty=uncertainty,
        evaluated_inputs=evaluated_inputs,
        config=config,
        available_capital=available_capital,
        current_exposure=current_exposure,
    )

    if variant in {AgentVariant.V1, AgentVariant.V2}:
        hard_cap = min(
            config.risk.max_bet_size,
            max(0.0, config.risk.max_exposure_per_market - current_exposure),
            max(0.0, config.risk.max_total_risk - current_exposure),
            available_capital,
        )
        policy = policy.__class__(
            allowed_bet_size=round(hard_cap * max(confidence, 0.05), 4),
            capability_scale=round(max(confidence, 0.05), 6),
            adversarial_pressure=policy.adversarial_pressure,
            should_trade=abs(target_probability - bundle.market.probability) >= config.risk.min_edge_to_trade,
            reasons=policy.reasons,
        )

    action = ActionType.HOLD
    if policy.should_trade and policy.allowed_bet_size > 0:
        action = ActionType.BUY_YES if target_probability > bundle.market.probability else ActionType.BUY_NO
    counterfactual_probability = counterfactual_without_suspicious(
        bundle.market.probability,
        evaluated_inputs,
        config.market_anchor_weight,
    )
    rationale = [f"variant={variant.value}", f"uncertainty={uncertainty:.3f}"] + list(policy.reasons)
    decision = Decision(
        variant=variant,
        action=action,
        market_id=bundle.market.market_id,
        market_question=bundle.market.question,
        market_probability=round(bundle.market.probability, 6),
        target_probability=round(target_probability, 6),
        confidence=round(confidence, 6),
        bet_amount=round(policy.allowed_bet_size if action != ActionType.HOLD else 0.0, 4),
        mode=mode,
        rationale=rationale,
        evaluated_inputs=evaluated_inputs,
        policy=policy,
    )
    metrics = compute_run_metrics(
        market=bundle.market,
        target_probability=target_probability,
        action=action,
        bet_amount=decision.bet_amount,
        confidence=confidence,
        adversarial_pressure=policy.adversarial_pressure,
        counterfactual_probability=counterfactual_probability,
        max_bet_size=config.risk.max_bet_size,
        evaluated_inputs=evaluated_inputs,
    )
    return AgentRunResult(bundle=bundle, decision=decision, metrics=metrics)
