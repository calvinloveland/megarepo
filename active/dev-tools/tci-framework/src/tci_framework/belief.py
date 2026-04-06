from __future__ import annotations

from .models import EvaluatedInput, clamp


def compute_uncertainty(prior_probability: float, evaluated_inputs: list[EvaluatedInput]) -> float:
    directional_inputs = [item for item in evaluated_inputs if item.signal_probability is not None and item.effective_weight > 0]
    market_uncertainty = 1.0 - abs(prior_probability - 0.5) * 2.0
    if not directional_inputs:
        return clamp(0.5 + 0.5 * market_uncertainty)
    average_signal = sum(item.signal_probability for item in directional_inputs if item.signal_probability is not None) / len(directional_inputs)
    dispersion = sum(abs((item.signal_probability or average_signal) - average_signal) for item in directional_inputs) / len(directional_inputs)
    return clamp(0.5 * market_uncertainty + 0.5 * min(1.0, dispersion * 2.0))


def update_belief(
    prior_probability: float,
    evaluated_inputs: list[EvaluatedInput],
    market_anchor_weight: float,
    damping: float,
) -> float:
    weighted_sum = prior_probability * market_anchor_weight
    total_weight = market_anchor_weight
    for item in evaluated_inputs:
        if item.signal_probability is None or item.effective_weight <= 0:
            continue
        weighted_sum += item.signal_probability * item.effective_weight
        total_weight += item.effective_weight
    posterior = prior_probability if total_weight <= 0 else weighted_sum / total_weight
    return clamp(prior_probability + (posterior - prior_probability) * (1.0 - damping))


def counterfactual_without_suspicious(prior_probability: float, evaluated_inputs: list[EvaluatedInput], market_anchor_weight: float) -> float:
    benign_inputs = [
        item
        for item in evaluated_inputs
        if not (item.trust_score < 0.35 and item.intelligence_score > 0.72)
    ]
    return update_belief(prior_probability, benign_inputs, market_anchor_weight, damping=0.0)
