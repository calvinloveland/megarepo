"""CO-EVOLUTION TRAINER for the "taunt showdown": an evader that baits the seeker by hovering just
outside tag range, and a seeker (chaser) that is then trained to catch it.

This does not touch the locked environment. It only chooses INPUTS/LAYERS, plays matches through
`TagEnv`, and writes valid agent files with `save_agent`.

Two fitness functions (the whole personality of each role lives here):

  evader  "taunter"   reward = survive-the-match bonus
                              + time spent inside a distance BAND (close, but not close enough to be tagged)
                              + a little open-space preference so it does not back itself into a corner.
                      Surviving and taunting are weighted so the agent can drift through risky-but-close
                      behaviour instead of being locked into "run to the far corner".

  chaser  "seeker"    a tag is worth far more than any amount of merely getting closer, so the agent
                      cannot farm progress by circling. Progress terms (closing distance, pinning the
                      evader in low-openness cells) only exist to give a gradient before tags are found.

Usage:
    python taunt_ga.py --role evader --generations 200 --opponent-file baselines/baseline_chaser.json \
        --warm-start starters/starter_evader.json --out runs --name Taunter
    python taunt_ga.py --role chaser --generations 200 --opponent-file runs/taunter.json \
        --warm-start starters/starter_chaser.json --out runs --name Seeker
"""
import argparse
import json
import os
import re
import time

import numpy as np

from agent import LIMITS, Network, check_agent_file, describe, load_agent, save_agent
from arena import load_arena
from env import CHASER, EVADER, TagEnv
from generate import generate_arena
from opponents import OPPONENTS, _openness
from spec import CATALOG, MAX_TICKS, SPEC

# --------------------------------------------------------------------------- network shape
INPUTS = list(CATALOG)
LAYERS = [{"units": 32, "activation": "tanh"}, {"units": 2, "activation": "tanh"}]
WEIGHT_LIMIT = float(LIMITS["max_abs_weight"])

# --------------------------------------------------------------------------- taunt geometry
TAG_RADIUS = float(SPEC["tag"]["radius"])
NEAR = 1.05          # 0 reward at/below this (the tag radius is 0.7, so this is "dangerously close")
PLATEAU_LO = 1.6     # full reward from here ...
PLATEAU_HI = 4.5     # ... to here
FAR = 8.0            # taper to 0 by here


def taunt_reward(d, plateau_hi=None, far=None):
    """Per-tick 0..1 score: peaks while hovering in the teasing band [1.6, plateau_hi] cells, zero when glued on
    or absent. `far` is where the reward reaches 0. Defaults to the band currently being trained with."""
    plateau_hi = PLATEAU_HI if plateau_hi is None else plateau_hi
    far = FAR if far is None else far
    return np.clip((d - NEAR) / (PLATEAU_LO - NEAR), 0.0, 1.0) * np.clip((far - d) / (far - plateau_hi), 0.0, 1.0)


# --------------------------------------------------------------------------- fitness weights
EVADER_SURVIVE = 1.0     # a bonus for lasting the whole match; the clock-stops-on-tag structure already
                         # rewards surviving longer, because staying alive means more time in the band
EVADER_TAUNT = 5.0       # peak reward for a whole match spent hovering in the band. Larger than the survival bonus:
                         # closeness is the point, and a tag only stops the clock, so this cannot be farmed without
                         # also surviving longer.
EVADER_OPEN = 0.15       # mild preference for open ground over corners

CHASER_TAG = 4.0         # a tag is worth plainly more than any progress total below
CHASER_TAG_SPEED = 2.0   # extra for tagging sooner
CHASER_PROX = 0.8        # no-tag shaping: average closeness
CHASER_FINAL = 0.6       # no-tag shaping: closeness at the final tick
CHASER_CORNER = 0.4      # no-tag shaping: pinning the evader in low-openness space


# --------------------------------------------------------------------------- GA settings
POPULATION = 96
ELITE = 6
TOURNAMENT = 4
MUTATION_RATE = 0.25
MUTATION_SIZE = (0.6, 0.1)          # from scratch: big nudges that shrink
SEEDED_MUTATION_SIZE = (0.12, 0.025)  # warm start: gentle nudges
INIT_SCALE = 4.0
TRAIN_ARENAS = 4
ARENA_BLOCK = 30       # arenas are regenerated this often during training, so the agent cannot memorise them
HALL_PER_GEN = 4       # keep this many of each generation's best for the final held-out exam
HALL_MAX = 400         # ... up to this many candidates
STARTS = 2
STARTS_CHANGE_EVERY = 25


