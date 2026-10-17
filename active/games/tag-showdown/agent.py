"""Agent files: the network, the validator, and loading and saving.

A submission is a JSON file holding a network description and its weights (see CONTRACT.md section 8).
No code is ever run from it: the file is only read as numbers.

    python validate_agent.py my_agent.json         check a file before you compete

For your own training code:
    describe(inputs, layers)                       the network summary, to watch your size budget
    Network(n_inputs, layers).forward_pop(W, x)    run a whole population (W: P x n_params) at once
    save_agent(path, name, role, color, inputs, layers, weights)
"""
import difflib
import json
import os
import re
import sys
from dataclasses import dataclass, field

import numpy as np

from spec import CATALOG, ENV_VERSION, ROLES, SPEC

LIMITS = SPEC["network_limits"]
FILE = SPEC["agent_file"]
SCHEMA_VERSION = FILE["schema_version"]
NAME_RE, COLOR_RE = re.compile(FILE["name_pattern"]), re.compile(FILE["color_pattern"])


class AgentError(ValueError):
    """Raised when an agent file is not valid. The message lists every problem found."""


# ----------------------------------------------------------------------------- activations
def _sigmoid(x):
    return 0.5 * (1.0 + np.tanh(0.5 * x))          # same function as 1 / (1 + exp(-x)), without overflow


ACTIVATIONS = {
    "tanh": np.tanh,
    "relu": lambda x: np.maximum(x, 0.0),
    "leaky_relu": lambda x: np.where(x > 0, x, 0.01 * x),
    "sigmoid": _sigmoid,
    "linear": lambda x: x,
}
assert set(ACTIVATIONS) == set(LIMITS["activations"]), "activation list in env_spec.json and agent.py disagree"


# ---------------------------------------------------------------------------- the network
def param_count(n_inputs, layers):
    """Total parameters: the sum over layers of (n_in + 1) * units."""
    total, n_in = 0, n_inputs
    for layer in layers:
        total += (n_in + 1) * layer["units"]
        n_in = layer["units"]
    return total


class Network:
    """A fixed-shape feed-forward network. Weight layout: for each layer, the kernel W (n_in x units, row-major)
    then the bias b (units). A layer computes activation(x @ W + b)."""

    def __init__(self, n_inputs, layers):
        self.n_inputs, self.layers = n_inputs, [dict(l) for l in layers]
        self.n_params = param_count(n_inputs, layers)

    def _slices(self):
        n_in, i = self.n_inputs, 0
        for layer in self.layers:
            u = layer["units"]
            yield n_in, u, ACTIVATIONS[layer["activation"]], i, i + n_in * u, i + (n_in + 1) * u
            n_in, i = u, i + (n_in + 1) * u

    def forward_one(self, weights, x):
        """One set of weights (n_params,), a batch of inputs x (B, n_inputs) -> (B, n_outputs)."""
        for n_in, u, act, k0, k1, k2 in self._slices():
            x = act(x @ weights[k0:k1].reshape(n_in, u) + weights[k1:k2])
        return x

    def forward_pop(self, weights, x):
        """A population: weights (P, n_params), inputs x (P, n_inputs) -> (P, n_outputs)."""
        for n_in, u, act, k0, k1, k2 in self._slices():
            x = act(np.einsum("pi,pio->po", x, weights[:, k0:k1].reshape(-1, n_in, u)) + weights[:, k1:k2])
        return x


def describe(inputs, layers):
    """Plain-language size summary. inputs: a list of names (or just a count); layers: [{"units", "activation"}, ...]."""
    n_in = inputs if isinstance(inputs, int) else len(inputs)
    chain = " -> ".join([str(n_in)] + [f"{l['units']} ({l['activation']})" for l in layers])
    total = param_count(n_in, layers)
    widest = max(l["units"] for l in layers)
    text = (f"inputs {chain}\n"
            f"layers {len(layers)} of {LIMITS['max_weight_layers']} | widest {widest} of {LIMITS['max_units_per_layer']} | "
            f"parameters {total:,} of {LIMITS['max_total_parameters']:,} ({100 * total / LIMITS['max_total_parameters']:.1f}%)")
    if not isinstance(inputs, int):
        unused = [n for n in CATALOG if n not in inputs]
        text += f"\ninputs used ({len(inputs)}): {', '.join(inputs)}"
        if unused:
            text += f"\ninputs not used ({len(unused)}): {', '.join(unused)}"
    return text


