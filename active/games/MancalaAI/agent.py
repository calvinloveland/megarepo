"""Agent builder for MancalaAI reinforcement learning runs."""

import importlib


def _load_rl_components():
    dqn_agent_cls = getattr(importlib.import_module("rl.agents.dqn"), "DQNAgent")
    sequential_memory_cls = getattr(
        importlib.import_module("rl.memory"), "SequentialMemory"
    )
    eps_policy_cls = getattr(importlib.import_module("rl.policy"), "EpsGreedyQPolicy")
    linear_policy_cls = getattr(
        importlib.import_module("rl.policy"), "LinearAnnealedPolicy"
    )
    return dqn_agent_cls, sequential_memory_cls, eps_policy_cls, linear_policy_cls


def build_agent(model, env, steps):
    """Build a DQN agent configured for the Mancala environment."""
    (
        dqn_agent_cls,
        sequential_memory_cls,
        eps_policy_cls,
        linear_policy_cls,
    ) = _load_rl_components()
    memory = sequential_memory_cls(limit=1000, window_length=1)
    policy = linear_policy_cls(
        eps_policy_cls(),
        attr="eps",
        value_max=1.0,
        value_min=0.001,
        value_test=0.0,
        nb_steps=steps,
    )
    return dqn_agent_cls(
        model=model,
        nb_actions=env.action_space.n,
        memory=memory,
        policy=policy,
        test_policy=None,
        enable_double_dqn=True,
        enable_dueling_network=False,
        dueling_type="avg",
    )
