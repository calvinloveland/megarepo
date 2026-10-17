"""Measure how a chaser/evader pair actually behaves over many matches.

    python measure.py chaser.json evader.json --series 12 --matches 8 [--plateau-hi 5 --far 9]

Prints, per series seed, who won the best-of-five; then pooled per-match stats: evader survival rate,
mean distance, share of ticks spent in the taunt band, and a distance histogram.

A good taunter survives often AND keeps a small mean distance / high band fraction.
"""
import argparse
import numpy as np

from agent import load_agent
from env import TagEnv
from generate import generate_arena, seed_from_text
from taunt_ga import taunt_reward


def run_matches(chaser, evader, arena, seed, plateau_hi, far, keep_ticks=True):
    env = TagEnv(arena, batch=1)
    env.reset(seed)
    dist, taunt, ticks, hist = 0.0, 0.0, 0, []
    while not env.all_done and ticks < 400:
        env.step(chaser.act(env.observe("chaser")), evader.act(env.observe("evader")))
        d = float(env.distance()[0])
        dist += d
        taunt += float(taunt_reward(d, plateau_hi, far))
        if keep_ticks:
            hist.append(d)
        ticks += 1
    return {"tagged": bool(env.tag_tick[0] >= 0), "tag_tick": int(env.tag_tick[0]),
            "mean_dist": dist / max(ticks, 1), "taunt_frac": taunt / max(ticks, 1), "ticks": ticks, "hist": hist}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chaser")
    ap.add_argument("evader")
    ap.add_argument("--series", type=int, default=10, help="number of best-of-five series (distinct secret seeds)")
    ap.add_argument("--matches", type=int, default=5, help="matches per series")
    ap.add_argument("--plateau-hi", type=float, default=4.5)
    ap.add_argument("--far", type=float, default=8.0)
    a = ap.parse_args()
    chaser, evader = load_agent(a.chaser), load_agent(a.evader)
    print(f"\n{chaser.name} (chaser) vs {evader.name} (evader)   band [{1.6:g}, {a.plateau_hi:g}], 0 at {a.far:g}\n")
    series_wins = 0
    pooled = []
    for s in range(a.series):
        seed = seed_from_text(f"measure-{s}")
        rng = np.random.default_rng(seed)
        cw = ew = 0
        for m in range(a.matches):
            arena = generate_arena(int(rng.integers(1 << 31)), name=f"s{s}m{m}")
            res = run_matches(chaser, evader, arena, int(rng.integers(1 << 31)), a.plateau_hi, a.far)
            pooled.append(res)
            if res["tagged"]:
                cw += 1
            else:
                ew += 1
        series_wins += cw >= 3
        print(f"  series {s:2d}  chaser {cw} - {ew} evader   {'chaser' if cw >= 3 else 'evader'} wins")
    p = pooled
    tags = [x for x in p if x["tagged"]]
    surv = [x for x in p if not x["tagged"]]
    md = np.mean([x["mean_dist"] for x in p])
    tf = np.mean([x["taunt_frac"] for x in p])
    print(f"\nseries won by chaser: {series_wins}/{a.series}")
    print(f"matches: {len(p)} | chaser tags {len(tags)} ({100*len(tags)/len(p):.0f}%) | "
          f"evader survives {len(surv)} ({100*len(surv)/len(p):.0f}%)")
    print(f"mean distance {md:.2f} | mean taunt-band fraction {tf:.2f}")
    if tags:
        print(f"mean tag time {np.mean([x['tag_tick'] for x in tags]) * 0.1:.1f}s")
    if surv:
        print(f"survivor mean distance {np.mean([x['mean_dist'] for x in surv]):.2f} | "
              f"survivor taunt fraction {np.mean([x['taunt_frac'] for x in surv]):.2f}")
    # distance histogram, weighting every match equally
    all_d = []
    for x in p:
        if x["hist"]:
            idx = np.linspace(0, len(x["hist"]) - 1, min(200, len(x["hist"]))).astype(int)
            all_d.extend(np.array(x["hist"])[idx])
    all_d = np.array(all_d)
    edges = [0, 1.6, a.plateau_hi, a.far, 12, 20, 1e9]
    print("\ndistance histogram (% of ticks):")
    for lo, hi in zip(edges[:-1], edges[1:]):
        print(f"  {lo:5.1f}-{hi:5.1f}: {100 * np.mean((all_d >= lo) & (all_d < hi)):5.1f}%")
    print(f"  median {np.median(all_d):.2f} | mean {all_d.mean():.2f}")


if __name__ == "__main__":
    main()
