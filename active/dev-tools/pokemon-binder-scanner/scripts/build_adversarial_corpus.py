#!/usr/bin/env python3
"""
Build a genuinely hard adversarial test corpus for anti-overfitting validation.

Generates test cases at three difficulty levels using confusable card pairs
(same Pokémon name, different printings) with photographic degradation.

New in v2: every individual degradation is also tested solo, so the test
suite can report per-effect accuracy and isolate which effects/combinations
cause the most confusion.

Usage:
  python scripts/build_adversarial_corpus.py
"""
from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pokemon_binder_scanner.binder_fixtures import _apply_card_transform

CORPUS = Path("/data/home/calvin/pokemon-binder-scanner/cards_manifest.json")
REF_DIR = CORPUS.parent / "reference_cards"
OUTPUT = Path("/data/home/calvin/pokemon-binder-scanner/adversarial_corpus.json")


def load_confusable_pairs(min_printings: int = 4) -> list[list[dict[str, Any]]]:
    """Find cards with the same name but different IDs (highly confusable)."""
    corpus = json.loads(CORPUS.read_text())
    by_name = defaultdict(list)
    for c in corpus["cards"]:
        name = c.get("name", "").lower()
        if name:
            by_name[name].append(c)
    return [entries for entries in by_name.values() if len(entries) >= min_printings]


def _jpeg_compress(img: Image.Image, quality: int) -> Image.Image:
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _apply_degradation(
    img: Image.Image, visibility: str, tilt: float, effects: list[str]
) -> Image.Image:
    rng = random.Random(f"{visibility}-{tilt}-{effects}")
    slot = {"visibility": visibility, "tilt_degrees": tilt, "render_effects": effects}
    transformed = _apply_card_transform(img.convert("RGBA"), slot, rng)
    result = transformed.convert("RGB")
    return result


# ---------------------------------------------------------------------------
# Degradation definitions
# ---------------------------------------------------------------------------

DEGRADATIONS: dict[str, Any] = {
    "jpeg5":           lambda img: _jpeg_compress(img, 5),
    "jpeg8":           lambda img: _jpeg_compress(img, 8),
    "jpeg10":          lambda img: _jpeg_compress(img, 10),
    "jpeg15":          lambda img: _jpeg_compress(img, 15),
    "jpeg20":          lambda img: _jpeg_compress(img, 20),
    "heavy_glare":     lambda img: _apply_degradation(img, "glare", 7, ["heavy_glare"]),
    "glare_band":      lambda img: _apply_degradation(img, "glare", 4, ["heavy_glare", "center_band"]),
    "motion_blur":     lambda img: _apply_degradation(img, "clear", 0, ["motion_blur"]),
    "low_light_desat": lambda img: _apply_degradation(img, "clear", 0, ["low_light", "desaturate"]),
    "blue_cast_soft":  lambda img: _apply_degradation(img, "soft_focus", 0, ["blue_cast"]),
    "tilted_occluded": lambda img: _apply_degradation(img, "tilted", 8, ["corner_occlusion"]),
    "sleeve_glare":    lambda img: _apply_degradation(img, "sleeve_glare", 6, []),
}

# Human-readable descriptions for each degradation (used in test reports).
DEGRADATION_LABELS: dict[str, str] = {
    "jpeg5":           "JPEG quality 5",
    "jpeg8":           "JPEG quality 8",
    "jpeg10":          "JPEG quality 10",
    "jpeg15":          "JPEG quality 15",
    "jpeg20":          "JPEG quality 20",
    "heavy_glare":     "Heavy glare",
    "glare_band":      "Glare + center band",
    "motion_blur":     "Motion blur",
    "low_light_desat": "Low light + desaturation",
    "blue_cast_soft":  "Blue cast + soft focus",
    "tilted_occluded": "Tilt 8° + corner occlusion",
    "sleeve_glare":    "Sleeve glare",
}

# ---------------------------------------------------------------------------
# Test case groupings
# ---------------------------------------------------------------------------

# Every individual degradation applied in isolation — one case per card pair.
ALL_SINGLE_DEGRADATIONS = [
    ["jpeg5"],
    ["jpeg8"],
    ["jpeg10"],
    ["jpeg15"],
    ["jpeg20"],
    ["heavy_glare"],
    ["glare_band"],
    ["motion_blur"],
    ["low_light_desat"],
    ["blue_cast_soft"],
    ["tilted_occluded"],
    ["sleeve_glare"],
]

