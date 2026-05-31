#!/usr/bin/env nix-shell
#!nix-shell -i python3 -p python3
"""Powder Play automated playtest — simulates mixing materials via the API."""

import subprocess
import json
import sys
import os
import urllib.request
import urllib.error
import random
from typing import Dict, List, Optional, Tuple

MIX_API = os.environ.get("MIX_API", "http://localhost:8787")
MAX_DISCOVERIES = 15

# ── Starter materials and their tags ──────────────────────────────
STARTERS = ["Fire", "Sand", "Water", "Dirt", "Seed", "Iron", "Salt"]
STARTER_TAGS = {
    "Fire": ["float", "fire", "burns_out"],
    "Sand": ["sand"],
    "Water": ["flow", "water"],
    "Dirt": ["sand", "dirt"],
    "Seed": ["sand", "seed"],
    "Iron": ["element", "static"],
    "Salt": ["sand"],
}

# ── LLM call via mix server ──────────────────────────────────────
def llm_call(prompt: str, system: str, max_tokens: int = 16) -> str:
    """Send prompt to LLM via mix server, return response text."""
    body = json.dumps({
        "prompt": prompt,
        "system": system,
        "options": {"temperature": 0.2, "num_predict": max_tokens}
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{MIX_API}/llm",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("response", "").strip()
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
        print(f"    [API error: {e}]")
        return ""


# ── Mix helpers ──────────────────────────────────────────────────
def llm_name(a: str, b: str, recent_lines: List[str]) -> str:
    """Get a name for mixing A+B from the LLM."""
    recent = "\n".join(recent_lines[-6:])  # last 6 as context
    if recent:
        prompt = f"{recent}\n{a}+{b}="
    else:
        prompt = f"{a}+{b}="
    
    raw = llm_call(prompt, "Respond with a single word name for the new material. Return only the name, no extra text.", 16)
    name = raw.strip().rstrip(".,!?")
    
    # Validate
    if not name:
        return ""
    a_lower, b_lower, n_lower = a.lower(), b.lower(), name.lower()
    if n_lower in (a_lower, b_lower):
        return ""
    # Check it's a single word
    if " " in name or len(name) < 2:
        return ""
    return name


def llm_density(name: str) -> Optional[float]:
    """Get density for a material."""
    examples = "SaltWater density: 1.0\nMud density: 1.4\nSteam density: 0.2\nGlass density: 2.5"
    raw = llm_call(f"{examples}\n\n{name} density:", "Respond with a number only.", 8)
    try:
        val = float(raw.strip().split()[0])
        if 0 < val <= 10:
            return val
    except (ValueError, IndexError):
        pass
    return None


def llm_color(name: str) -> Optional[List[int]]:
    """Get RGB color for a material."""
    examples = "SaltWater color: 180, 200, 240\nMud color: 120, 100, 80\nSteam color: 200, 200, 220\nGlass color: 190, 200, 210"
    raw = llm_call(f"{examples}\n\n{name} color:", "Respond with three numbers 0-255 separated by commas.", 10)
    try:
        parts = [int(p.strip()) for p in raw.strip().split(",")[:3]]
        if all(0 <= p <= 255 for p in parts):
            return parts
    except (ValueError, IndexError):
        pass
    return None


def determine_byproduct(a: str, b: str) -> Optional[str]:
    """Determine if a mix produces Heat or Pressure as byproduct."""
    a_tags = STARTER_TAGS.get(a, ["static"])
    b_tags = STARTER_TAGS.get(b, ["static"])
    all_tags = a_tags + b_tags
    if any(t in all_tags for t in ("fire", "explosive", "reactive_water")):
        return "Heat"
    if "water" in all_tags and any(t in all_tags for t in ("flow", "float")):
        return "Pressure" if random.random() < 0.3 else None
    return None


# ── Mix runner ───────────────────────────────────────────────────
class MixGame:
    def __init__(self):
        self.discovered: Dict[Tuple[str, str], str] = {}
        self.discovered_names: List[str] = []
        self.mix_count = 0
        
    def pair_exists(self, a: str, b: str) -> bool:
        for (x, y) in self.discovered:
            if (x == a and y == b) or (x == b and y == a):
                return True
        return False
    
    def recent_lines(self) -> List[str]:
        lines = []
        for (a, b), name in self.discovered.items():
            lines.append(f"{a}+{b}={name}")
        return lines
    
    def do_mix(self, a: str, b: str):
        if a == b or self.pair_exists(a, b):
            return
        if self.mix_count >= MAX_DISCOVERIES:
            return
        
        print(f"\n  ── {a} + {b} ──")
        
        name = llm_name(a, b, self.recent_lines())
        if not name:
            name = f"{a}_{b}_mix"
            print(f"    LLM: (fallback) → {name}")
        else:
            print(f"    LLM: {name}")
        
        density = llm_density(name)
        density_str = f"{density:.1f}" if density else "(avg)"
        
        color = llm_color(name)
        color_str = f"[{','.join(map(str,color))}]" if color else "(hash)"
        
        byproduct = determine_byproduct(a, b)
        bp_str = f" + {byproduct}" if byproduct else ""
        
        self.discovered[(a, b)] = name
        self.discovered_names.append(name)
        self.mix_count += 1
        
        print(f"    → {name}{bp_str}")
        print(f"      density: {density_str}  color: {color_str}")


# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    game = MixGame()
    
    print("╔════════════════════════════════════════════════════╗")
    print("║         POWDER PLAY — AUTOMATED PLAYTEST          ║")
    print("╚════════════════════════════════════════════════════╝")
    print(f"Starters: {', '.join(STARTERS)}")
    
    # Phase 1: First-order (starter pairs)
    print("\n═══ PHASE 1: Starter pairs ═══")
    for i, a in enumerate(STARTERS):
        for b in STARTERS[i+1:]:
            game.do_mix(a, b)
    
    # Phase 2: Discovery + starter chain mixes
    print("\n═══ PHASE 2: Discovery + starter ═══")
    for name in game.discovered_names[:]:
        for starter in STARTERS:
            game.do_mix(name, starter)
    
    # Phase 3: Discovery + discovery
    print("\n═══ PHASE 3: Discovery + discovery ═══")
    for i, a in enumerate(game.discovered_names[:]):
        for b in game.discovered_names[i+1:]:
            game.do_mix(a, b)
    
    # Results
    print("\n" + "═" * 56)
    print("                     PLAYTEST RESULTS")
    print("═" * 56)
    print(f"Starters: {', '.join(STARTERS)}")
    print(f"Discoveries: {game.mix_count}")
    print()
    
    for (a, b), name in game.discovered.items():
        bp = determine_byproduct(a, b)
        bp_disp = f" [+{bp}]" if bp else ""
        print(f"  ● {name:20s} from {a} + {b}{bp_disp}")
    
    print()
    names_lower = [n.lower() for n in game.discovered_names]
    if "gold" in names_lower:
        print("🎉 GOLD DISCOVERED! You win!")
    else:
        print("💡 Gold not yet discovered. Keep mixing!")
