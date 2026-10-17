"""STARTER TRAINER: a small, readable genetic algorithm that trains ONE role against a sparring partner.

    python trainer.py --role chaser --generations 60
    python trainer.py --role evader --opponent still --generations 40 --out my_runs

It is a starting point. You may change anything in this file, or throw it away and write your own trainer (with AI help
if you like). The only things that are locked are the environment (env_spec.json) and the file you submit, a weights JSON
that passes `python validate_agent.py`. See CONTRACT.md.

How the genetic algorithm works, in plain words (the numbered parts below match the code):
    1. A POPULATION is many networks of the same shape, each just a long list of numbers (its weights).
    2. FITNESS: every network plays against the sparring partner and gets a score.
    3. SELECTION: networks with better scores are more likely to become parents.
    4. CROSSOVER: a child takes each weight from one of two parents (it inherits pieces of both).
    5. MUTATION: random nudges to the child's weights. This is where new behaviour comes from.
    The best few networks are copied unchanged (ELITISM) so progress is never lost. Repeat for many generations.

Marked "<-- CHANGE ME" are the easiest places to experiment.
"""
import argparse
import json
import os
import re
import time

import numpy as np

from agent import Agent, Network, describe, load_agent, make_agent_dict, save_agent
from env import CHASER, EVADER, TagEnv
from arena import ArenaError, load_arena
from generate import generate_arena
from opponents import OPPONENTS, _openness as openness_map
from replay import build_replay
from spec import CATALOG, MAX_TICKS, SPEC
from wanderers import wanderer

# ------------------------------------------------------------------------------------------ settings
INPUTS = list(CATALOG)                               # <-- CHANGE ME: any non-empty subset of the catalog, in any order
LAYERS = [{"units": 24, "activation": "tanh"},       # <-- CHANGE ME: up to 6 layers, up to 256 units each,
          {"units": 2, "activation": "tanh"}]        #     the last layer must have exactly 2 units (turn, thrust)
POPULATION = 64                                      # <-- CHANGE ME: more networks = more variety, but slower
ELITE = 4                                            # best networks copied unchanged each generation
TOURNAMENT = 4                                       # selection pressure: bigger = only the very best become parents
MUTATION_RATE = 0.25                                 # <-- CHANGE ME: fraction of weights nudged in each child
MUTATION_SIZE = (0.6, 0.1)                           # <-- CHANGE ME: size of nudges, shrinking from first to last generation
SEEDED_MUTATION_SIZE = (0.15, 0.03)                  # gentler nudges when starting from the starter weights
INIT_SCALE = 4.0                                     # starting weights are random with std INIT_SCALE / sqrt(inputs). Big enough
                                                     # that hidden units start out bent (nonlinear); tiny weights make dull networks
STARTS = 2                                           # different start positions per arena in each score
STARTS_CHANGE_EVERY = 25                             # the start positions are kept this many generations so progress can build up
TRAIN_ARENAS = 2                                     # how many different arenas each network is scored on
TRAIN_TICKS = 200                                    # <-- CHANGE ME: training matches stop here (real matches last 400), so training is quick
WEIGHT_LIMIT = 100.0

STARTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "starters", "starter_{role}.json")
COLORS = {"chaser": "#ff8800", "evader": "#1d9bf0"}


# ------------------------------------------------------------------------------------ sparring partners
def still_opponent(env):
    """The easiest partner: stands perfectly still. Good for the very first generations."""
    return np.tile([0.0, -1.0], (env.B, 1))


OPPONENT_CHOICES = ["wanderer", "still", "omniscient"]
# wanderer:   a smooth random walker, strongly pulled toward the agent (when you train an evader) or pushed away from it
#             (when you train a chaser). Moving, but not clever. The best place to start.
# still:      stands perfectly still.
# omniscient: a scripted bot that sees everything and plays well. A tough final exam.


