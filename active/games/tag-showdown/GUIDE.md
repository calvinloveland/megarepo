# Tag Showdown: The Complete User's Guide

You will train a small neural network to play **tag** using **evolution** (a genetic algorithm), then enter it in a
tournament. Your entire submission is **one JSON file of numbers (weights)**. You never submit code.

This guide takes you from "run one command" to "write your own training algorithm with an AI assistant". Start at the level that
fits you and go as far as you like.

| Level | You will | Time | Needs |
|---|---|---|---|
| **0** | Train a first agent and watch it play | 10 min | Nothing but the commands below |
| **1** | Change how the trainer evolves | 30 min | Editing a few numbers |
| **2** | Choose your own inputs and network shape | 30 min | Reading section 5 |
| **3** | Train in stages, on your own arenas, against any opponent | 1 hour | A little Python reading |
| **4** | Rewrite the fitness function and the evolution step | 1-2 hours | Python basics |
| **5** | Replace the trainer with your own (written with AI help) | open-ended | An AI assistant |

**Contents:** [1 Concepts](#1-before-you-start-concepts-and-videos) · [2 Level 0](#2-level-0-your-first-agent) ·
[3 Rules](#3-the-rules-of-the-world-locked) · [4 Inputs and outputs](#4-what-your-network-sees-and-does) ·
[5 Network size](#5-your-network-shape-and-its-size-budget) · [6 Levels 1-2](#6-levels-1-and-2-tune-the-trainer-reshape-the-network) ·
[7 Levels 3-4](#7-levels-3-and-4-staged-training-arenas-opponents-and-your-own-fitness) ·
[8 Level 5](#8-level-5-write-your-own-training-algorithm-with-ai-help) · [9 Compliance](#9-tournament-compliance-checking-your-weights) ·
[10 Testing](#10-testing-before-you-submit) · [11 Submitting](#11-submitting) · [12 Troubleshooting](#12-troubleshooting) ·
[13 Learning links](#13-learning-links-watch-and-read)

---

## 1. Before you start: concepts and videos

**A neural network** here is a small function. It takes numbers in (what the agent senses), multiplies and adds them through a few
layers, and outputs two numbers (how much to turn, how hard to move). The multipliers are called **weights**. "Training" means finding
good weights. A weights file is a complete description of how your agent plays.

**A genetic algorithm (GA)** finds good weights by evolution instead of calculus: make many networks with different weights, let them
play, keep and copy the ones that score well, nudge the copies randomly (mutation), and repeat. Each round is a **generation**. A GA
combined with a neural network is called **neuroevolution**, which is exactly what this project does.

**Why this works:** nobody tells the network how to catch someone. It is only ever given a score, and evolution discovers behaviour that
raises the score. That also means it will happily raise the score in ways you did not intend (see "the circling trap" in section 7).

> **Watch first.** [Section 13](#13-learning-links-watch-and-read) is a short viewing path. If you only watch two things:
> *But what is a neural network?* (3Blue1Brown) and *9.1 Genetic Algorithm: Introduction* (The Coding Train).

---

## 2. Level 0: your first agent

You need Python 3.9+ and numpy (`pip install numpy`). Open a terminal in the project folder.

```bash
python trainer.py --role chaser --generations 100        # about 1-2 minutes; prints progress every generation
python validate_agent.py training_out/my_chaser.json     # must end with: PASS: ready to compete.
python server.py                                         # then open the address it prints in your browser
```

In the page, drop in your file (and a file of the other role), then run the best-of-five. During a face-off, the **show sensed cells** checkbox tints the cells each agent's network is reading (its block inputs), so you can see what it can and cannot see. The **data** panel on the left shows each agent's live position, heading and speed, and the distance between them. You can also try the baselines to see two
example agents play.

- The trainer saves your agent in `training_out/`, named after the agent (`My Chaser` becomes `my_chaser.json`; the end of the run
  prints the exact path and the validate command).
- It also saves replays in `training_out/replays/`. Drop several `gen_*.json` files into the viewer to **watch your agent improve**.
- Train the evader with `--role evader`. You may enter one role or both.
- Name and color: `--name "Team Hotdog" --color #ff8800`.

**Reading the progress lines**

```
gen   40 | best 1.382 ... | best network wins  75% | population wins  28% | ...
```

`best` and `average` are fitness scores (higher is better). `population wins` is the share of all networks that won their matches.
If these trend upward over generations, evolution is working. They jump every 25 generations on purpose, because the start positions
change then. At the end the top networks take a final exam on start positions none of them has seen, and the winner is saved.

**Level 0 done when:** you have a file that says PASS and you have watched it play.

---

## 3. The rules of the world (locked)

Everyone shares these. They are written in full in **`CONTRACT.md`** (and `env_spec.json` for programs). The simulation is identical in
training and in the tournament, so what your agent learns is true in the final.

- Arenas are grids of cells: `#` wall, `.` floor, `~` mud. Mud halves your speed (it does not affect turning).
- One **tick** is 0.1 s. A match lasts at most **400 ticks** (40 s).
- The **chaser** wins by getting within **0.7** of the evader. The **evader** wins by surviving all 400 ticks.
- The roles are not symmetric:

| | Top speed | Turn rate |
|---|---|---|
| Chaser | 3.3 cells/s | 3.0 rad/s |
| Evader | 3.0 cells/s | 5.0 rad/s |

The chaser is faster in a straight line; the evader turns tighter. Corners and walls decide matches.

- Your agent is a box 0.6 wide. It slides along walls and cannot pass through them. Agents do not collide with each other.
- Start positions and headings are random but set by the match seed, and the two agents start at least 14 cells apart.
- **Tournament format:** a chaser file plays an evader file, best of five on five 40x28 arenas generated from the organizer's secret seed;
  first to three wins. Nobody sees those arenas in advance, so overfitting to a few arenas will hurt you.
- These constants are still marked provisional until the organizer freezes them; `CONTRACT.md` is the final word.

---

## 4. What your network sees and does

### Outputs (fixed): exactly 2 numbers per tick, each clamped to [-1, 1]

| Output | Effect |
|---|---|
| `turn` | changes your heading (left/right) by up to the role's turn rate |
| `thrust` | speed is `top_speed x (thrust + 1) / 2` (times 0.5 on mud): -1 stands still, 0 is half speed, +1 is full speed |

### Inputs (your choice): any non-empty list from these 21, each at most once, in any order

| Input | Meaning |
|---|---|
| `blk_dx_dy` (13 of them: `blk_-2_-2` `blk_0_-2` `blk_2_-2` `blk_-1_-1` `blk_1_-1` `blk_-2_0` `blk_0_0` `blk_2_0` `blk_-1_1` `blk_1_1` `blk_-2_2` `blk_0_2` `blk_2_2`) | What is in the cell `dx` columns right and `dy` rows down from the cell you stand in: **0.0 floor, 0.5 mud, 1.0 wall** (outside the arena counts as wall). The 13 cells form a checkerboard in a 5x5 window. |
| `self_x` `self_y` | Your own position, scaled. |
| `heading_cos` `heading_sin` | The direction you face (y points down the screen). |
| `move_x` `move_y` | How far you actually moved last tick (after mud and walls), scaled. |
| `opp_x` `opp_y` | Your opponent's position, scaled, anywhere on the map, through walls. |

The exact scaling is in `CONTRACT.md`. **Notice what is missing:** there is no "direction to the opponent" or "distance to the opponent". The
network gets both positions and its own heading and must work out the direction itself. That is the hardest skill in this game, and why
the trainer begins from "starter weights" (section 6). A shorter input list means a smaller network that trains faster; a longer list gives it
more to work with.

---

## 5. Your network shape and its size budget

The network is fully connected: `inputs -> hidden layers -> 2 outputs`. You choose the inputs, the number of layers, the units per layer,
and each layer's activation (`tanh`, `relu`, `leaky_relu`, `sigmoid`, `linear`).

### The limits

| Limit | Value |
|---|---|
| Layers (hidden layers plus the output layer) | at most **6** |
| Units in one layer | at most **256** |
| Total weights and biases ("parameters") | at most **50,000** |
| Any single weight | between **-100 and 100** |
| Output layer | exactly **2** units |
| File size | at most **2 MB** |

### Counting parameters by hand

Each layer has `(inputs_to_that_layer + 1) x units` parameters (the +1 is the bias). Add up the layers.

| Shape | Calculation | Parameters |
|---|---|---|
| 6 inputs -> 16 -> 2 | 7x16 + 17x2 | 146 |
| 21 inputs -> 32 -> 2 | 22x32 + 33x2 | 770 |
| 21 inputs -> 64 -> 64 -> 2 | 22x64 + 65x64 + 65x2 | 5,698 |
| 21 inputs -> 256 -> 128 -> 2 | 22x256 + 257x128 + 129x2 | 38,818 |

**Bigger is not automatically better.** More parameters is a larger search space, so evolution is slower. Most good agents here need well
under 10,000.

### Monitoring your size (four ways)

1. **The trainer prints it at the start of every run:**
   ```
   inputs 21 -> 32 (tanh) -> 2 (tanh)
   layers 2 of 6 | widest 32 of 256 | parameters 770 of 50,000 (1.5%)
   ```
2. **The validator prints it for any file**, even a broken one: `python validate_agent.py my_agent.json`
3. **In your own code:**
   ```python
   from agent import describe, param_count, LIMITS
   inputs = ["opp_x", "opp_y", "self_x", "self_y", "heading_cos", "heading_sin"]
   layers = [{"units": 16, "activation": "tanh"}, {"units": 2, "activation": "tanh"}]
   print(describe(inputs, layers))        # same summary as above, plus which inputs are used and unused
   assert param_count(len(inputs), layers) <= LIMITS["max_total_parameters"]
   ```
4. **From a saved file**, without running a match:
   ```python
   import json
   d = json.load(open("my_agent.json"))
   print(len(d["weights"]), "weights;", [l["units"] for l in d["layers"]], "units per layer")
   ```

---

## 6. Levels 1 and 2: tune the trainer, reshape the network

Open `trainer.py`. The settings are at the top, and the lines marked `<-- CHANGE ME` are the best places to start. It is short enough to
read once all the way through.

### How the trainer works

1. **Population:** 64 networks of the same shape, each a long list of weights.
2. **Fitness:** every network plays a sparring partner and gets a score from `score()`. The algorithm only ever optimizes this number.
3. **Selection:** better networks are more likely to become parents (small tournaments of 4).
4. **Crossover:** a child takes each weight from one of two parents.
5. **Mutation:** a quarter of the weights get a random nudge. This is where new behaviour comes from.
6. **Elitism:** the best 4 networks are copied unchanged, so progress is never lost. Repeat.

**Starter weights.** By default the trainer does not start from random numbers. It starts from `starters/starter_chaser.json` or
`starter_evader.json`, made by `seed_network.py` (about 30 seconds of ordinary supervised learning). The starter knows how to steer toward
(chaser) or away from (evader) the opponent and **nothing else**: it is blind to walls and mud and has no tactics. Evolution supplies the rest.
Use `--scratch` to evolve from random weights and see how much slower that is.

### Level 1: things to try (change one thing, retrain, compare)

| Change | Where | What to look for |
|---|---|---|
| `MUTATION_RATE` 0.25 -> 0.05 or 0.6 | top of `trainer.py` | Too low: stuck. Too high: erratic. |
| `MUTATION_SIZE` | same | Size of each nudge, shrinking over the run. |
| `POPULATION` 64 -> 16 or 200 (or `--population`) | same | Variety versus speed. |
| `TOURNAMENT` 4 -> 2 or 8 | same | How strongly the best are favored. |
| `ELITE` 4 -> 0 | same | What happens when progress can be lost? |
| `--generations 300` | command line | Does it keep improving, or plateau? |
| `--opponent still / wanderer / omniscient` | command line | Easy, moderate, and hard sparring partners. |
| `--num-arenas 8` | command line | More arenas means less memorizing. |

Sparring partners: `still` stands still; `wanderer` is a smooth random walker that is attracted to you (when you train an evader) or
repelled by you (when you train a chaser); `omniscient` is a scripted bot that sees the whole map and plays well.

### Level 2: choose your own inputs and shape

**Important:** by default the trainer adopts the shape of the starter file (21 inputs -> 32 -> 2). To use a different shape you have two options.

- **Option A, with a head start (one hidden layer):** edit `INPUTS` and `LAYERS` in `seed_network.py` (one hidden layer, any width, `tanh`;
  the last layer stays at 2 units), run `python seed_network.py` (this rewrites `starters/`), then train as usual. The trainer adopts the
  new starter's shape.
  ```python
  INPUTS = ["self_x", "self_y", "heading_cos", "heading_sin", "opp_x", "opp_y", "blk_0_0", "blk_1_1", "blk_-1_-1"]
  LAYERS = [{"units": 16, "activation": "tanh"}, {"units": 2, "activation": "tanh"}]
  ```
- **Option B, from scratch (any shape, up to 6 layers):** edit `INPUTS` and `LAYERS` in `trainer.py` and run with `--scratch`. It learns
  more slowly because there is no steering head start.

Ideas: remove every block sensor and see whether the agent still learns (it will be blind to walls). Add `move_x`/`move_y`. Try two hidden
layers. Try `relu`. After each change read the `parameters` line and compare results at the same number of generations.

**Levels 1-2 done when:** you can explain why one of your changes helped or hurt.

---

## 7. Levels 3 and 4: staged training, arenas, opponents, and your own fitness

### Level 3: train on your own terms

**Continue training:** `python trainer.py --role chaser --start-from training_out/my_chaser.json --generations 100` keeps improving a saved
agent, using its shape.

**Train in stages:** start against `still`, continue against the `wanderer`, then finish against `omniscient`, each stage starting from the
previous result.

**Train against a specific agent:** `--opponent-file baselines/baseline_evader.json` trains against any file of the *other* role, including
the baselines or your own earlier agents. `baseline_chaser.json` is a capable chaser, so it is a hard exam for an evader;
`baseline_evader.json` is a weaker evader. **Self-play:** evolve a chaser against your own evader, then the evader against your new chaser,
and repeat.

**Match length:** `--ticks 400` trains on full-length matches. The default (200) is faster, but real matches last 400, and an evader that
only has to survive 20 seconds is not ready for 40.

**Your own arenas:** an arena is a text file with one character per cell. Check it with `python arena.py my_arena.txt`, which lists every
problem in plain language. `arenas/` has complete examples. The rules: 30-48 wide, 20-32 tall, walls all around the edge, at most 25%
of the interior walls, at most 25% of the walkable area mud, everything walkable connected, obstacles at least 2 cells apart, and room to
start 14 cells apart.

Make a set quickly with `python generate.py --seed 7 --count 6 --out my_arenas`, hand-edit a few, then train with
`--arenas my_arenas`. **The tournament arenas come from a secret seed**, so mix open arenas, mazes, and mud-heavy ones.

### Level 4: rewrite the fitness and the evolution step

Two functions in `trainer.py` matter most:

**`score(role, tag_tick, mean_distance, final_distance, mean_open)`** turns one match into a number. Evolution chases this number and nothing
else, so this is where you decide what "good" means. As shipped, the chaser is rewarded for staying close and finishing close, with a big
bonus for a tag (sooner is better). The evader is rewarded for lasting, keeping its distance, and staying in open space away from corners,
with a big bonus for surviving to the end. Ideas: reward avoiding mud, reward the evader for using the whole arena, penalize standing still,
reward the chaser for closing speed.

> **The circling trap.** If "getting close" is worth almost as much as a real tag, a chaser learns to circle the opponent forever: it scores
> well on closeness and never has to tag. The final result (a tag, or surviving) must be worth clearly more than any amount of progress
> reward. If your agent spins, check this first.

**`next_generation`-style code** (selection, crossover, mutation) is the other half. Ideas: shrink mutation as the run goes on (already done),
mutate one layer harder than the others, replace tournament selection with "keep the top 20%", or run a second population that trains the
opposing role and take turns (co-evolution).

**Levels 3-4 done when:** you have an agent trained on your own arenas against more than one opponent that does something the default
trainer's agent does not.

---

## 8. Level 5: write your own training algorithm with AI help

You may replace `trainer.py` entirely. Your trainer is just a program that ends by calling `save_agent(...)`. The tournament never sees it,
only the weights file.

### What any trainer must do

`examples/ga_template.py` is a complete, working, short trainer written from scratch (an evolution strategy, a cousin of the GA). Read it first;
it shows the five jobs every trainer has:

1. **Choose the shape** (`INPUTS`, `LAYERS`) and print the size.
2. **Make a starting point or population:** weight vectors of length `n_params = param_count(len(INPUTS), LAYERS)`.
3. **Score** every member by playing matches in the locked environment.
4. **Make the next population** from the scores. This is the only part that differs between algorithms.
5. **Save** the best weights with `save_agent(...)`, which refuses to write an invalid file.

Run it: `python examples/ga_template.py --role chaser --generations 40` (about 30 seconds).

### The library your trainer can use

It is all in the project folder and none of it is required.

| You want to | Use |
|---|---|
| Run many matches at once | `env = TagEnv(arena, batch=P)`, `env.reset(seed)`, `env.observe(role)` -> `(P, 21)`, `env.step(chaser_actions, evader_actions)` |
| Check how matches ended | `env.all_done`, `env.done`, `env.winner` (1 chaser, 2 evader), `env.tag_tick` (-1 if never tagged), `env.distance()`, `env.pos` |
| Run a whole population through a network | `Network(n_inputs, layers).forward_pop(weights, inputs)` with `weights` shaped `(P, n_params)` |
| Get arenas | `generate_arena(seed)` or `arena.load_arena(path)` |
| Practice opponents | `OPPONENTS["omniscient_chaser"]` / `["omniscient_evader"]`, `wanderers.wanderer(...)`, or a loaded agent via `load_agent(path)` |
| Check size and rules | `describe(...)`, `param_count(...)`, `check_agent_file(path)`, `LIMITS` |
| Save | `save_agent(path, name, role, color, inputs, layers, weights, notes=None)` |

Conventions: agent 0 is always the chaser and agent 1 the evader, and `env.observe(role)` returns all 21 catalog columns in catalog order.
Select your columns with `[CATALOG.index(n) for n in INPUTS]` (see the template).

### Prompt to give an AI assistant

Attach `CONTRACT.md`, `trainer.py`, and `examples/ga_template.py`, then paste something like this (fill in the brackets):

> I am entering a tag-playing neural network tournament. My submission is only a weights JSON file, produced by a training script I run
> locally. I am training the **[chaser / evader]**.
>
> Attached: `CONTRACT.md` (the locked rules), `trainer.py` (a starter genetic algorithm), and `examples/ga_template.py` (a minimal from-scratch
> trainer that shows the library calls).
>
> Please write a new training script, `my_ga.py`, that:
> 1. uses the project's `TagEnv`, `Network.forward_pop`, `generate_arena`, and `save_agent` exactly as `ga_template.py` does (do not
>    modify the environment);
> 2. implements **[your idea, e.g. "an island model with 4 sub-populations that exchange their best member every 10 generations"]**;
> 3. prints the network size with `describe(...)` at the start and asserts it is within the limits in the contract;
> 4. clips every weight to [-100, 100] before scoring and saving, and finishes by running `check_agent_file` on the saved file;
> 5. is fast: evaluates the whole population in batched numpy, with no per-network Python loops over ticks;
> 6. explains each design choice in comments, because I want to understand why it should help.
>
> Start simple. After it runs, I will tell you what the progress output looks like and we will improve it together.

**Work in small steps.** Get it running for 3 generations first, then 30, then the full run. Paste any error back to the assistant.

### Things AI-written trainers commonly get wrong

| Problem | What to check |
|---|---|
| Outputs treated as 0..1 | Outputs are [-1, 1] and the environment clamps them. A `thrust` of -1 means stand still. |
| Wrong weight count | `n_params = sum((inputs_to_layer + 1) x units)`. Use `param_count`, never a hand-typed number. |
| Weights drift out of range | Mutation can push weights past +-100. `np.clip` before scoring and before saving. |
| NaN or infinity | Huge weights can overflow. Clip, and check `np.isfinite(weights).all()`. |
| Fitness rewards the wrong thing | Watch replays. If the agent circles, stands still, or hugs a wall, see "the circling trap" in section 7. |
| Memorizing the training arenas | Train on several arenas, rotate start positions, and test on arenas you did not train on. |
| Evaluating one network at a time | A loop over networks then ticks is far slower. Use `TagEnv(batch=P)` with `forward_pop`. |
| Role mix-up | A chaser file must say `"role": "chaser"`. |
| Only training 200 ticks | Real matches last 400. Test with `match.py`. |

**Level 5 done when:** you have a trainer you wrote or directed and a file from it that says PASS.

---

## 9. Tournament compliance: checking your weights

The tournament runs the same code as `validate_agent.py`. If the validator says PASS, your file will load and play. Run it often.

```bash
python validate_agent.py my_chaser.json              # full check, including a short test match
python validate_agent.py my_chaser.json --no-smoke   # skip the test match (faster)
```

It reports **every** problem at once, in plain language.

### The standards

| # | Standard | Limit |
|---|---|---|
| 1 | File is valid UTF-8 JSON, a single object | no `NaN`/`Infinity`, at most 2 MB |
| 2 | `schema_version` and `env_version` | `1` and `"1.0"` |
| 3 | Required keys | `schema_version`, `env_version`, `name`, `role`, `color`, `inputs`, `layers`, `weights` (`notes` optional, at most 500 characters) |
| 4 | `name` | 1-24 characters: letters, numbers, spaces, and `_ . ' ! -` |
| 5 | `role` | `"chaser"` or `"evader"` |
| 6 | `color` | `#rrggbb`, for example `#ff8800` |
| 7 | `inputs` | a non-empty list of names from the catalog, each at most once |
| 8 | `layers` | at most 6; each `{"units": N, "activation": ...}`; N from 1 to 256; the last has exactly 2 units |
| 9 | activations | `tanh`, `relu`, `leaky_relu`, `sigmoid`, `linear` |
| 10 | `weights` | exactly `sum((inputs_to_layer + 1) x units)` numbers; all finite; each between -100 and 100; total at most 50,000 |
| 11 | A 30-tick test match | the network runs and outputs finite numbers |

### What the messages mean and how to fix them

| The validator says (approximately) | Fix |
|---|---|
| `weights has N numbers but this network needs exactly M` | `weights` does not match `inputs` and `layers`. Recount with `param_count`. |
| `Largest allowed weight size is 100; entry 12 is 143.2` | `np.clip(weights, -100, 100)` before saving. |
| `weights must be finite numbers` / the file contains NaN | A weight became NaN or infinity (usually unclipped mutation). Find the cause, then clip. |
| `Unknown input 'oppx'; did you mean 'opp_x'?` | Input names are exact. Copy them from section 4. |
| `Inputs listed more than once` | Each input at most once. |
| `The last layer ... must have exactly 2 units` | The last layer is the output layer (turn, thrust). |
| `7 layers is over the limit of 6` / `Layer 0 has 300 units; the limit is 256` | Reduce layers or units. |
| `This network has 61,000 parameters; the limit is 50,000` | Make the network smaller; section 5 shows the sums. |
| environment version mismatch | Retrain with the current project, or set `env_version` to `"1.0"` if you changed nothing else. |
| color / name / role errors | Fix the text field as described in the table above. |
| `The file is not valid JSON` | A typo, a missing comma, or a file cut off while saving. |

### Making compliance automatic in your own code

`save_agent(...)` validates first and refuses to write a bad file, which also protects the end of a long run:

```python
import numpy as np
from agent import save_agent, check_agent_file
path = save_agent("my_chaser.json", "Team Hotdog", "chaser", "#ff8800", INPUTS, LAYERS, np.clip(best, -100, 100))
report = check_agent_file(path)
print("PASS" if report.ok else report.problems)
```

---

## 10. Testing before you submit

```bash
python validate_agent.py my_chaser.json
python match.py my_chaser.json baselines/baseline_evader.json --seed practice
python match.py my_chaser.json my_evader.json --seed 1 --out series.json      # drop series.json into the viewer
```

`match.py` plays the same best-of-five (first to three) the tournament plays. Use different `--seed` values to test on different arenas.

**Is my agent actually good?** Run several seeds against the baselines. A chaser should beat the baseline evader most of the time; an
evader should survive against the wanderer and sometimes against `baseline_chaser.json`. Always watch some matches in the viewer: numbers
cannot tell you whether the agent circles, hugs walls, or wastes thrust.

## 11. Submitting

1. `python validate_agent.py <file>` says **PASS: ready to compete.**
2. The file is under 2 MB and has your team name and a color.
3. Send only the `.json` file(s). **No code.** Chaser and evader are separate files, and you may enter either or both.
4. Optional: use the `notes` field (up to 500 characters) to describe how you trained it.

---

## 12. Troubleshooting

| Problem | Likely cause |
|---|---|
| The agent stands still or spins | Your fitness may reward it (section 7). Check what `score()` pays for standing still and circling. |
| The score never improves | Too much or too little mutation, or too few generations. Try `--generations 300`, then lower `MUTATION_SIZE`. |
| Great in training, poor in `match.py` | Overfit to your arenas or starts. Use `--num-arenas 8`, and `--ticks 400`. |
| It loses to the baselines | Train against them: `--opponent-file baselines/baseline_chaser.json`. |
| I changed the network shape and the trainer ignored it | The trainer adopts the starter's shape. Use `--scratch`, or rebuild the starter (section 6, Level 2). |
| Training is slow | Lower `--population`, `--num-arenas`, or `--ticks`. Layer width is the biggest cost. |
| The viewer says it cannot reach the server | `python server.py` is not running. |
| The viewer only shows a flat 2D view | It could not load three.js (needs the internet once). The game is unaffected. |
| I broke the project | Re-extract a fresh copy. Your trained `.json` files are the only thing to keep. |

---

## 13. Learning links: watch and read

A suggested viewing path, shortest first.

### Neural networks

1. **3Blue1Brown, "But what is a neural network?"**: what layers, weights, and biases are, with the best animations.
   <https://www.youtube.com/watch?v=aircAruvnKk> (lesson page: <https://www.3blue1brown.com/lessons/neural-networks/>)
2. **3Blue1Brown, "Gradient descent, how neural networks learn"**: how networks are *usually* trained. This project trains by evolution
   instead, and the contrast is worth knowing. <https://www.youtube.com/watch?v=IHZwWFHWa-w>
3. **The Nature of Code, Chapter 10: Neural Networks** (free to read). <https://natureofcode.com/neural-networks/>

### Genetic algorithms

4. **The Coding Train, "9.1 Genetic Algorithm: Introduction"**: population, selection, crossover, and mutation. <https://www.youtube.com/watch?v=9zfeTw-uFCw>
5. **The Coding Train, "9.2 Genetic Algorithm: How it works"**. <https://www.youtube.com/watch?v=RxTfc4JLYKs>
6. **The Nature of Code, Chapter 9: Evolutionary Computing** (free to read); the fitness-function sections matter most for you.
   <https://natureofcode.com/genetic-algorithms/>
7. More: the full playlist <https://www.youtube.com/playlist?list=PLRqwX-V7Uu6bJM3VgzjNV5YxVxUwzALHV> and the Smart Rockets challenge
   <https://thecodingtrain.com/challenges/29-smart-rockets-in-p5js/>.

### Putting them together: neuroevolution (exactly what you are doing)

8. **The Coding Train, "11.1 Introduction to Neuroevolution"**. <https://www.youtube.com/watch?v=lu5ul7z4icQ>
9. **The Coding Train, "11.2 Neuroevolution: Crossover and Mutation"**: crossing and mutating *network weights*, as the trainer does.
   <https://www.youtube.com/watch?v=kCx2DElEpP8>
10. **The Coding Train, "Coding Challenge #100: Neuroevolution Flappy Bird"**: a game agent evolving from nothing. <https://www.youtube.com/watch?v=c6y21FkaUqw>
11. **SethBling, "MarI/O - Machine Learning for Video Games"**: an evolved network learning Super Mario World. <https://www.youtube.com/watch?v=qv6UVOQ0F44>
12. **The Nature of Code, Chapter 11: Neuroevolution** (free to read); also introduces NEAT, which evolves network structure.
    <https://natureofcode.com/neuroevolution/>

**Suggested order for an event:** items 1 and 4 before you start, item 8 before Level 1, items 2 and 9 before Level 4.

---

## Appendix: glossary

| Term | Meaning |
|---|---|
| Agent | A network plus its role, name, and color. Your submission. |
| Weights | The numbers a network is made of. |
| Parameters | Weights plus biases. The limit is 50,000. |
| Population | The group of networks evolved together. |
| Fitness | The score a network earns. The algorithm maximizes it. |
| Generation | One round of score, select, breed, mutate. |
| Selection / crossover / mutation | Choose parents / mix two parents' weights / random nudges. |
| Elitism | Copying the best few unchanged into the next generation. |
| Overfitting | Learning your training arenas and starts instead of the game. |
| Tick | One 0.1-second step of the simulation. |
| Sparring partner | The opponent you train against. |
