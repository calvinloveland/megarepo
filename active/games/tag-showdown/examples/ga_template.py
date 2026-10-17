"""A SMALL TRAINER WRITTEN FROM SCRATCH (not using trainer.py), to show what ANY trainer has to do. This is the kind of file
an AI assistant can write for you. Run it from the project folder:

    python examples/ga_template.py --role chaser --generations 40

It is an evolution strategy, a cousin of the genetic algorithm: instead of breeding pairs, it keeps one "mean" network,
makes many noisy copies, plays them all, and moves the mean toward the best copies. Try replacing any numbered part.

Every trainer, whatever its algorithm, does the same five things:
  1. choose INPUTS and LAYERS (the network shape) and print the size           <- section 1
  2. make a population of weight vectors, each of length param_count(...)      <- section 2
  3. score each one by playing matches in the locked environment               <- section 3
  4. use the scores to produce the next population                             <- section 4  (the algorithm lives here)
  5. save the best weights with save_agent(...), which refuses invalid files   <- section 5
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))      # so this file can live in examples/

from agent import LIMITS, Network, check_agent_file, describe, load_agent, param_count, save_agent
from env import TagEnv
from generate import generate_arena
from opponents import OPPONENTS
from spec import CATALOG
from wanderers import wanderer

# ------------------------------------------------------------------ 1. the network shape (and its size)
INPUTS = list(CATALOG)                                                                     # any non-empty subset of the catalog, any order
LAYERS = [{"units": 32, "activation": "tanh"}, {"units": 2, "activation": "tanh"}]      # the last layer must have 2 units
# (This shape matches starters/starter_*.json, so those weights can be the starting point. Change either and use --scratch.)


def partner(role, kind):
    """Who the agent practises against: 'still', 'wanderer', or 'bot' (the omniscient scripted opponent)."""
    me, other = (0, 1) if role == "chaser" else (1, 0)
    if kind == "still":
        return lambda env: np.tile([0.0, -1.0], (env.B, 1))
    if kind == "wanderer":
        return lambda env: wanderer(env, other, pull=-2.5 if role == "chaser" else 2.5, thrust=0.7)
    return OPPONENTS["omniscient_evader" if role == "chaser" else "omniscient_chaser"]


# ------------------------------------------------------------------ 3. scoring: play matches, return one number per network
def score_population(role, net, population, arenas, starts, opponent, ticks):
    """population: (P, n_params). Every network plays every arena from every start position. Returns (P,) scores."""
    cols = [CATALOG.index(n) for n in INPUTS]
    total = np.zeros(len(population))
    for arena in arenas:
        for start in starts:
            env = TagEnv(arena, batch=len(population))               # P matches side by side, one per network
            env.reset(start)
            dist = np.zeros(len(population))
            steps = 0
            while not env.all_done and steps < ticks:
                mine = net.forward_pop(population, env.observe(role)[:, cols])         # (P, 2): turn, thrust
                theirs = opponent(env)
                env.step(mine, theirs) if role == "chaser" else env.step(theirs, mine)
                dist += env.distance()
                steps += 1
            tagged, mean_dist = env.tag_tick >= 0, dist / steps
            if role == "chaser":                                      # a tag beats any amount of "getting close"
                total += np.where(tagged, 2.0 + (1 - env.tag_tick / ticks), 1 - np.clip(mean_dist / 25, 0, 1))
            else:                                                     # surviving beats any amount of running
                total += np.where(tagged, env.tag_tick / ticks, 2.0) + 0.5 * np.clip(mean_dist / 25, 0, 1)
    return total / (len(arenas) * len(starts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", choices=["chaser", "evader"], required=True)
    ap.add_argument("--generations", type=int, default=40)
    ap.add_argument("--population", type=int, default=48)
    ap.add_argument("--opponent", choices=["still", "wanderer", "bot"], default="wanderer")
    ap.add_argument("--out", default="my_es_agent.json")
    ap.add_argument("--name", default="ES Template")
    ap.add_argument("--scratch", action="store_true", help="start from random weights instead of the starter weights")
    a = ap.parse_args()

    n_params = param_count(len(INPUTS), LAYERS)
    print(describe(INPUTS, LAYERS), "\n")
    assert n_params <= LIMITS["max_total_parameters"], "too many parameters for the tournament"       # fail now, not at the end
    net, rng = Network(len(INPUTS), LAYERS), np.random.default_rng(0)
    arenas = [generate_arena(300 + i) for i in range(3)]
    opponent = partner(a.role, a.opponent)

    # ------------------------------------------------------------ 2. the starting point
    starter = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "starters", f"starter_{a.role}.json")
    if a.scratch or not os.path.exists(starter):
        mean, sigma = rng.normal(0, 0.5, n_params), 0.3             # random start: much slower to learn
    else:
        mean, sigma = load_agent(starter).weights.copy(), 0.1       # start from an agent that already knows how to steer
    assert len(mean) == n_params, "the starter file has a different shape; use --scratch or match its INPUTS and LAYERS"
    # sigma is how far the noisy copies stray from the mean (it shrinks every generation, below)
    for gen in range(1, a.generations + 1):
        # -------------------------------------------------------- 4. the algorithm: sample, score, move toward the best
        noise = rng.normal(0, 1, (a.population, n_params))
        population = np.clip(mean + sigma * noise, -LIMITS["max_abs_weight"], LIMITS["max_abs_weight"])
        starts = [gen // 10 * 100 + k for k in range(2)]              # new start positions only every 10 generations
        scores = score_population(a.role, net, population, arenas, starts, opponent, ticks=200)
        elite = np.argsort(-scores)[: a.population // 4]
        weights = np.linspace(1.0, 0.3, len(elite))
        mean = np.clip(mean + (weights[:, None] * (population[elite] - mean)).sum(0) / weights.sum(), -100, 100)
        sigma = max(0.02, sigma * 0.985)
        print(f"gen {gen:3d} | best {scores.max():.3f} | average {scores.mean():.3f} | sigma {sigma:.3f}")

    # ------------------------------------------------------------ 5. save, then run the same checks the tournament runs
    path = save_agent(a.out, a.name, a.role, "#ff8800" if a.role == "chaser" else "#1d9bf0", INPUTS, LAYERS, mean,
                      notes=f"Evolution strategy template, {a.generations} generations.")
    report = check_agent_file(path)
    print("\nSaved", path, "->", "PASS: ready to compete." if report.ok else report.problems)


if __name__ == "__main__":
    main()