def partner_for(role, name, agent_file=None):
    if agent_file:                                    # an agent file you trained earlier (or a baseline) as the sparring partner
        other = load_agent(agent_file)
        want = "evader" if role == "chaser" else "chaser"
        if other.role != want:
            raise SystemExit(f"{agent_file} is a {other.role}; training the {role} needs a {want} as the partner.")
        return lambda env: np.clip(other.act(env.observe(want)), -1.0, 1.0)
    if name == "still":
        return still_opponent
    if name == "wanderer":
        return lambda env: wanderer(env, 1 if role == "chaser" else 0, pull=-2.5 if role == "chaser" else 2.5, thrust=0.65 if role == "chaser" else 0.9)
    return OPPONENTS["omniscient_evader" if role == "chaser" else "omniscient_chaser"]


# ------------------------------------------------------------------------------------ 2. FITNESS
def score(role, tag_tick, mean_distance, final_distance, mean_open):
    """Turn one match into a number. <-- CHANGE ME. This is the heart of the game: evolution only ever chases this number.
    Good fitness functions reward progress, not only the final result, because a network that never wins gets no signal.
    But the final result must clearly beat the progress terms, or the agent learns to farm progress instead of winning
    (for example circling close to the opponent forever, which scores well on "closeness" but never tags).
    tag_tick is -1 if nobody was tagged. mean_open is how open the space around the agent was on average: about 0.4 in a corner,
    0.6 along a wall, 1.0 in open floor. Rewarding it teaches agents to stay out of corners, which is where chasers corner evaders."""
    tagged = tag_tick >= 0
    if role == "chaser":
        closeness = np.clip(1.0 - mean_distance / 25.0, 0.0, 1.0)         # stayed near the evader on average: up to 1
        finish = np.clip(1.0 - final_distance / 25.0, 0.0, 1.0)           # and was still near it at the end: up to 1
        speed_bonus = 1.0 - tag_tick / TRAIN_TICKS                         # tagging sooner is better: up to 1
        progress = 0.6 * closeness + 0.4 * finish + 0.2 * mean_open
        return np.where(tagged, 2.0 + speed_bonus, progress)    # a tag is worth more than any amount of closeness
    survival = np.where(tagged, tag_tick, TRAIN_TICKS) / TRAIN_TICKS         # lasting longer is better: up to 1
    distance = np.clip(mean_distance / 25.0, 0.0, 1.0)                   # staying far away is better: up to 1
    return np.where(tagged, survival, 2.0) + 0.5 * distance + 0.5 * mean_open   # surviving to the end beats any amount of running


def evaluate(role, net, population, arenas, opponent, start_seeds):
    """Play every network in the population on every arena. Returns (fitness (P,), win_rate (P,)).
    All networks get the same start positions, so score differences come from the networks, not from luck."""
    P, col = len(population), [CATALOG.index(n) for n in INPUTS]
    me = CHASER if role == "chaser" else EVADER
    fitness, wins = np.zeros(P), np.zeros(P)
    for arena, start_seed in [(a, s) for a in arenas for s in start_seeds]:
        env = TagEnv(arena, batch=P)
        env.reset(start_seed)
        dist_sum, open_sum, ticks = np.zeros(P), np.zeros(P), 0
        open_map = openness_map(arena)                                   # 0.4 in corners ... 1.0 in open floor
        while not env.all_done and env.tick[0] < TRAIN_TICKS:
            mine = net.forward_pop(population, env.observe(role)[:, col])
            theirs = opponent(env)
            env.step(mine, theirs) if role == "chaser" else env.step(theirs, mine)
            dist_sum += env.distance()
            cell = env.pos[:, me].astype(int)
            open_sum += open_map[cell[:, 1], cell[:, 0]]
            ticks += 1
        fitness += score(role, env.tag_tick, dist_sum / ticks, env.distance(), open_sum / ticks)
        wins += (env.tag_tick >= 0) if role == "chaser" else (env.tag_tick < 0)
    n = len(arenas) * len(start_seeds)
    return fitness / n, wins / n