def partners_for(role, opponent_files):
    """Load one sparring partner per spec. A spec is an agent file path, or a built-in 'still' / 'wanderer' /
    'omniscient' (useful while teaching a taunter the basic idea). For the evader, extra partners are mixed in
    across arenas so the taunter does not memorise a single seeker; for the chaser, one file is the target."""
    from wanderers import wanderer
    want = "evader" if role == "chaser" else "chaser"
    other_idx = 1 if role == "chaser" else 0
    out = []
    for spec in opponent_files:
        if spec == "still":
            out.append((lambda env: np.tile([0.0, -1.0], (env.B, 1)), "Still"))
        elif spec == "wanderer":
            pull = -2.5 if role == "chaser" else 2.5
            out.append((lambda env, _p=pull: wanderer(env, other_idx, pull=_p, thrust=0.9), "Wanderer"))
        elif spec == "omniscient":
            key = "omniscient_evader" if role == "chaser" else "omniscient_chaser"
            out.append((OPPONENTS[key], "Omniscient"))
        else:
            other = load_agent(spec)
            if other.role != want:
                raise SystemExit(f"{spec} is a {other.role}; training the {role} needs a {want} as the partner.")
            out.append((lambda env, _a=other: np.clip(_a.act(env.observe(want)), -1.0, 1.0), other.name))
    return out


# --------------------------------------------------------------------------- scoring
def run_batch(role, net, population, arena, start, opponent, ticks, cols):
    """Play the whole population against one opponent on one arena from one start. Returns raw stats."""
    P = len(population)
    env = TagEnv(arena, batch=P)
    env.reset(start)
    open_map = _openness(arena)
    me = CHASER if role == "chaser" else EVADER
    opp = 1 - me
    s = dict(dist=np.zeros(P), taunt=np.zeros(P), self_open=np.zeros(P), opp_open=np.zeros(P))
    steps = 0
    while not env.all_done and steps < ticks:
        mine = net.forward_pop(population, env.observe(role)[:, cols])
        theirs = opponent(env)
        env.step(mine, theirs) if role == "chaser" else env.step(theirs, mine)
        d = env.distance()
        s["dist"] += d
        s["taunt"] += taunt_reward(d)
        cm = env.pos[:, me].astype(int)
        co = env.pos[:, opp].astype(int)
        s["self_open"] += open_map[cm[:, 1], cm[:, 0]]
        s["opp_open"] += open_map[co[:, 1], co[:, 0]]
        steps += 1
    n = max(steps, 1)
    s["mean_dist"] = s["dist"] / n
    s["taunt_frac"] = s["taunt"] / n
    s["self_open"] /= n
    s["opp_open"] /= n
    s["final_dist"] = env.distance()
    s["tagged"] = env.tag_tick >= 0
    s["tag_tick"] = env.tag_tick
    s["timeout"] = env.winner == 2
    return s


def fitness_of(role, s, ticks):
    """Turn stats into a fitness vector. Same numbers the progress lines print."""
    if role == "evader":
        survive = s["timeout"].astype(float)
        return (EVADER_SURVIVE * survive + EVADER_TAUNT * s["taunt_frac"] + EVADER_OPEN * s["self_open"])
    tagged = s["tagged"]
    speed = 1.0 - s["tag_tick"] / float(ticks)
    tag_score = CHASER_TAG + CHASER_TAG_SPEED * speed + 1.0 * np.clip(1.0 - s["final_dist"] / 10.0, 0.0, 1.0)
    progress = (CHASER_PROX * np.clip(1.0 - s["mean_dist"] / 20.0, 0.0, 1.0)
                + CHASER_FINAL * np.clip(1.0 - s["final_dist"] / 20.0, 0.0, 1.0)
                + CHASER_CORNER * (1.0 - s["opp_open"]))
    return np.where(tagged, tag_score, progress)


