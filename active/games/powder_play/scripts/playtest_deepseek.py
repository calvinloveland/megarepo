#!/usr/bin/env python3
"""Full discovery playtest — standard + catalyzed mixes with DeepSeek."""

import json
import os
import urllib.request

MIX_API = "http://localhost:8787"
MAX_MIXES = 80

STARTERS = ["Fire", "Sand", "Water", "Dirt", "Seed", "Iron", "Salt"]

def llm(prompt, system, tokens=30):
    body = json.dumps(
        {"prompt": prompt, "system": system, "options": {"temperature": 0.2, "num_predict": tokens}}
    ).encode()
    req = urllib.request.Request(
        f"{MIX_API}/llm", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()
            parts = raw.replace("=", " ").replace(":", " ").split()
            for p in reversed(parts):
                p = p.strip(".,!?*_\"' ")
                if p and p[0].isupper() and len(p) > 1 and not p.startswith("The"):
                    return p
            if parts:
                return parts[-1].strip(".,!?*_\"' ")
            return ""
    except Exception as e:
        return ""


class MixGame:
    def __init__(self):
        self.mixes = {}       # (a,b) -> name  (also (a,b,c) for catalyzed)
        self.ancestors = {s: {s} for s in STARTERS}
        self.materials = list(STARTERS)
        self.count = 0

    def shares_ancestor(self, a, b):
        return bool(self.ancestors.get(a, {a}) & self.ancestors.get(b, {b}))

    def already_mixed(self, *args):
        """Check if any permutation of this pair/triple has been mixed."""
        for key in self.mixes:
            if sorted(key) == sorted(args):
                return True
        return False

    def try_mix(self, a, b, catalyst=None):
        args = [a, b]
        if catalyst:
            args.append(catalyst)
        if self.already_mixed(*args):
            return False
        if self.count >= MAX_MIXES:
            return False

        # Ancestor check applies to the two materials (not the catalyst)
        if self.shares_ancestor(a, b):
            return False

        if catalyst:
            prompt = f"{a}+{b}+{catalyst}="
            system = f"What common material is produced by combining {a}, {b}, and {catalyst} together? Respond with a single word."
        else:
            prompt = f"{a}+{b}="
            system = f"What is the common name for the material created by mixing {a} and {b}? Respond with a single word."

        name = llm(prompt, system)
        if not name or name.lower() in (a.lower(), b.lower()):
            name = f"{a}_{b}_mix"
            if catalyst:
                name += f"_{catalyst.lower()}"

        combined = self.ancestors.get(a, {a}) | self.ancestors.get(b, {b}) | {name}
        self.ancestors[name] = combined
        self.mixes[tuple(args)] = name
        self.materials.append(name)
        self.count += 1

        bp = ""
        if a == "Fire" or b == "Fire":
            bp = " [+Heat]"
        cat_str = f" + {catalyst}" if catalyst else ""
        print(f"  {self.count:2d}. {name:25s} = {a} + {b}{cat_str}{bp}")
        return True


game = MixGame()
print("═" * 56)
print("   DEEPSEEK — CATALYZED DISCOVERY PLAYTEST")
print("═" * 56)
print(f"Starters: {STARTERS}")
print(f"Cap: {MAX_MIXES} max discoveries (standard + catalyzed)")
print()

# Phase 1: Standard starter pairs
for i, a in enumerate(STARTERS):
    for b in STARTERS[i + 1 :]:
        game.try_mix(a, b)

# Phase 2: Catalyzed mixes (A + B + Heat/Pressure)
print()
print("--- Catalyzed mixes ---")
starter_pairs_mixed = list(game.mixes.keys())
for a, b in starter_pairs_mixed:
    if len(a) == 2 and isinstance(a, tuple) and not isinstance(a[0], str):
        continue
    # Skip pairs where the second element is not a string (catalyzed already)
    if isinstance(a, str) and isinstance(b, str):
        for catalyst in ["Heat", "Pressure"]:
            if game.count >= MAX_MIXES:
                break
            game.try_mix(a, b, catalyst)
    if game.count >= MAX_MIXES:
        break

# Phase 3: Compound + starter chain mixes
print()
print("--- Chain: compound + starter ---")
for name in [v for v in game.materials if v not in STARTERS]:
    for s in STARTERS:
        game.try_mix(name, s)
        if game.count >= MAX_MIXES:
            break
    if game.count >= MAX_MIXES:
        break

# Phase 4: Compound + compound
print()
print("--- Chain: compound + compound ---")
compounds = [m for m in game.materials if m not in STARTERS]
for i, a in enumerate(compounds):
    for b in compounds[i + 1 :]:
        game.try_mix(a, b)
        if game.count >= MAX_MIXES:
            break
    if game.count >= MAX_MIXES:
        break

print()
print("═" * 56)
print(f"  Total: {game.count} discoveries")
unique_names = set(game.mixes.values())
print(f"  Unique names: {len(unique_names)}")
repeats = [n for n in unique_names if list(game.mixes.values()).count(n) > 1]
if repeats:
    print(f"  Repeated: {sorted(repeats)}")

# Count catalyzed
catalyzed = sum(1 for k in game.mixes if len(k) >= 3)
print(f"  Catalyzed (Heat/Pressure): {catalyzed}")
print()

if "Gold" in game.materials:
    print("  🎉 GOLD DISCOVERED!")
else:
    print("  💡 No Gold yet.")