# ------------------------------------------------------------------------------ 3-5. NEW GENERATION
def next_generation(population, fitness, rng, progress, mutation_size=None):
    """progress runs from 0.0 (first generation) to 1.0 (last). Returns the next population."""
    P, n = population.shape
    order = np.argsort(-fitness)
    new = [population[i] for i in order[:ELITE]]                                  # elitism

    def pick_parent():                                                           # 3. selection (tournament)
        contenders = rng.integers(0, P, TOURNAMENT)
        return population[contenders[np.argmax(fitness[contenders])]]

    lo, hi = mutation_size or MUTATION_SIZE
    size = lo + (hi - lo) * progress
    while len(new) < P:
        a, b = pick_parent(), pick_parent()
        child = np.where(rng.random(n) < 0.5, a, b)                              # 4. crossover (uniform)
        hit = rng.random(n) < MUTATION_RATE                                      # 5. mutation
        child = child + hit * rng.normal(0.0, size, n)
        new.append(np.clip(child, -WEIGHT_LIMIT, WEIGHT_LIMIT))
    return np.array(new)


# ----------------------------------------------------------------------------------------- the loop
def save_demo_replay(role, agent, opponent, arena, path):
    env = TagEnv(arena, batch=1, record=True)
    env.reset(1)
    while not env.all_done:
        mine = agent.act(env.observe(role))
        theirs = opponent(env)
        env.step(mine, theirs) if role == "chaser" else env.step(theirs, mine)
    names = (agent.name, "Sparring partner") if role == "chaser" else ("Sparring partner", agent.name)
    colors = (agent.color, "#888888") if role == "chaser" else ("#888888", agent.color)
    with open(path, "w") as f:
        json.dump(build_replay(env, 0, names, colors), f)


