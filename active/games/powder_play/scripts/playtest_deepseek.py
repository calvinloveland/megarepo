#!/usr/bin/env python3
"""Full discovery playtest with DeepSeek via OpenRouter."""

import json
import os
import urllib.request

MIX_API = "http://localhost:8787"
MAX_MIXES = 80

STARTERS = ["Fire", "Sand", "Water", "Dirt", "Seed", "Iron", "Salt"]


def llm(prompt, system, tokens=30):
    body = json.dumps(
        {
            "prompt": prompt,
            "system": system,
            "options": {"temperature": 0.2, "num_predict": tokens},
        }
    ).encode()
    req = urllib.request.Request(
        f"{MIX_API}/llm",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()
            # Extract last capitalized word
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
        self.mixes = {}  # (a,b) -> name
        self.ancestors = {s: {s} for s in STARTERS}
        self.materials = list(STARTERS)
        self.count = 0

    def shares_ancestor(self, a, b):
        return bool(self.ancestors.get(a, {a}) & self.ancestors.get(b, {b}))

    def try_mix(self, a, b):
        if a == b:
            return False
        if (a, b) in self.mixes or (b, a) in self.mixes:
            return False
        if self.count >= MAX_MIXES:
            return False
        if self.shares_ancestor(a, b):
            return False

        name = llm(
            f"{a}+{b}=",
            f"What is the common name for the material created by mixing {a} and {b}? Respond with a single word.",
        )
        if not name or name.lower() in (a.lower(), b.lower()):
            name = f"{a}_{b}_mix"

        combined = self.ancestors.get(a, {a}) | self.ancestors.get(b, {b}) | {name}
        self.ancestors[name] = combined
        self.mixes[(a, b)] = name
        self.materials.append(name)
        self.count += 1

        bp = ""
        if a == "Fire" or b == "Fire":
            bp = " [+Heat]"
        print(f"  {self.count:2d}. {name:20s} = {a} + {b}{bp}")
        return True


game = MixGame()
print("═══════════════════════════════════════════")
print("   DEEPSEEK — FULL DISCOVERY RUN")
print("═══════════════════════════════════════════")
print(f"Starters: {STARTERS}")
print(f"Cap: {MAX_MIXES} max discoveries")
print()

# Phase 1: Starter pairs
for i, a in enumerate(STARTERS):
    for b in STARTERS[i + 1 :]:
        game.try_mix(a, b)

# Phase 2: Compound + non-parent starters
print()
print("--- Phase 2: compound + starter ---")
for name in [v for v in game.materials if v not in STARTERS]:
    for s in STARTERS:
        game.try_mix(name, s)
        if game.count >= MAX_MIXES:
            break
    if game.count >= MAX_MIXES:
        break

# Phase 3: Compound + compound
print()
print("--- Phase 3: compound + compound ---")
compounds = [m for m in game.materials if m not in STARTERS]
for i, a in enumerate(compounds):
    for b in compounds[i + 1 :]:
        game.try_mix(a, b)
        if game.count >= MAX_MIXES:
            break
    if game.count >= MAX_MIXES:
        break

print()
print("═══════════════════════════════════════════")
print(f"Total: {game.count} discoveries")
unique_names = set(game.mixes.values())
print(f"Unique names: {len(unique_names)}")
repeats = [n for n in unique_names if list(game.mixes.values()).count(n) > 1]
if repeats:
    print(f"Repeated names: {sorted(repeats)}")
print()

# Check for Gold
if "Gold" in game.materials:
    print("🎉 GOLD DISCOVERED!")
else:
    print("💡 No Gold yet.")