def evaluate(role, net, population, arenas, start_seeds, opponents, ticks, cols):
    """Mean fitness and win rate over every arena x start. `opponents[i]` plays on `arenas[i]`, so a taunter
    can be scored against several seekers at once. All networks share start positions, so scores differ
    because of the networks, not luck. Also returns per-network diagnostics for the progress line."""
    total = np.zeros(len(population))
    wins = np.zeros(len(population))
    diag = {k: np.zeros(len(population)) for k in ("mean_dist", "taunt_frac", "final_dist")}
    n = len(arenas) * len(start_seeds)
    for arena, opponent in zip(arenas, opponents):
        for start in start_seeds:
            s = run_batch(role, net, population, arena, start, opponent, ticks, cols)
            total += fitness_of(role, s, ticks)
            wins += s["timeout"].astype(float) if role == "evader" else s["tagged"].astype(float)
            for k in diag:
                diag[k] += s[k]
    for k in diag:
        diag[k] /= n
    return total / n, wins / n, diag


# --------------------------------------------------------------------------- new generation
def next_generation(population, fitness, rng, progress, mutation_size):
    P, n = population.shape
    order = np.argsort(-fitness)
    new = [population[i] for i in order[:ELITE]]

    def parent():
        c = rng.integers(0, P, TOURNAMENT)
        return population[c[np.argmax(fitness[c])]]

    lo, hi = mutation_size
    size = lo + (hi - lo) * progress
    while len(new) < P:
        a, b = parent(), parent()
        child = np.where(rng.random(n) < 0.5, a, b)
        hit = rng.random(n) < MUTATION_RATE
        child = child + hit * rng.normal(0.0, size, n)
        new.append(np.clip(child, -WEIGHT_LIMIT, WEIGHT_LIMIT))
    return np.array(new)


def train(role, opponent_files, generations, seed, out_dir, name, warm_start, scratch, color,
          arena_count, starts, ticks, replay_every, held_out):
    rng = np.random.default_rng(seed)
    color = color or ("#ff8800" if role == "chaser" else "#1d9bf0")
    for what, value, pattern in (("name", name, SPEC["agent_file"]["name_pattern"]),
                                 ("color", color, SPEC["agent_file"]["color_pattern"])):
        if not re.fullmatch(pattern, value):
            raise SystemExit(f"The {what} {value!r} is not allowed (it must match {pattern}).")

    partners = partners_for(role, opponent_files)
    partner_name = " + ".join(n for _, n in partners)
    seed_agent, net = None, Network(len(INPUTS), LAYERS)
    if warm_start and not scratch:
        if not os.path.exists(warm_start):
            raise SystemExit(f"--warm-start {warm_start} does not exist")
        seed_agent = load_agent(warm_start)
        if seed_agent.role != role:
            raise SystemExit(f"{warm_start} is a {seed_agent.role}, but you asked to train the {role}.")
        net = Network(len(seed_agent.inputs), seed_agent.layers)
    globals()["INPUTS"], globals()["LAYERS"] = (seed_agent.inputs, seed_agent.layers) if seed_agent else (INPUTS, LAYERS)
    cols = [CATALOG.index(n) for n in INPUTS]

    arenas = [generate_arena(1000 + i) for i in range(arena_count)]
    opponents = [partners[i % len(partners)][0] for i in range(arena_count)]
    exam_arenas = [generate_arena(5000 + i) for i in range(held_out)]
    exam_opponents = [partners[i % len(partners)][0] for i in range(held_out)]
    print(f"\n=== Training the {role} '{name}' against '{partner_name}' ===")
    print(describe(INPUTS, LAYERS))
    print(f"arenas {arena_count} train (rotated every {ARENA_BLOCK} gens) / {held_out} held out | starts {starts} | "
          f"match length {ticks} ticks | population {POPULATION} | generations {generations}\n")

    if seed_agent is not None:
        population = seed_agent.weights + rng.normal(0.0, SEEDED_MUTATION_SIZE[1], (POPULATION, net.n_params)) \
            * (rng.random((POPULATION, net.n_params)) < MUTATION_RATE)
        population[0] = seed_agent.weights
        mut = SEEDED_MUTATION_SIZE
    else:
        population = rng.normal(0.0, INIT_SCALE / np.sqrt(len(INPUTS)), (POPULATION, net.n_params))
        mut = MUTATION_SIZE

    started = time.time()
    hall = []   # a hall of fame: the best few networks of every generation, so a lucky early peak is not lost
    for gen in range(1, generations + 1):
        block = gen // ARENA_BLOCK
        arenas = [generate_arena(1000 + block * 64 + i) for i in range(arena_count)]
        starts_now = list(np.random.default_rng(700000 + block).integers(0, 10 ** 7, starts))
        fitness, win_rate, diag = evaluate(role, net, population, arenas, starts_now, opponents, ticks, cols)
        i = int(np.argmax(fitness))
        hall.extend(population[j].copy() for j in np.argsort(-fitness)[:HALL_PER_GEN])
        extra = (f"dist {diag['mean_dist'][i]:5.1f}  taunt {100 * diag['taunt_frac'][i]:3.0f}%"
                 if role == "evader" else f"dist {diag['mean_dist'][i]:5.1f}  final {diag['final_dist'][i]:4.1f}")
        print(f"gen {gen:4d} | best {fitness[i]:7.3f}  avg {fitness.mean():7.3f} | "
              f"best wins {100 * win_rate[i]:5.1f}%  pop wins {100 * win_rate.mean():5.1f}% | {extra} | "
              f"{time.time() - started:5.0f}s")
        population = next_generation(population, fitness, rng, gen / generations, mut)

    # Final exam: the whole hall of fame, scored on held-out arenas and unseen starts. Picking from the whole
    # run (not just the last generation) matters because a generation's training score depends on the arena
    # block it happened to be scored on.
    candidates = np.array(hall[-HALL_MAX:])
    exam, exam_wins, _ = evaluate(role, net, candidates, exam_arenas, list(range(9000, 9000 + 4)), exam_opponents,
                                  ticks, cols)
    best = candidates[int(np.argmax(exam))]
    path = os.path.join(out_dir, f"{name.replace(' ', '_').lower()}.json")
    os.makedirs(out_dir, exist_ok=True)
    save_agent(path, name, role, color, INPUTS, LAYERS, best,
               notes=f"Co-evolution trainer, {generations} generations vs {partner_name}.")
    report = check_agent_file(path)
    print(f"\nSaved {path}  (exam best {exam.max():.3f}, exam win {100 * exam_wins[int(np.argmax(exam))]:.0f}%)")
    print("validator:", "PASS: ready to compete." if report.ok else report.problems)
    return path


