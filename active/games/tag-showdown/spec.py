"""Loads env_spec.json, the single source of truth for every constant. Nothing is hard-coded elsewhere."""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "env_spec.json")) as _f:
    SPEC = json.load(_f)

ENV_VERSION = SPEC["env_version"]
DT = SPEC["time"]["dt"]
MAX_TICKS = SPEC["time"]["max_ticks"]
RADIUS = SPEC["agent"]["collision_radius"]
TAG_RADIUS = SPEC["tag"]["radius"]
MUD_MULT = SPEC["terrain"]["mud_speed_multiplier"]
MIN_SEP = SPEC["spawn"]["min_separation"]

# Agent index 0 is always the chaser, 1 the evader.
ROLES = ("chaser", "evader")
MAX_SPEED = np.array([SPEC["roles"][r]["max_speed"] for r in ROLES])
TURN_RATE = np.array([SPEC["roles"][r]["turn_rate"] for r in ROLES])

OBS = SPEC["observation"]
CATALOG = [c["name"] for c in OBS["catalog"]]
BLOCK_OFFSETS = [tuple(o) for o in OBS["block_offsets"]]
BLOCK_VALUES = OBS["block_values"]
COORD_SCALE = OBS["coord_scale"]
MOVE_SCALE = OBS["move_scale"]

PAD = 4   # arrays are padded with wall by this many cells so neighbourhood lookups never leave the array
