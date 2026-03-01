"""Integration-style smoke tests for MancalaAI model and agent builders."""

import pytest

def test_build_model():
    """Model builder should return a network matching environment dimensions."""
    pytest.importorskip("keras")
    from .gym_mancala.envs import MancalaRandomEnv
    from .model import build_model

    environment = MancalaRandomEnv()
    model = build_model(environment)
    assert model is not None
    assert model.input_shape == (1,) + environment.observation_space.shape
    assert model.output_shape == (None, environment.action_space.n)


def test_build_agent():
    """Agent builder should produce a DQN agent bound to the environment action space."""
    pytest.importorskip("keras")
    pytest.importorskip("rl")
    from .agent import build_agent
    from .gym_mancala.envs import MancalaRandomEnv
    from .model import build_model

    environment = MancalaRandomEnv()
    model = build_model(environment)
    agent = build_agent(model, environment, 1000)
    assert agent is not None
    assert agent.model == model
    assert agent.nb_actions == environment.action_space.n
