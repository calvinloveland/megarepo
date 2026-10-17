"""Play two agent files against each other: one chaser file, one evader file.

    python match.py chaser.json evader.json --seed "event secret"            best of five, prints the results
    python match.py chaser.json evader.json --seed 7 --out series.json      also save every replay for the viewer

All five matches are always played (so the viewer can show every arena); the series goes to whoever wins 3 or more.
The same seed always gives the same five arenas, start positions, and results.
"""
import argparse
import json
import sys

from agent import AgentError, load_agent
from env import TagEnv
from generate import tournament_arenas
from replay import build_replay
from spec import DT, SPEC

WINS_NEEDED = SPEC["tournament"]["wins_needed"]


def _check_roles(chaser, evader):
    for agent, role in ((chaser, "chaser"), (evader, "evader")):
        if agent.role != role:
            raise AgentError(f"'{agent.name}' was trained as the {agent.role} but was entered as the {role}.")


def play_match(arena, chaser, evader, seed):
    """One match on one arena. chaser and evader are loaded Agents. Returns the result with its replay."""
    _check_roles(chaser, evader)
    env = TagEnv(arena, batch=1, record=True)
    env.reset(seed)
    while not env.all_done:
        env.step(chaser.act(env.observe("chaser")), evader.act(env.observe("evader")))
    replay = build_replay(env, 0, names=(chaser.name, evader.name), colors=(chaser.color, evader.color))
    return {"arena": arena.name, "seed": int(seed), "winner": replay["winner"], "ticks": int(env.tick[0]),
            "tag_tick": replay["tag_tick"], "replay": replay}


def play_series(chaser, evader, secret_seed):
    """Best of five on five arenas made from the secret seed (an int or any text)."""
    _check_roles(chaser, evader)
    matches = [play_match(arena, chaser, evader, seed) for arena, seed in tournament_arenas(secret_seed)]
    chaser_wins = sum(m["winner"] == "chaser" for m in matches)
    series_winner = "chaser" if chaser_wins >= WINS_NEEDED else "evader"
    return {"chaser": chaser.name, "evader": evader.name, "chaser_wins": chaser_wins,
            "evader_wins": len(matches) - chaser_wins, "series_winner": series_winner,
            "winner_name": chaser.name if series_winner == "chaser" else evader.name, "matches": matches}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chaser")
    ap.add_argument("evader")
    ap.add_argument("--seed", default="practice", help="int or any text; same seed, same series")
    ap.add_argument("--out", help="save the whole series (with replays) to this JSON file")
    a = ap.parse_args()
    try:
        chaser, evader = load_agent(a.chaser), load_agent(a.evader)
        seed = int(a.seed) if a.seed.lstrip("-").isdigit() else a.seed
        result = play_series(chaser, evader, seed)
    except AgentError as ex:
        sys.exit(str(ex))
    print(f"\n{chaser.name} (chaser)  vs  {evader.name} (evader)\n")
    for i, m in enumerate(result["matches"], 1):
        how = f"tagged at {m['tag_tick'] * DT:.1f}s" if m["tag_tick"] is not None else "escaped"
        print(f"  match {i}  {m['arena']:<8} {how:<16} winner: {chaser.name if m['winner'] == 'chaser' else evader.name}")
    print(f"\nChaser {result['chaser_wins']} - {result['evader_wins']} Evader   ->   {result['winner_name']} wins the series")
    if a.out:
        with open(a.out, "w") as f:
            json.dump(result, f)
        print(f"Saved to {a.out}")


if __name__ == "__main__":
    main()
