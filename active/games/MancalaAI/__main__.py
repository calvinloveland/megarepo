"""CLI entry point for training, testing, and playing MancalaAI models."""

import importlib
import math
import os
import random

import numpy as np

from .agent import build_agent
from .gym_mancala.envs import MancalaUserEnv
from .gym_mancala.envs.mancala_random_env import MancalaRandomEnv
from .model import build_model
from .shared.priority import set_background_priority

MODEL_NUMBER = 10
NETWORKS_PATH = "networks/"
PATH = f"{NETWORKS_PATH}Model{MODEL_NUMBER}/"
BEST_NETWORK_MODEL = f"{NETWORKS_PATH}Model2/model.HDF5"
BEST_NETWORK_WEIGHTS = f"{NETWORKS_PATH}Model2/4542"
STEPS = 2_000_000


def _load_keras_runtime():
    keras_models = importlib.import_module("keras.models")
    keras_optimizers = importlib.import_module("keras.optimizers")
    return getattr(keras_models, "load_model"), getattr(keras_optimizers, "Adam")


def plot_reward(history, network_id):
    """Plot and save normalized episode reward history."""
    pyplot = importlib.import_module("matplotlib.pyplot")
    rewards = np.asarray(history.history.get("episode_reward"))
    rewards = np.divide(rewards, np.asarray(history.history.get("nb_steps")))
    if rewards.size > 10000:
        divisor = (rewards.size // 10000) + 1
        remainder = 10000 - (rewards.size % 10000)
        rewards = np.pad(rewards, (remainder, 0), "constant")
        rewards = np.mean(rewards.reshape(-1, divisor), axis=1)
    pyplot.plot(rewards)
    pyplot.savefig(f"{PATH}{network_id}-rewards.png")


def train_network():
    """Train a new network and save weights, model, and reward plot."""
    _, adam_cls = _load_keras_runtime()
    set_background_priority()

    if not os.path.exists(PATH):
        os.makedirs(PATH)
    environment = MancalaRandomEnv()
    model = build_model(environment)
    model.save(f"{PATH}model.HDF5")
    agent = build_agent(model, environment, STEPS)
    agent.compile(optimizer=adam_cls(lr=0.1))
    history = agent.fit(
        environment,
        nb_steps=STEPS,
        action_repetition=1,
        callbacks=None,
        verbose=2,
        visualize=False,
        nb_max_start_steps=0,
        start_step_policy=None,
        log_interval=math.floor(STEPS / 10),
        nb_max_episode_steps=None,
    )
    network_id = random.randint(1, 10000)
    agent.save_weights(f"{PATH}{network_id}")
    print(f"Saved network: {network_id}")
    plot_reward(history, network_id)


def test_networks():
    """Evaluate all saved networks and print the best/worst results."""
    load_model, adam_cls = _load_keras_runtime()
    avg_scores = {}
    for dirname in os.listdir(NETWORKS_PATH):
        _evaluate_directory(dirname, load_model, adam_cls, avg_scores)
    _print_network_summary(avg_scores)


def _evaluate_directory(dirname, load_model, adam_cls, avg_scores):
    environment = MancalaRandomEnv()
    model = load_model(f"{NETWORKS_PATH}{dirname}/model.HDF5")
    print(model.summary())
    for filename in os.listdir(f"{NETWORKS_PATH}{dirname}"):
        if "HDF5" in filename or "png" in filename:
            continue
        avg_score = _evaluate_weight_file(dirname, filename, model, environment, adam_cls)
        if avg_score is not None:
            avg_scores[f"{dirname}/{filename}"] = avg_score


def _evaluate_weight_file(dirname, filename, model, environment, adam_cls):
    print(f"Testing: {dirname}/{filename}")
    agent = build_agent(model, environment, STEPS)
    agent.compile(optimizer=adam_cls(lr=1))
    agent.load_weights(f"{NETWORKS_PATH}{dirname}/{filename}")
    try:
        history = agent.test(
            environment,
            nb_episodes=100,
            action_repetition=1,
            callbacks=None,
            visualize=False,
            nb_max_episode_steps=None,
            nb_max_start_steps=0,
            start_step_policy=None,
            verbose=2,
        )
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Invalid format: {filename} ({error})")
        return None
    avg_score = np.mean(history.history.get("episode_reward"))
    print(f"Average score: {avg_score}")
    return avg_score


def _print_network_summary(avg_scores):
    if not avg_scores:
        print("No valid network scores found.")
        return
    best = max(avg_scores, key=avg_scores.get)
    worst = min(avg_scores, key=avg_scores.get)
    print(f"Best network = {best} with avg of: {avg_scores[best]}")
    print(f"Worst network = {worst} with avg of: {avg_scores[worst]}")


def play_network():
    """Run one episode against the best saved network with user environment."""
    load_model, adam_cls = _load_keras_runtime()
    print("You are Player 2 on the bottom of the board")
    print("When prompted give a space between 0-5")
    print("Selecting an empty space will cause you to lose the game")
    model = load_model(BEST_NETWORK_MODEL)
    environment = MancalaUserEnv()
    environment.board.print_board()
    agent = build_agent(model, environment, STEPS)
    agent.compile(optimizer=adam_cls(lr=0.01))
    agent.load_weights(BEST_NETWORK_WEIGHTS)
    agent.test(
        environment,
        nb_episodes=1,
        action_repetition=1,
        callbacks=None,
        visualize=False,
        nb_max_episode_steps=None,
        nb_max_start_steps=0,
        start_step_policy=None,
        verbose=0,
    )


def main():
    """Prompt for mode and run train/test/play workflow."""
    user_input = input(
        "Would you like to [t]rain a network, test [n]etworks, or [p]lay against a network?"
    ).lower()
    if user_input == "t":
        train_network()
    elif user_input == "n":
        test_networks()
    elif user_input == "p":
        play_network()
    else:
        print("Invalid input")
        print("Please enter t, n, or p")


if __name__ == "__main__":
    main()