def train(role, generations, opponent_name, seed, out_dir, name, replay_every, start_from=None, scratch=False,
          arena_dir=None, color=None, opponent_file=None):
    global INPUTS, LAYERS
    color = color or COLORS[role]
    for what, value, pattern in (("name", name, SPEC["agent_file"]["name_pattern"]), ("color", color, SPEC["agent_file"]["color_pattern"])):
        if not re.fullmatch(pattern, value):                                          # fail now, not after the training run
            raise SystemExit(f"The {what} {value!r} is not allowed (it must match {pattern}).")
    rng = np.random.default_rng(seed)
    seed_agent = None
    if not start_from and not scratch and os.path.exists(STARTER.format(role=role)):
        start_from = STARTER.format(role=role)      # by default begin from the starter weights (see seed_network.py)
    if start_from:                                  # keep training an agent you already have (same role, its own shape)
        seed_agent = load_agent(start_from)
        if seed_agent.role != role:
            raise SystemExit(f"{start_from} is a {seed_agent.role}, but you asked to train the {role}.")
        INPUTS, LAYERS = seed_agent.inputs, seed_agent.layers
    net = Network(len(INPUTS), LAYERS)
    if opponent_file:
        opponent_name = os.path.basename(opponent_file)
    print(f"\nTraining the {role} against '{opponent_name}'\n{describe(INPUTS, LAYERS).splitlines()[0]}\n"
          f"{describe(INPUTS, LAYERS).splitlines()[1]}\n")
    if arena_dir:                                                                   # your own arenas: every .txt file in the folder
        files = sorted(f for f in os.listdir(arena_dir) if f.endswith(".txt"))
        if not files:
            raise SystemExit(f"No .txt arena files found in {arena_dir}")
        arenas = [load_arena(os.path.join(arena_dir, f)) for f in files]          # a bad arena stops here with a plain explanation
        print(f"Training on {len(arenas)} of your arenas: {', '.join(files)}")
    else:
        arenas = [generate_arena(1000 + i) for i in range(TRAIN_ARENAS)]           # <-- CHANGE ME: make as many as you like
    demo_arena = generate_arena(77)
    opponent = partner_for(role, opponent_name, opponent_file)
    fan_in = np.sqrt(len(INPUTS))
    population = rng.normal(0.0, INIT_SCALE / fan_in, (POPULATION, net.n_params))  # 1. population
    if seed_agent is not None:                      # start from the saved weights, with small random differences
        population = seed_agent.weights + rng.normal(0.0, SEEDED_MUTATION_SIZE[1], population.shape) * (rng.random(population.shape) < MUTATION_RATE)
        population[0] = seed_agent.weights
    os.makedirs(os.path.join(out_dir, "replays"), exist_ok=True)
    started = time.time()
    for gen in range(1, generations + 1):
        fitness, win_rate = evaluate(role, net, population, arenas, opponent, start_seeds=[(gen // STARTS_CHANGE_EVERY) * 100 + k for k in range(STARTS)])
        i = int(np.argmax(fitness))
        print(f"gen {gen:4d} | best {fitness[i]:.3f}  average {fitness.mean():.3f} | "
              f"best network wins {100 * win_rate[i]:3.0f}% | population wins {100 * win_rate.mean():3.0f}% | "
              f"{time.time() - started:5.0f}s")
        if replay_every and (gen == 1 or gen % replay_every == 0):
            champ = Agent(make_agent_dict(name, role, color, INPUTS, LAYERS, population[i]))
            save_demo_replay(role, champ, opponent, demo_arena, os.path.join(out_dir, "replays", f"gen_{gen:04d}.json"))
        population_before_breeding = population
        population = next_generation(population, fitness, rng, gen / generations, SEEDED_MUTATION_SIZE if seed_agent else None)
    # Final exam: the top networks of the last generation play on start positions none of them has seen. The winner is saved.
    finalists = population_before_breeding[np.argsort(-fitness)[:8]]
    exam, _ = evaluate(role, net, finalists, arenas, opponent, start_seeds=list(range(9000, 9006)))
    best_weights = finalists[int(np.argmax(exam))]
    path = os.path.join(out_dir, f"{name.replace(' ', '_').lower()}.json")
    save_agent(path, name, role, color, INPUTS, LAYERS, best_weights,
               notes=f"Starter trainer, {generations} generations vs {opponent_name}.")
    print(f"\nSaved the best network to {path}\nCheck it with:  python validate_agent.py {path}")
    return path


def main():
    global TRAIN_TICKS, TRAIN_ARENAS, POPULATION
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--role", choices=["chaser", "evader"], required=True)
    ap.add_argument("--generations", type=int, default=60)
    ap.add_argument("--opponent", choices=OPPONENT_CHOICES, default="wanderer")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="training_out")
    ap.add_argument("--name", help="agent name (default: My Chaser / My Evader)")
    ap.add_argument("--scratch", action="store_true", help="start from random weights instead of the starter weights")
    ap.add_argument("--start-from", help="an agent file to keep training (same role); its network shape is used")
    ap.add_argument("--opponent-file", help="an agent file of the other role to train against (overrides --opponent)")
    ap.add_argument("--arenas", help="folder of your own arena .txt files to train on (see GUIDE.md)")
    ap.add_argument("--color", help="capsule color for your agent, like #ff8800")
    ap.add_argument("--num-arenas", type=int, help=f"how many generated arenas to train on (default {TRAIN_ARENAS}); more arenas means less memorizing")
    ap.add_argument("--population", type=int, help=f"networks per generation (default {POPULATION})")
    ap.add_argument("--ticks", type=int, help=f"length of training matches (default {TRAIN_TICKS}; real matches last 400)")
    ap.add_argument("--replay-every", type=int, default=10, help="save a watchable replay every N generations (0 = never)")
    a = ap.parse_args()
    if a.num_arenas:
        TRAIN_ARENAS = max(1, a.num_arenas)
    if a.population:
        POPULATION = max(ELITE + 2, a.population)
    if a.ticks:
        TRAIN_TICKS = max(20, min(400, a.ticks))
    train(a.role, a.generations, a.opponent, a.seed, a.out, a.name or f"My {a.role.title()}", a.replay_every, a.start_from, a.scratch, a.arenas, a.color, a.opponent_file)


if __name__ == "__main__":
    main()
