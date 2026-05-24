#!/usr/bin/env python3
"""
Build a genuinely hard adversarial test corpus for anti-overfitting validation.

Generates test cases at three difficulty levels using confusable card pairs
(same Pokémon name, different printings) with extreme photographic degradation.

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


DEGRADATIONS = {
    "jpeg5": lambda img: _jpeg_compress(img, 5),
    "jpeg10": lambda img: _jpeg_compress(img, 10),
    "jpeg20": lambda img: _jpeg_compress(img, 20),
    "heavy_glare": lambda img: _apply_degradation(img, "glare", 7, ["heavy_glare"]),
    "glare_band": lambda img: _apply_degradation(img, "glare", 4, ["heavy_glare", "center_band"]),
    "motion_blur": lambda img: _apply_degradation(img, "clear", 0, ["motion_blur"]),
    "low_light_desat": lambda img: _apply_degradation(img, "clear", 0, ["low_light", "desaturate"]),
    "blue_cast_soft": lambda img: _apply_degradation(img, "soft_focus", 0, ["blue_cast"]),
    "tilted_occluded": lambda img: _apply_degradation(img, "tilted", 8, ["corner_occlusion"]),
    "sleeve_glare": lambda img: _apply_degradation(img, "sleeve_glare", 6, []),
}

# Difficulty levels: which degradations to apply (can stack)
LEVELS = {
    "moderate": [
        ["jpeg20"],
        ["heavy_glare"],
        ["low_light_desat"],
        ["motion_blur"],
        ["tilted_occluded"],
    ],
    "hard": [
        ["jpeg10", "heavy_glare"],
        ["jpeg10", "low_light_desat"],
        ["jpeg20", "motion_blur", "blue_cast_soft"],
        ["heavy_glare", "blue_cast_soft"],
        ["sleeve_glare", "low_light_desat"],
    ],
    "extreme": [
        ["jpeg5", "heavy_glare", "low_light_desat"],
        ["jpeg5", "motion_blur", "blue_cast_soft"],
        ["jpeg10", "glare_band", "low_light_desat"],
        ["jpeg10", "heavy_glare", "blue_cast_soft", "motion_blur"],
        ["jpeg5", "tilted_occluded", "low_light_desat"],
    ],
}


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


def generate_test_cases(num_pairs: int = 30, seed: int = 42) -> dict[str, Any]:
    """Generate adversarial test cases at all difficulty levels."""
    confusable = load_confusable_pairs(min_printings=4)
    rng = random.Random(seed)
    rng.shuffle(confusable)

    test_cases: dict[str, list[dict[str, Any]]] = {}
    pairs_used = 0

    for group in confusable:
        if pairs_used >= num_pairs:
            break
        # Pick two cards from the same group as confusable pair.
        if len(group) < 2:
            continue
        rng.shuffle(group)
        anchor = group[0]
        distractor = group[1]

        # Only use cards where both reference images exist.
        anchor_path = REF_DIR / f"{anchor['canonical_card_id']}.png"
        dist_path = REF_DIR / f"{distractor['canonical_card_id']}.png"
        if not anchor_path.exists() or not dist_path.exists():
            continue

        pairs_used += 1

        # Load reference images.
        with Image.open(anchor_path) as src:
            anchor_img = ImageOps.exif_transpose(src).convert("RGBA")
        with Image.open(dist_path) as src:
            distractor_img = ImageOps.exif_transpose(src).convert("RGBA")

        for level_name, degradation_sets in LEVELS.items():
            if level_name not in test_cases:
                test_cases[level_name] = []

            for deg_list in degradation_sets:
                # Apply stacked degradations to the anchor.
                degraded = anchor_img.convert("RGB")
                for deg_name in deg_list:
                    degraded = DEGRADATIONS[deg_name](degraded)

                test_cases[level_name].append({
                    "anchor_id": anchor["canonical_card_id"],
                    "anchor_name": anchor.get("name", "?"),
                    "distractor_id": distractor["canonical_card_id"],
                    "distractor_name": distractor.get("name", "?"),
                    "degradations": deg_list,
                    "level": level_name,
                })

    # Count and report.
    for level_name in ["moderate", "hard", "extreme"]:
        count = len(test_cases.get(level_name, []))
        print(f"  {level_name}: {count} test cases")

    OUTPUT.write_text(json.dumps(test_cases, indent=2, ensure_ascii=False))
    print(f"\nWrote {sum(len(v) for v in test_cases.values())} total test cases to {OUTPUT}")
    return test_cases


if __name__ == "__main__":
    generate_test_cases()
