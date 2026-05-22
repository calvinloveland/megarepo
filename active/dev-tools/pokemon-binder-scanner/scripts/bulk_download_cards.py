#!/usr/bin/env python3
"""
Bulk-download Pokémon card data and images from the Pokémon TCG API.

Stores everything under /data/home/calvin/pokemon-binder-scanner/:
  - reference_cards/  : card images (one .png per card_id)
  - cards_manifest.json : master manifest with all card metadata
  - logs/             : progress and error logs

Usage:
  python scripts/bulk_download_cards.py              # download everything
  python scripts/bulk_download_cards.py --sets 5     # only first 5 sets
  python scripts/bulk_download_cards.py --resume     # resume from checkpoint
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

API_BASE = "https://api.pokemontcg.io/v2"
DATA_ROOT = Path("/data/home/calvin/pokemon-binder-scanner")
REFERENCE_DIR = DATA_ROOT / "reference_cards"
MANIFEST_PATH = DATA_ROOT / "cards_manifest.json"
CHECKPOINT_PATH = DATA_ROOT / "download_checkpoint.json"
LOG_DIR = DATA_ROOT / "logs"

MAX_WORKERS = 8
RETRY_ATTEMPTS = 3
RETRY_DELAY = 2.0


def api_get(endpoint: str, timeout: int = 30) -> dict[str, Any]:
    """Call the Pokémon TCG API with retries."""
    url = f"{API_BASE}/{endpoint}"
    last_error = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            result = subprocess.run(
                ["curl", "-sG", "-L", "--retry", "3", "--retry-all-errors",
                 "-A", "pokemon-binder-scanner/0.1",
                 url],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
            if result.returncode != 0:
                last_error = RuntimeError(f"curl failed: {result.stderr[:200]}")
                time.sleep(RETRY_DELAY)
                continue
            payload = result.stdout.strip()
            if not payload:
                return {}
            return json.loads(payload)
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(RETRY_DELAY)
    raise last_error or RuntimeError(f"Failed after {RETRY_ATTEMPTS} attempts: {url}")


def fetch_sets() -> list[dict[str, Any]]:
    """Fetch all available card sets."""
    print("Fetching set list...")
    all_sets: list[dict[str, Any]] = []
    page = 1
    while True:
        data = api_get(f"sets?page={page}&pageSize=50")
        sets = data.get("data", [])
        if not sets:
            break
        all_sets.extend(sets)
        if len(sets) < 50:
            break
        page += 1
        time.sleep(0.1)  # rate limit courtesy
    print(f"  Found {len(all_sets)} sets")
    return all_sets


def fetch_cards_for_set(set_id: str, set_name: str) -> list[dict[str, Any]]:
    """Fetch all cards for a given set."""
    all_cards: list[dict[str, Any]] = []
    page = 1
    while True:
        query = f'set.id:{set_id}'
        data = api_get(f"cards?q={query}&page={page}&pageSize=250&orderBy=number")
        cards = data.get("data", [])
        if not cards:
            break
        all_cards.extend(cards)
        total = data.get("totalCount", 0)
        if len(all_cards) >= total or len(cards) < 250:
            break
        page += 1
        time.sleep(0.15)
    print(f"  Set {set_id} ({set_name}): {len(all_cards)} cards")
    return all_cards


def download_image(card_id: str, image_url: str) -> bool:
    """Download a single card image. Returns True on success."""
    output_path = REFERENCE_DIR / f"{card_id}.png"
    if output_path.exists() and output_path.stat().st_size > 100:
        return True  # already downloaded

    tmp_path = output_path.with_suffix(".tmp")
    try:
        result = subprocess.run(
            ["curl", "-sL", "--retry", "3", "--retry-all-errors",
             "-A", "pokemon-binder-scanner/0.1",
             "-o", str(tmp_path),
             image_url],
            capture_output=True, text=True, timeout=60, check=False,
        )
        if result.returncode != 0 or not tmp_path.exists() or tmp_path.stat().st_size < 100:
            tmp_path.unlink(missing_ok=True)
            return False
        tmp_path.rename(output_path)
        return True
    except Exception:
        tmp_path.unlink(missing_ok=True)
        return False


def build_card_manifest_entry(card: dict[str, Any]) -> dict[str, Any]:
    """Build a minimal manifest entry from API card data."""
    card_id = card["id"]
    tcgplayer = card.get("tcgplayer", {}).get("prices", {})
    cardmarket = card.get("cardmarket", {}).get("prices", {})

    # Extract best price: prefer tcgplayer market, then cardmarket trend
    price = 0.0
    variant = "unknown"
    for vtype, vprices in tcgplayer.items():
        if vprices and isinstance(vprices, dict):
            market = vprices.get("market") or vprices.get("mid")
            if market and float(market) > price:
                price = float(market)
                variant = vtype
    if price == 0.0:
        cm_price = cardmarket.get("trendPrice") or cardmarket.get("avg1")
        if cm_price:
            price = float(cm_price)
            variant = "cardmarket"

    return {
        "canonical_card_id": card_id,
        "name": card.get("name", "Unknown"),
        "collector_number": str(card.get("number", "")),
        "set_code": card.get("set", {}).get("id", "").upper(),
        "set_name": card.get("set", {}).get("name", ""),
        "rarity": card.get("rarity", ""),
        "supertype": card.get("supertype", ""),
        "subtypes": card.get("subtypes", []),
        "types": card.get("types", []),
        "variant": variant,
        "condition": "near_mint",
        "reference_image_path": f"reference_cards/{card_id}.png",
        "fixture_price_usd": round(price, 2),
        "reference_image_url": card.get("images", {}).get("small", ""),
    }


def save_checkpoint(completed_sets: set[str]) -> None:
    CHECKPOINT_PATH.write_text(json.dumps({
        "completed_sets": sorted(completed_sets),
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2))


def load_checkpoint() -> set[str]:
    if CHECKPOINT_PATH.exists():
        data = json.loads(CHECKPOINT_PATH.read_text())
        return set(data.get("completed_sets", []))
    return set()


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk download Pokémon card images")
    parser.add_argument("--sets", type=int, default=0, help="Limit to first N sets (0 = all)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS, help=f"Parallel download workers (default {MAX_WORKERS})")
    args = parser.parse_args()

    # Ensure directories exist
    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    # Fetch sets
    sets = fetch_sets()
    if args.sets > 0:
        sets = sets[:args.sets]
        print(f"Limited to first {len(sets)} sets")

    # Load checkpoint
    completed_sets = load_checkpoint() if args.resume else set()
    if completed_sets:
        print(f"Resuming: {len(completed_sets)} sets already completed")

    # Build or load manifest
    manifest: dict[str, Any] = {
        "fixture_name": "pokemon-binder-full-corpus",
        "version": 1,
        "description": "Full Pokémon TCG card corpus downloaded from pokemontcg.io API",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sets": [],
        "total_cards": 0,
        "total_unique_cards": 0,
    }

    all_entries: list[dict[str, Any]] = []
    seen_card_ids: set[str] = set()
    total_cards = 0

    for set_info in sets:
        set_id = set_info["id"]
        if set_id in completed_sets:
            print(f"  Skipping {set_id} ({set_info['name']}) — already completed")
            continue

        try:
            cards = fetch_cards_for_set(set_id, set_info["name"])
        except Exception as exc:
            print(f"  ERROR fetching set {set_id}: {exc}")
            continue

        set_entries = []
        set_card_count = 0
        for card in cards:
            entry = build_card_manifest_entry(card)
            set_entries.append(entry)
            set_card_count += 1
            total_cards += 1

        # Download images in parallel
        download_tasks = []
        for card in cards:
            card_id = card["id"]
            image_url = card.get("images", {}).get("small", "")
            if image_url and card_id not in seen_card_ids:
                download_tasks.append((card_id, image_url))
            seen_card_ids.add(card_id)

        if download_tasks:
            print(f"  Downloading {len(download_tasks)} images for {set_id}...")
            success = 0
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(download_image, cid, url): cid
                    for cid, url in download_tasks
                }
                for future in as_completed(futures):
                    card_id = futures[future]
                    try:
                        if future.result():
                            success += 1
                    except Exception as exc:
                        print(f"    Failed to download {card_id}: {exc}")

            print(f"    Downloaded {success}/{len(download_tasks)} images")

        manifest["sets"].append({
            "set_id": set_id,
            "set_name": set_info["name"],
            "series": set_info.get("series", ""),
            "release_date": set_info.get("releaseDate", ""),
            "card_count": set_card_count,
        })
        all_entries.extend(set_entries)

        # Save checkpoint after each set
        completed_sets.add(set_id)
        save_checkpoint(completed_sets)

        # Write incremental manifest after each set
        manifest["total_cards"] = total_cards
        manifest["total_unique_cards"] = len(seen_card_ids)
        manifest["cards"] = all_entries
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

        # Rate limit between sets
        time.sleep(0.3)

    manifest["total_cards"] = total_cards
    manifest["total_unique_cards"] = len(seen_card_ids)
    manifest["cards"] = all_entries

    # Write manifest
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"\nDone! {total_cards} cards from {len(manifest['sets'])} sets")
    print(f"  {len(seen_card_ids)} unique card IDs")
    downloaded = len(list(REFERENCE_DIR.glob("*.png")))
    print(f"  {downloaded} images in {REFERENCE_DIR}")
    print(f"  Manifest: {MANIFEST_PATH}")
    print(f"  Disk usage: {_du(REFERENCE_DIR)}")

    return 0


def _du(path: Path) -> str:
    try:
        result = subprocess.run(["du", "-sh", str(path)], capture_output=True, text=True, check=False)
        return result.stdout.split()[0] if result.stdout else "unknown"
    except Exception:
        return "unknown"


if __name__ == "__main__":
    sys.exit(main())
