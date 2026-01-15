import math
import os
import random
import unittest

import numpy as np
from keras.models import load_model
from keras.optimizers import Adam

from .__main__ import play_network, test_networks, train_network
from agent import build_agent
from gym_mancala.envs import MancalaRandomEnv, MancalaUserEnv
from gym_mancala.envs.board import Board
from model import build_model


def test_board_initialization(self):
    board = Board()
    for i in range(1):
        for j in range(6):
            assert board.marbles[i][j] == 4
    board.execute_turn(1)
    new_board = Board(board)
    board.execute_turn(1)
    board.execute_turn(1)
    assert not new_board.game_over
    assert board.game_over


def test_env_step(self):
    random_env = MancalaRandomEnv()
    random_env.step(5)
    assert random_env.board.marbles[0][5] == 0
    assert not random_env.board.player2_turn
    assert random_env.board.mancala[0] == 1


def test_build_model(self):
    environment = MancalaRandomEnv()
    model = build_model(environment)
    assert model is not None
    assert model.input_shape == (1,) + environment.observation_space.shape
    assert model.output_shape == (None, environment.action_space.n)


def test_build_agent(self):
    environment = MancalaRandomEnv()
    model = build_model(environment)
    agent = build_agent(model, environment, 1000)
    assert agent is not None
    assert agent.model == model
    assert agent.nb_actions == environment.action_space.n


def test_train_network(self):
    train_network()
    assert os.path.exists("networks/Model10/model.HDF5")


def test_test_networks(self):
    test_networks()
    assert os.path.exists("networks/Model2/model.HDF5")


def test_play_network(self):
    play_network()
    model = load_model("networks/Model2/model.HDF5")
    environment = MancalaUserEnv()
    agent = build_agent(model, environment, 1000)
    agent.compile(optimizer=Adam(lr=0.01))
    agent.load_weights("networks/Model2/4542")
    history = agent.test(environment, nb_episodes=1, verbose=0)
    assert history.history.get("episode_reward") is not None


if __name__ == "__main__":
    print("Note:")
    print("These tests mainly test the Gym environment.")
    print(
        "If you would like to train, test, or play against networks please run __main__.py.",
        flush=True,
    )
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEnv)
    unittest.TextTestRunner(verbosity=2).run(suite)