# --------------------------------------------------------------------------------- the agent
class Agent:
    """A validated submission, ready to play. Build one with load_agent or check_agent_*."""

    def __init__(self, data):
        self.name, self.role, self.color = data["name"], data["role"], data["color"]
        self.inputs, self.layers = list(data["inputs"]), [dict(l) for l in data["layers"]]
        self.weights = np.asarray(data["weights"], dtype=float)
        self.columns = [CATALOG.index(n) for n in self.inputs]
        self.net = Network(len(self.inputs), self.layers)

    def act(self, obs):
        """obs: the full catalog observation (B, 21) from the environment -> raw outputs (B, 2)."""
        return self.net.forward_one(self.weights, obs[:, self.columns])

    def summary(self):
        return describe(self.inputs, self.layers)


# ---------------------------------------------------------------------------- validation
@dataclass
class Report:
    problems: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    summary: str = ""
    agent: Agent = None

    @property
    def ok(self):
        return not self.problems


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _whole(v):
    """An int, or a float that holds a whole number (16.0). Returns the int or None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def _reject_constant(name):
    raise ValueError(f"{name} is not allowed")


def check_agent_data(data, smoke=True):
    """Validate a parsed agent file. Returns a Report; report.agent is set only when everything passed."""
    rep = Report()
    P, W = rep.problems.append, rep.warnings.append
    if not isinstance(data, dict):
        P("The file must contain a JSON object ({ ... }) at the top level.")
        return rep

    missing = [k for k in FILE["required_keys"] if k not in data]
    if missing:
        P(f"Missing required key(s): {', '.join(missing)}.")
    extra = sorted(set(data) - set(FILE["required_keys"]) - set(FILE["optional_keys"]))
    if extra:
        W(f"Unknown key(s) ignored: {', '.join(extra)}.")

    if "schema_version" in data and data["schema_version"] != SCHEMA_VERSION:
        P(f"schema_version is {data['schema_version']!r}; this tournament reads version {SCHEMA_VERSION}.")
    if "env_version" in data and data["env_version"] != ENV_VERSION:
        P(f"This file was made for environment version {data['env_version']!r}, but this tournament runs {ENV_VERSION!r}. "
          f"Retrain with the current environment and set env_version to {ENV_VERSION!r}.")

    if "name" in data and not (isinstance(data["name"], str) and NAME_RE.match(data["name"])):
        P("name must be 1 to 24 characters: letters, digits, spaces, and _ . ' ! - only.")
    if "role" in data and data["role"] not in FILE["roles"]:
        P(f"role must be \"chaser\" or \"evader\" (found {data['role']!r}).")
    if "color" in data and not (isinstance(data["color"], str) and COLOR_RE.match(data["color"])):
        P("color must look like #ff8800 (a # followed by six hex digits).")
    if "notes" in data and not (isinstance(data["notes"], str) and len(data["notes"]) <= FILE["notes_max_chars"]):
        P(f"notes must be text of at most {FILE['notes_max_chars']} characters.")

    # --- inputs
    inputs = data.get("inputs")
    inputs_ok = False
    if "inputs" in data:
        if not isinstance(inputs, list) or not inputs:
            P("inputs must be a non-empty list of input names from the catalog.")
        elif not all(isinstance(n, str) for n in inputs):
            P("every entry of inputs must be a text name from the catalog.")
        else:
            unknown = [n for n in inputs if n not in CATALOG]
            for n in unknown[:5]:
                near = difflib.get_close_matches(n, CATALOG, n=1)
                P(f"Unknown input {n!r}" + (f"; did you mean {near[0]!r}?" if near else "; see the catalog in CONTRACT.md."))
            dupes = sorted({n for n in inputs if inputs.count(n) > 1})
            if dupes:
                P(f"Inputs listed more than once: {', '.join(dupes)}.")
            inputs_ok = not unknown and not dupes

    # --- layers
    layers = data.get("layers")
    layers_ok, clean_layers = False, []
    if "layers" in data:
        if not isinstance(layers, list) or not layers:
            P("layers must be a non-empty list like [{\"units\": 16, \"activation\": \"tanh\"}, {\"units\": 2, \"activation\": \"tanh\"}].")
        elif len(layers) > LIMITS["max_weight_layers"]:
            P(f"{len(layers)} layers is over the limit of {LIMITS['max_weight_layers']} (hidden layers plus the output layer).")
        else:
            layers_ok = True
            for i, l in enumerate(layers, 1):
                if not isinstance(l, dict):
                    P(f"Layer {i} must be an object with \"units\" and \"activation\".")
                    layers_ok = False
                    continue
                u, act = _whole(l.get("units")), l.get("activation")
                if u is None or u < 1:
                    P(f"Layer {i}: units must be a positive whole number.")
                    layers_ok = False
                elif u > LIMITS["max_units_per_layer"]:
                    P(f"Layer {i} has {u} units; the limit is {LIMITS['max_units_per_layer']}.")
                    layers_ok = False
                if act not in LIMITS["activations"]:
                    P(f"Layer {i}: activation {act!r} is not allowed; choose from {', '.join(LIMITS['activations'])}.")
                    layers_ok = False
                if set(l) - {"units", "activation"}:
                    W(f"Layer {i}: unknown key(s) ignored: {', '.join(sorted(set(l) - {'units', 'activation'}))}.")
                clean_layers.append({"units": u, "activation": act})
            if layers_ok and clean_layers[-1]["units"] != LIMITS["output_units"]:
                P(f"The last layer is the output layer and must have exactly {LIMITS['output_units']} units (turn and thrust); it has {clean_layers[-1]['units']}.")
                layers_ok = False

    shape_ok = inputs_ok and layers_ok
    if shape_ok:
        rep.summary = describe(inputs, clean_layers)

    # --- weights
    expected = None
    if shape_ok:
        expected = param_count(len(inputs), clean_layers)
        if expected > LIMITS["max_total_parameters"]:
            P(f"This network has {expected:,} parameters; the limit is {LIMITS['max_total_parameters']:,}.")
            shape_ok = False
    if "weights" in data:
        w = data["weights"]
        if not isinstance(w, list):
            P("weights must be a flat list of numbers.")
        elif len(w) > LIMITS["max_total_parameters"] and (expected is None or len(w) != expected):
            P(f"weights has {len(w):,} numbers, over the parameter limit of {LIMITS['max_total_parameters']:,}.")
        elif expected is not None and len(w) != expected:
            P(f"weights has {len(w):,} numbers but this network needs exactly {expected:,} "
              f"(the sum over layers of (inputs + 1) * units). Check the layer sizes and the inputs list.")
        elif not all(_is_number(v) for v in w):
            bad = next(i for i, v in enumerate(w) if not _is_number(v))
            P(f"weights must all be numbers; entry {bad} is {w[bad]!r}.")
        else:
            try:
                arr = np.asarray(w, dtype=float)
            except (OverflowError, ValueError):
                P("weights contains a number too large to use.")
                arr = None
            if arr is not None:
                if not np.isfinite(arr).all():
                    P(f"weights must be finite numbers; entry {int(np.argmax(~np.isfinite(arr)))} is not.")
                elif np.abs(arr).max() > LIMITS["max_abs_weight"]:
                    P(f"Largest allowed weight size is {LIMITS['max_abs_weight']:g}; entry {int(np.argmax(np.abs(arr)))} is {arr[int(np.argmax(np.abs(arr)))]:g}.")

    if rep.problems:
        return rep

    agent = Agent(data)
    if smoke:
        problem = _smoke_match(agent)
        if problem:
            P(problem)
            return rep
    rep.agent = agent
    return rep


def _smoke_match(agent, ticks=30):
    """Play a few ticks against the matching practice opponent, so a file that would crash the tournament fails here."""
    try:
        from env import TagEnv
        from generate import generate_arena
        from opponents import OPPONENTS
        env = TagEnv(generate_arena(0), batch=1)
        env.reset(0)
        mine, other = (0, "omniscient_evader") if agent.role == "chaser" else (1, "omniscient_chaser")
        for _ in range(ticks):
            out = agent.act(env.observe(agent.role))
            if out.shape != (1, 2) or not np.isfinite(out).all():
                return "The network produced outputs that are not finite numbers during a test match."
            bot = OPPONENTS[other](env)
            env.step(out if mine == 0 else bot, bot if mine == 0 else out)
            if env.all_done:
                break
    except Exception as ex:                                       # any failure here is a problem with the file
        return f"The network could not be run in a test match: {type(ex).__name__}: {ex}"
    return None


def check_agent_bytes(raw, smoke=True):
    """Validate the raw bytes of an uploaded or saved file. Returns a Report."""
    rep = Report()
    if len(raw) > FILE["max_file_bytes"]:
        rep.problems.append(f"The file is {len(raw) / 1e6:.1f} MB; the limit is {FILE['max_file_bytes'] / 1e6:.0f} MB.")
        return rep
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        rep.problems.append("The file is not text (it could not be read as UTF-8). Save it as a plain .json file.")
        return rep
    try:
        data = json.loads(text, parse_constant=_reject_constant)
    except json.JSONDecodeError as ex:
        rep.problems.append(f"The file is not valid JSON: {ex.msg} (line {ex.lineno}, column {ex.colno}).")
        return rep
    except ValueError as ex:
        rep.problems.append(f"The file contains {ex}. Weights must be ordinary finite numbers.")
        return rep
    except RecursionError:
        rep.problems.append("The file is nested too deeply to be an agent file.")
        return rep
    return check_agent_data(data, smoke)


def check_agent_file(path, smoke=True):
    try:
        with open(path, "rb") as f:
            raw = f.read(FILE["max_file_bytes"] + 1)
    except OSError as ex:
        return Report(problems=[f"Could not open the file: {ex.strerror or ex}."])
    return check_agent_bytes(raw, smoke)


def load_agent(path):
    """Load and validate an agent file, or raise AgentError listing every problem."""
    rep = check_agent_file(path)
    if not rep.ok:
        raise AgentError(f"{os.path.basename(path)} is not a valid agent file:\n  - " + "\n  - ".join(rep.problems))
    return rep.agent


def make_agent_dict(name, role, color, inputs, layers, weights, notes=None):
    d = {"schema_version": SCHEMA_VERSION, "env_version": ENV_VERSION, "name": name, "role": role, "color": color,
         "inputs": list(inputs), "layers": [{"units": int(l["units"]), "activation": l["activation"]} for l in layers],
         "weights": [float(w) for w in np.asarray(weights, dtype=float).ravel()]}
    if notes:
        d["notes"] = notes
    return d


def save_agent(path, name, role, color, inputs, layers, weights, notes=None):
    """Write an agent file for submission. Validates first, so a file that is saved is a file that will load."""
    d = make_agent_dict(name, role, color, inputs, layers, weights, notes)
    rep = check_agent_data(d)
    if not rep.ok:
        raise AgentError("Not saving; the agent is not valid:\n  - " + "\n  - ".join(rep.problems))
    with open(path, "w") as f:
        json.dump(d, f)
    return path


if __name__ == "__main__":
    sys.exit(__doc__)
