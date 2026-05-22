#!/usr/bin/env python3
"""
Generate an expanded binder manifest using the full Pokémon card corpus.

Creates binder pages with diverse cards across different sets, rarities,
and card types.  The generated manifest follows the same schema as the
existing pokemon_binder fixture and can be used by the scanner and web app.

Usage:
  python scripts/generate_expanded_manifest.py                    # default: 1000 unique cards
  python scripts/generate_expanded_manifest.py --unique-cards 500  # smaller corpus
  python scripts/generate_expanded_manifest.py --unique-cards 5000 # larger corpus
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

DATA_ROOT = Path("/data/home/calvin/pokemon-binder-scanner")
FULL_MANIFEST_PATH = DATA_ROOT / "cards_manifest.json"
EXPANDED_MANIFEST_PATH = DATA_ROOT / "expanded_binder_manifest.json"
RENDERED_DIR = DATA_ROOT / "rendered"

# Page layout definitions (normalized bboxes for 3×3 grid)
GRID_3X3_BBOXES = [
    (0.05, 0.05, 0.25, 0.25),
    (0.365, 0.05, 0.25, 0.25),
    (0.68, 0.05, 0.25, 0.25),
    (0.05, 0.365, 0.25, 0.25),
    (0.365, 0.365, 0.25, 0.25),
    (0.68, 0.365, 0.25, 0.25),
    (0.05, 0.68, 0.25, 0.25),
    (0.365, 0.68, 0.25, 0.25),
    (0.68, 0.68, 0.25, 0.25),
]

# Alternative layouts
LAYOUT_2X2_BBOXES = [
    (0.13, 0.13, 0.28, 0.28),
    (0.52, 0.13, 0.28, 0.28),
    (0.13, 0.52, 0.28, 0.28),
    (0.52, 0.52, 0.28, 0.28),
]

LAYOUT_2X3_BBOXES = [
    (0.07, 0.14, 0.22, 0.22),
    (0.36, 0.14, 0.22, 0.22),
    (0.65, 0.14, 0.22, 0.22),
    (0.07, 0.52, 0.22, 0.22),
    (0.36, 0.52, 0.22, 0.22),
    (0.65, 0.52, 0.22, 0.22),
]

LAYOUT_2UP_BBOXES = [
    (0.12, 0.18, 0.32, 0.32),
    (0.56, 0.18, 0.32, 0.32),
]


def load_full_corpus() -> list[dict[str, Any]]:
    """Load the full card corpus from the bulk download."""
    if not FULL_MANIFEST_PATH.exists():
        print(f"ERROR: Full corpus not found at {FULL_MANIFEST_PATH}")
        print("Run scripts/bulk_download_cards.py first.")
        sys.exit(1)
    data = json.loads(FULL_MANIFEST_PATH.read_text())
    cards = data.get("cards", [])
    if not cards:
        print("ERROR: No cards in corpus")
        sys.exit(1)
    print(f"Loaded {len(cards)} cards from full corpus")
    return cards


def select_diverse_cards(cards: list[dict[str, Any]], target_count: int) -> list[dict[str, Any]]:
    """Select a diverse subset of cards across sets, rarities, and types."""
    rng = random.Random(42)  # deterministic seed for reproducibility

    # Group cards by set
    by_set: dict[str, list[dict[str, Any]]] = {}
    for card in cards:
        set_code = card.get("set_code", "UNKNOWN")
        by_set.setdefault(set_code, []).append(card)

    # Sort sets by size (largest first)
    sorted_sets = sorted(by_set.items(), key=lambda kv: -len(kv[1]))

    # Allocate cards per set proportionally, but ensure each set gets at least 1
    total_available = len(cards)
    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # First pass: pick the best card from each set
    for set_code, set_cards in sorted_sets:
        # Prefer rare holos, then rares, then others
        rarity_order = {"Rare Holo": 0, "Rare Ultra": 0, "Rare Secret": 0,
                        "Rare": 1, "Uncommon": 2, "Common": 3, "Promo": 4}
        set_cards_sorted = sorted(set_cards, key=lambda c: rarity_order.get(
            c.get("rarity", ""), 5))
        for card in set_cards_sorted:
            cid = card["canonical_card_id"]
            if cid not in seen_ids:
                selected.append(card)
                seen_ids.add(cid)
                break

    # Second pass: fill remaining slots proportionally
    remaining = target_count - len(selected)
    if remaining <= 0:
        return selected[:target_count]

    # Weight sets by size for proportional allocation
    set_sizes = {sc: len(cl) for sc, cl in by_set.items()}
    total_set_cards = sum(set_sizes.values())

    allocation: dict[str, int] = {}
    for set_code in set_sizes:
        allocation[set_code] = max(0, int(remaining * set_sizes[set_code] / total_set_cards))

    # Distribute any remainder
    leftover = remaining - sum(allocation.values())
    for set_code, _ in sorted_sets:
        if leftover <= 0:
            break
        allocation[set_code] = allocation.get(set_code, 0) + 1
        leftover -= 1

    # Pick cards from each set
    for set_code, set_cards in sorted_sets:
        target = allocation.get(set_code, 0)
        if target <= 0:
            continue
        available = [c for c in set_cards if c["canonical_card_id"] not in seen_ids]
        rng.shuffle(available)
        picked = 0
        for card in available:
            if picked >= target:
                break
            cid = card["canonical_card_id"]
            if cid not in seen_ids:
                selected.append(card)
                seen_ids.add(cid)
                picked += 1

    rng.shuffle(selected)
    print(f"Selected {len(selected)} unique cards from {len(by_set)} sets")
    return selected[:target_count]


def create_duplicate_groups(selected: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Create duplicate groups for some cards (common cards get more dupes)."""
    rng = random.Random(123)
    singles: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []

    common_cards = [c for c in selected if c.get("rarity") in ("Common", "Uncommon")]
    rare_cards = [c for c in selected if c.get("rarity") in ("Rare", "Rare Holo", "Rare Ultra", "Rare Secret")]
    other_cards = [c for c in selected if c not in common_cards and c not in rare_cards]

    rng.shuffle(common_cards)
    rng.shuffle(rare_cards)

    # About 15% of cards get duplicates
    num_duplicate_groups = max(10, len(selected) // 7)

    # Common cards: 2-5 copies
    common_dup_count = int(num_duplicate_groups * 0.6)
    for card in common_cards[:common_dup_count]:
        count = rng.randint(2, 5)
        for _ in range(count):
            groups.append(dict(card))

    # Rare cards: 2-3 copies
    rare_dup_count = int(num_duplicate_groups * 0.25)
    for card in rare_cards[:rare_dup_count]:
        count = rng.randint(2, 3)
        for _ in range(count):
            groups.append(dict(card))

    # Other cards: 2 copies
    other_dup_count = num_duplicate_groups - common_dup_count - rare_dup_count
    for card in other_cards[:other_dup_count]:
        for _ in range(2):
            groups.append(dict(card))

    # All remaining selected cards appear once
    used_in_groups = {c["canonical_card_id"] for c in groups}
    for card in selected:
        if card["canonical_card_id"] not in used_in_groups:
            singles.append(dict(card))

    # Add some singles to fill out
    extra_singles = [dict(c) for c in selected if c["canonical_card_id"] not in used_in_groups][:max(0, len(singles) - len(groups))]
    rng.shuffle(singles)

    return singles, groups


def assign_to_pages(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assign cards to binder pages with layouts."""
    rng = random.Random(456)

    pages: list[dict[str, Any]] = []
    remaining = list(cards)
    rng.shuffle(remaining)

    page_num = 0

    while remaining:
        # Vary layouts: mostly 3×3, some 2×2, 2×3, 2-up
        layout_roll = rng.random()
        if layout_roll < 0.70:  # 70% 3×3
            bboxes = list(GRID_3X3_BBOXES)
            slots_per_page = 9
            layout_label = f"3×3 grid — page {page_num + 1}"
        elif layout_roll < 0.85:  # 15% 2×3
            bboxes = list(LAYOUT_2X3_BBOXES)
            slots_per_page = 6
            layout_label = f"2×3 grid — page {page_num + 1}"
        elif layout_roll < 0.95:  # 10% 2×2
            bboxes = list(LAYOUT_2X2_BBOXES)
            slots_per_page = 4
            layout_label = f"2×2 grid — page {page_num + 1}"
        else:  # 5% 2-up (valuable card spreads)
            bboxes = list(LAYOUT_2UP_BBOXES)
            slots_per_page = 2
            layout_label = f"2-up spread — page {page_num + 1}"

        page_cards = remaining[:slots_per_page]
        remaining = remaining[slots_per_page:]

        if not page_cards:
            break

        page_id = f"page-{page_num + 1:03d}"
        slots = []
        page_total = 0.0
        priced_count = 0

        for slot_idx, card in enumerate(page_cards):
            slot_id = f"{page_id}-slot-{slot_idx + 1:02d}"
            bbox = bboxes[slot_idx] if slot_idx < len(bboxes) else bboxes[-1]

            # Add some variety: some cards get tilted or have effects
            visibility = "clear"
            effects: list[str] = []
            tilt = 0.0

            effect_roll = rng.random()
            if effect_roll < 0.08:
                visibility = "glare"
                tilt = rng.uniform(-4, 4)
            elif effect_roll < 0.12:
                visibility = "sleeve_glare"
                tilt = rng.uniform(-6, 6)
            elif effect_roll < 0.16:
                visibility = "soft_focus"
            elif effect_roll < 0.19:
                visibility = "tilted"
                tilt = rng.uniform(-8, 8)

            if rng.random() < 0.05:
                effects.append("motion_blur")
            if rng.random() < 0.04:
                effects.append("low_light")
            if rng.random() < 0.04:
                effects.append("blue_cast")

            price = card.get("fixture_price_usd", 0.0)

            slot = {
                "slot_id": slot_id,
                "bbox_norm": list(bbox),
                "visibility": visibility,
                "tilt_degrees": round(tilt, 1),
                "render_effects": effects,
                "card": {
                    "canonical_card_id": card["canonical_card_id"],
                    "name": card["name"],
                    "collector_number": card.get("collector_number", ""),
                    "set_code": card.get("set_code", ""),
                    "set_name": card.get("set_name", ""),
                    "variant": card.get("variant", "unknown"),
                    "condition": card.get("condition", "near_mint"),
                    "reference_image_path": f"reference_cards/{card['canonical_card_id']}.png",
                    "rarity": card.get("rarity", ""),
                    "fixture_price_usd": round(price, 2),
                },
            }
            slots.append(slot)
            page_total += price
            if price > 0:
                priced_count += 1

        page_num += 1
        pages.append({
            "page_id": page_id,
            "label": layout_label,
            "notes": [],
            "slots": slots,
            "expected_total_usd": round(page_total, 2),
        })

    print(f"Created {len(pages)} pages with {sum(len(p['slots']) for p in pages)} total slots")
    return pages


def build_manifest(
    cards: list[dict[str, Any]],
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the full binder manifest."""
    total_cards = sum(len(p["slots"]) for p in pages)
    total_value = round(sum(p["expected_total_usd"] for p in pages), 2)
    unique_card_ids = set()
    priced_count = 0
    card_counts: dict[str, int] = {}
    card_totals: dict[str, float] = {}

    for page in pages:
        for slot in page["slots"]:
            card = slot["card"]
            cid = card["canonical_card_id"]
            unique_card_ids.add(cid)
            price = card.get("fixture_price_usd", 0.0)
            if price > 0:
                priced_count += 1
            card_counts[cid] = card_counts.get(cid, 0) + 1
            card_totals[cid] = round(card_totals.get(cid, 0.0) + price, 2)

    duplicate_groups = []
    for cid, count in sorted(card_counts.items()):
        if count > 1:
            duplicate_groups.append({
                "canonical_card_id": cid,
                "count": count,
                "total_price_usd": round(card_totals[cid], 2),
            })

    return {
        "fixture_name": "pokemon-binder-expanded",
        "version": 1,
        "description": (
            f"Expanded Pokémon binder fixture corpus with {len(unique_card_ids)} unique cards "
            f"across {len(pages)} pages. Generated from full pokemontcg.io API corpus."
        ),
        "pricing_reference": {
            "type": "api-market",
            "currency": "USD",
            "snapshot_date": time.strftime("%Y-%m-%d", time.gmtime()),
            "notes": "Prices sourced from TCGPlayer market / Cardmarket trend via pokemontcg.io API",
        },
        "expected_page_count": len(pages),
        "expected_priced_card_count": priced_count,
        "expected_binder_total_usd": total_value,
        "expected_duplicate_groups": duplicate_groups,
        "pages": pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate expanded binder manifest")
    parser.add_argument("--unique-cards", type=int, default=1000,
                        help="Target number of unique cards (default: 1000)")
    parser.add_argument("--output", type=Path, default=EXPANDED_MANIFEST_PATH,
                        help="Output manifest path")
    args = parser.parse_args()

    # Load full corpus
    cards = load_full_corpus()

    # Select diverse cards
    selected = select_diverse_cards(cards, args.unique_cards)

    # Create distribution with duplicates
    singles, duplicates = create_duplicate_groups(selected)

    # Combine and shuffle
    all_cards = singles + duplicates

    # Assign to pages
    pages = assign_to_pages(all_cards)

    # Build manifest
    manifest = build_manifest(selected, pages)

    # Validate
    errors = validate_manifest(manifest)
    if errors:
        for error in errors:
            print(f"VALIDATION ERROR: {error}")
        return 1

    # Write
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"\nManifest written to {args.output}")
    print(f"  {manifest['expected_page_count']} pages")
    print(f"  {manifest['expected_priced_card_count']} priced cards")
    print(f"  {len(selected)} unique cards")
    print(f"  {len(manifest['expected_duplicate_groups'])} duplicate groups")
    print(f"  Binder total: ${manifest['expected_binder_total_usd']:,.2f}")

    return 0


def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    """Basic validation of manifest structure."""
    errors: list[str] = []
    pages = manifest.get("pages", [])
    if not pages:
        errors.append("No pages in manifest")

    seen_page_ids: set[str] = set()
    seen_slot_ids: set[str] = set()

    for page in pages:
        page_id = page.get("page_id", "")
        if not page_id:
            errors.append("page missing page_id")
            continue
        if page_id in seen_page_ids:
            errors.append(f"duplicate page_id: {page_id}")
        seen_page_ids.add(page_id)

        slots = page.get("slots", [])
        if not slots:
            errors.append(f"page {page_id} has no slots")

        page_total = 0.0
        for slot in slots:
            slot_id = slot.get("slot_id", "")
            if not slot_id:
                errors.append(f"slot missing slot_id in {page_id}")
                continue
            if slot_id in seen_slot_ids:
                errors.append(f"duplicate slot_id: {slot_id}")
            seen_slot_ids.add(slot_id)

            card = slot.get("card", {})
            if not isinstance(card, dict) or not card.get("canonical_card_id"):
                errors.append(f"slot {slot_id} has invalid card")
                continue

            price = card.get("fixture_price_usd", 0)
            if not isinstance(price, (int, float)) or price < 0:
                errors.append(f"slot {slot_id} has invalid price")
            page_total += float(price)

        expected = page.get("expected_total_usd", 0)
        if round(float(expected), 2) != round(page_total, 2):
            errors.append(f"page {page_id} total mismatch: expected {expected}, computed {page_total}")

    if errors:
        return errors
    return []


if __name__ == "__main__":
    sys.exit(main())