def main():
    global POPULATION, ELITE, EVADER_SURVIVE, EVADER_TAUNT, PLATEAU_HI, FAR, ARENA_BLOCK
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--role", choices=["chaser", "evader"], required=True)
    ap.add_argument("--opponent-file", nargs="+", required=True,
                    help="one or more agent files of the OTHER role to train against (they are mixed across arenas)")
    ap.add_argument("--generations", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="runs")
    ap.add_argument("--name", required=True)
    ap.add_argument("--warm-start", help="agent file of the SAME role to continue from (its shape is used)")
    ap.add_argument("--scratch", action="store_true")
    ap.add_argument("--color")
    ap.add_argument("--num-arenas", type=int, default=TRAIN_ARENAS)
    ap.add_argument("--starts", type=int, default=STARTS)
    ap.add_argument("--ticks", type=int, default=MAX_TICKS)
    ap.add_argument("--population", type=int, default=POPULATION)
    ap.add_argument("--held-out", type=int, default=4)
    ap.add_argument("--replay-every", type=int, default=0)
    ap.add_argument("--survive-weight", type=float, help="override the evader survival bonus")
    ap.add_argument("--taunt-weight", type=float, help="override the evader taunt reward weight")
    ap.add_argument("--plateau-hi", type=float, help="override the inner edge of the taunt band")
    ap.add_argument("--far", type=float, help="override the distance where the taunt reward reaches 0")
    ap.add_argument("--arena-block", type=int, help=f"regenerate the training arenas this often (default {ARENA_BLOCK})")
    a = ap.parse_args()
    if a.arena_block:
        ARENA_BLOCK = a.arena_block
    if a.survive_weight is not None:
        EVADER_SURVIVE = a.survive_weight
    if a.taunt_weight is not None:
        EVADER_TAUNT = a.taunt_weight
    if a.plateau_hi is not None:
        PLATEAU_HI = a.plateau_hi
    if a.far is not None:
        FAR = a.far
    POPULATION = max(ELITE + 4, a.population)
    train(a.role, a.opponent_file, a.generations, a.seed, a.out, a.name, a.warm_start, a.scratch, a.color,
          a.num_arenas, a.starts, min(a.ticks, MAX_TICKS), a.replay_every, a.held_out)


if __name__ == "__main__":
    main()
