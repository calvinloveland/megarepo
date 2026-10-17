# Tag Showdown — taunter & seeker (Calvin Loveland)

A local clone of [`jcbhmphrs733/tag_v2`](https://github.com/jcbhmphrs733/tag_v2) plus a co-evolution
trainer and the two trained agents it produced:

* **Taunter** (`results/taunter.json`, evader) — deliberately hangs around just outside tag range. Its
  objective is *time spent in the band [1.6, 4.5] cells from the seeker*; surviving is only a small bonus.
* **Seeker** (`results/seeker.json`, chaser) — trained last, against the frozen taunter. Its objective is
  tag-first: a tag is worth far more than any amount of merely getting closer.

Both files pass `python validate_agent.py` ("PASS: ready to compete.").

## Head-to-head (20 best-of-five series, 100 matches, unseen arenas/starts)

```
series won by seeker:  17/20   (85%)
matches:               100     seeker tags 69 (69%) | taunter survives 31 (31%)
mean distance:         10.31   mean band fraction [1.6, 4.5]: 0.32
mean tag time:         16.8s
distance histogram:    3% <1.6 | 19% 1.6-4.5 | 23% 4.5-8 | 21% 8-12 | 33% >12
median distance:       8.76
```

The taunter's median distance is under 9 cells and it darts inside 4.5 cells a fifth of the time, so it is
always breathing on the seeker — but it pays for that with the 69% tag rate. Full output in
`results/head_to_head_measure.txt`; a viewable series is in `results/series_seeker_vs_taunter.json`.

The agents are the end of an arms race (each timestamp is a snapshot in `results/pipeline/`):

| Step | File | Role | Warm start | Objective | Gens | Result |
|---|---|---|---|---|---|---|
| T1 | `taunter_t1.json` | evader | `baselines/baseline_evader.json` | taunt | 180 | hovers, survives 85% vs `starter_chaser` |
| S1 | `seeker_s1.json` | chaser | `starters/starter_chaser.json` | tag | 180 | beats T1 in 8/10 series |
| T5 | `taunter_t5.json` | evader | T4 | taunt | 150 | survives 76%, beats S1 in 10/10 series |
| SF | `seeker_final.json` | chaser | S1 | tag | 200 | beats T5 in 15/16 series |
| T6 | `taunter_t6.json` (**taunter**) | evader | T5 | taunt | 120 | beats SF in 10/12 series |
| SC2 | `seeker_champion2.json` (**seeker**) | chaser | SF | tag | 300+250 | beats T6 in 17/20 series |

## How the trainer works (`taunt_ga.py`)

A batched genetic algorithm over weight vectors; the whole population plays every arena x start side by side
through the locked `TagEnv`, so no per-tick Python loops.

* **Taunter fitness** = `5 x band_time + 1 x survived + 0.15 x openness`.
  `band_time` is the mean over ticks of a trapezoid reward that is 0 at <=1.05 cells (a tag is 0.7), 1 inside
  `[1.6, 4.5]`, and fades to 0 by 8 cells. Weighting closeness *above* survival is what stops evolution from
  freezing into "run to the far corner": being tagged only ends the clock, so the only way to farm the band
  term is to stay alive **and** close. The final taunter was trained with the strict band `[1.6, 4.5]`, zero
  survival bonus and a weight of 12, which pushes it to hover.
* **Seeker fitness** = `4 + 2 x (earliness) + 1 x (final closeness)` for a tag, versus at most `~1.8` of
  progress shaping when it never tags. A tag dominates, so the chaser cannot learn to circle instead of tag.
* **Anti-overfit:** arenas are regenerated every 12-30 generations, start seeds are random per block, and the
  saved network is chosen by a **hall of fame** (best few of every generation) re-scored on held-out arenas
  and unseen starts.
* **Multi-opponent training:** the evader can be scored against several chaser snapshots at once (mixed across
  arenas), which keeps a taunter from memorising one seeker.

## Reproduce

```bash
# one-off: taunter that hovers, trained against a weak chaser
python taunt_ga.py --role evader --opponent-file starters/starter_chaser.json \
  --warm-start baselines/baseline_evader.json --generations 180 --population 96 \
  --num-arenas 6 --starts 3 --arena-block 15 --seed 71 --name "Taunter T1" --out runs/bal

# ... then alternate chaser/evader snapshots (see the table above) ...

# head-to-head
python measure.py results/seeker.json results/taunter.json --series 20 --matches 5 --plateau-hi 4.5 --far 8.0
python match.py results/seeker.json results/taunter.json --seed "event-1" --out series.json
python validate_agent.py results/seeker.json
```

## Files

| Path | What it is |
|---|---|
| `results/taunter.json`, `results/seeker.json` | the two submissions (weights only) |
| `results/pipeline/` | every intermediate agent + training log |
| `taunt_ga.py` | the co-evolution trainer (taunter & seeker fitness live here) |
| `measure.py` | head-to-head stats (series, tag rate, distance histogram) |
| everything else | unchanged upstream `tag_v2` files (`env.py`, `agent.py`, `match.py`, `viewer/`, ...) |

Trained by **Calvin Loveland**.
