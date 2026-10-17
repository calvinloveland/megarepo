"""Turns a recorded match into the replay format the viewer reads (CONTRACT.md section 9)."""
import numpy as np

from spec import DT, ENV_VERSION, ROLES, TAG_RADIUS


def build_replay(env, index=0, names=("chaser", "evader"), colors=("#e63946", "#1d9bf0")):
    """Replay of match `index` from an env created with record=True."""
    if not env.record:
        raise ValueError("create the environment with record=True to build replays")
    n = int(env.tick[index]) + 1                                    # initial frame + one per tick played
    pos = np.array(env.hist_pos)[:n, index]                         # (n, 2 agents, 2)
    head = np.array(env.hist_head)[:n, index]                       # (n, 2 agents)
    winner = {0: None, 1: "chaser", 2: "evader"}[int(env.winner[index])]
    tag = int(env.tag_tick[index])
    return {
        "replay_version": 2, "env_version": ENV_VERSION,
        "arena": {"name": env.arena.name, "rows": env.arena.rows},
        "dt": DT, "tag_radius": TAG_RADIUS, "frames": n,
        "tag_tick": tag if tag >= 0 else None, "winner": winner,
        "agents": [{"name": names[i], "role": ROLES[i], "color": colors[i],
                    "x": np.round(pos[:, i, 0], 3).tolist(), "y": np.round(pos[:, i, 1], 3).tolist(),
                    "heading": np.round(head[:, i], 3).tolist()} for i in range(2)],
    }
