"""Makes the STARTER WEIGHTS that trainer.py begins from.

Evolving the very first "turn toward the opponent" skill from nothing is slow, because the network only gets raw
coordinates and its own heading and must work the direction out itself. So here we shortcut that one skill: we show a
network thousands of random situations together with the turn a simple steering rule would pick, and fit it to those
examples with gradient descent (ordinary supervised learning, about 10 seconds). It knows nothing about walls and
nothing about tactics. Everything else is left for the genetic algorithm.

    python seed_network.py                 writes starters/starter_chaser.json and starters/starter_evader.json

Chaser rule: turn toward the evader.   Evader rule: turn directly away from the chaser.   Both: full thrust.
You can delete this file and the starters folder if you want to evolve from scratch (python trainer.py --scratch).
"""
import os

import numpy as np

from agent import Network, param_count, save_agent
from env import wrap_angle
from spec import CATALOG, DT, TURN_RATE

HERE = os.path.dirname(os.path.abspath(__file__))
INPUTS = list(CATALOG)
LAYERS = [{"units": 32, "activation": "tanh"}, {"units": 2, "activation": "tanh"}]
COLORS = {"chaser": "#ff8800", "evader": "#1d9bf0"}


def make_examples(role, n, rng):
    """Random situations (as full catalog observations) and the action the steering rule wants in each."""
    x = np.zeros((n, len(CATALOG)))
    col = {name: i for i, name in enumerate(CATALOG)}
    me, other = rng.uniform([1, 1], [39, 27], (n, 2)), rng.uniform([1, 1], [39, 27], (n, 2))
    heading = rng.uniform(-np.pi, np.pi, n)
    x[:, col["self_x"]], x[:, col["self_y"]] = me[:, 0] / 48, me[:, 1] / 48
    x[:, col["opp_x"]], x[:, col["opp_y"]] = other[:, 0] / 48, other[:, 1] / 48
    x[:, col["heading_cos"]], x[:, col["heading_sin"]] = np.cos(heading), np.sin(heading)
    speed = rng.uniform(0, 1, n)
    x[:, col["move_x"]], x[:, col["move_y"]] = speed * np.cos(heading), speed * np.sin(heading)
    d = other - me
    aim = np.arctan2(d[:, 1], d[:, 0]) + (0.0 if role == "chaser" else np.pi)
    who = 0 if role == "chaser" else 1
    turn = np.clip(wrap_angle(aim - heading) / (TURN_RATE[who] * DT), -1, 1)
    y = np.stack([turn, np.ones(n)], axis=1)
    return x, y


def fit(role, steps=1500, seed=0, hidden_scale=1.0):
    rng = np.random.default_rng(seed)
    net = Network(len(INPUTS), LAYERS)
    X, Y = make_examples(role, 8000, rng)
    cols = [CATALOG.index(n) for n in INPUTS]
    X = X[:, cols]
    sizes, w = [], rng.normal(0, 1, net.n_params)
    n_in, i = len(INPUTS), 0
    for L in LAYERS:                                   # Xavier-like init, zero biases
        u = L["units"]
        w[i:i + n_in * u] = rng.normal(0, hidden_scale * np.sqrt(1.0 / n_in), n_in * u)
        w[i + n_in * u:i + (n_in + 1) * u] = 0.0
        i += (n_in + 1) * u
        n_in = u
    (n1, u1), (n2, u2) = (len(INPUTS), LAYERS[0]["units"]), (LAYERS[0]["units"], 2)
    a, b, c, d = n1 * u1, n1 * u1 + u1, n1 * u1 + u1 + n2 * u2, net.n_params
    m, v = np.zeros_like(w), np.zeros_like(w)
    lr = 0.01
    for t in range(1, steps + 1):
        W1, b1, W2, b2 = w[:a].reshape(n1, u1), w[a:b], w[b:c].reshape(n2, u2), w[c:d]
        h = np.tanh(X @ W1 + b1)
        out = np.tanh(h @ W2 + b2)
        err = out - Y
        g_out = 2 * err / len(X) * (1 - out ** 2)
        g = np.concatenate([(X.T @ ((g_out @ W2.T) * (1 - h ** 2))).ravel(), ((g_out @ W2.T) * (1 - h ** 2)).sum(0),
                            (h.T @ g_out).ravel(), g_out.sum(0)])
        m, v = 0.9 * m + 0.1 * g, 0.999 * v + 0.001 * g * g
        w -= lr * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
        if t == int(steps * 0.7):
            lr = 0.003
    loss = float(np.mean((np.tanh(np.tanh(X @ w[:a].reshape(n1, u1) + w[a:b]) @ w[b:c].reshape(n2, u2) + w[c:d]) - Y) ** 2))
    return w, loss


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "starters"), exist_ok=True)
    for role in ("chaser", "evader"):
        w, loss = fit(role)
        path = os.path.join(HERE, "starters", f"starter_{role}.json")
        save_agent(path, f"Starter {role.title()}", role, COLORS[role], INPUTS, LAYERS, np.round(w, 4),
                   notes="Starting weights only: steers toward/away from the opponent. Knows nothing about walls.")
        print(f"{role}: fit error {loss:.4f} -> {path}")