# Classic difficulty levels (kept for backward compatibility).
LEVELS = {
    "moderate": [
        ["jpeg20"],
        ["heavy_glare"],
        ["low_light_desat"],
        ["motion_blur"],
        ["tilted_occluded"],
        ["blue_cast_soft"],
        ["sleeve_glare"],
    ],
    "hard": [
        ["jpeg10", "heavy_glare"],
        ["jpeg10", "low_light_desat"],
        ["jpeg20", "motion_blur", "blue_cast_soft"],
        ["heavy_glare", "blue_cast_soft"],
        ["sleeve_glare", "low_light_desat"],
        ["jpeg15", "tilted_occluded"],
        ["jpeg20", "glare_band"],
    ],
    "extreme": [
        ["jpeg5", "heavy_glare", "low_light_desat"],
        ["jpeg5", "motion_blur", "blue_cast_soft"],
        ["jpeg10", "glare_band", "low_light_desat"],
        ["jpeg10", "heavy_glare", "blue_cast_soft", "motion_blur"],
        ["jpeg5", "tilted_occluded", "low_light_desat"],
        ["jpeg5", "heavy_glare", "low_light_desat", "blue_cast_soft"],
        ["jpeg8", "sleeve_glare", "motion_blur", "low_light_desat"],
    ],
}

# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------

def _make_degradation_key(deg_list: list[str]) -> str:
    """Stable sort-join so 'jpeg5+glare' and 'glare+jpeg5' map to the same key."""
    return "+".join(sorted(deg_list))


def generate_test_cases(num_pairs: int = 50, seed: int = 42) -> dict[str, Any]:
    """Generate adversarial test cases for every degradation (single + stacked)."""
    confusable = load_confusable_pairs(min_printings=4)
    rng = random.Random(seed)
    rng.shuffle(confusable)

    # cases_by_level:  "moderate" / "hard" / "extreme" -> list of test cases
    # cases_by_degradation: composite key -> list of test cases
    cases_by_level: dict[str, list[dict[str, Any]]] = {}
    cases_by_degradation: dict[str, list[dict[str, Any]]] = {}

    # Also maintain a "single" pseudo-level with every individual degradation.
    cases_by_level["single"] = []

    pairs_used = 0

    for group in confusable:
        if pairs_used >= num_pairs:
            break
        if len(group) < 2:
            continue
        rng.shuffle(group)
        anchor = group[0]
        distractor = group[1]

        anchor_path = REF_DIR / f"{anchor['canonical_card_id']}.png"
        dist_path = REF_DIR / f"{distractor['canonical_card_id']}.png"
        if not anchor_path.exists() or not dist_path.exists():
            continue

        pairs_used += 1

        # ------ individual degradations (one case per) ------
        for deg_list in ALL_SINGLE_DEGRADATIONS:
            case = {
                "anchor_id": anchor["canonical_card_id"],
                "anchor_name": anchor.get("name", "?"),
                "distractor_id": distractor["canonical_card_id"],
                "distractor_name": distractor.get("name", "?"),
                "degradations": list(deg_list),
                "level": "single",
            }
            cases_by_level["single"].append(case)

            key = _make_degradation_key(deg_list)
            cases_by_degradation.setdefault(key, []).append(case)

        # ------ classic stacked levels ------
        for level_name, degradation_sets in LEVELS.items():
            cases_by_level.setdefault(level_name, [])

            for deg_list in degradation_sets:
                case = {
                    "anchor_id": anchor["canonical_card_id"],
                    "anchor_name": anchor.get("name", "?"),
                    "distractor_id": distractor["canonical_card_id"],
                    "distractor_name": distractor.get("name", "?"),
                    "degradations": list(deg_list),
                    "level": level_name,
                }
                cases_by_level[level_name].append(case)

                key = _make_degradation_key(deg_list)
                cases_by_degradation.setdefault(key, []).append(case)

    # Report.
    print("Cases by level:")
    for level_name in ["single", "moderate", "hard", "extreme"]:
        count = len(cases_by_level.get(level_name, []))
        print(f"  {level_name}: {count} test cases")

    print("\nCases by degradation:")
    for key in sorted(cases_by_degradation.keys()):
        count = len(cases_by_degradation[key])
        labels = [DEGRADATION_LABELS.get(d, d) for d in key.split("+")]
        print(f"  {key} ({', '.join(labels)}): {count} cases")

    total = sum(len(v) for v in cases_by_level.values())
    # Build output.
    output = {
        "cases": cases_by_level,
        "by_degradation": cases_by_degradation,
    }
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"\nWrote {total} total test cases to {OUTPUT}")
    return output


if __name__ == "__main__":
    generate_test_cases()
