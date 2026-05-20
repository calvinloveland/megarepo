from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

POKEMON_TCG_API_BASE = "https://api.pokemontcg.io/v2/cards"
SET_ID_MAP = {
    "SV1": "sv1",
    "SV2": "sv2",
    "SV3": "sv3",
    "SV4": "sv4",
    "SV5": "sv5",
    "SV6": "sv6",
    "SV8": "sv8",
    "SWSH2": "swsh2",
    "SWSH7": "swsh7",
    "SWSH9": "swsh9",
    "SWSH12": "swsh12",
    "XY12": "xy12",
    "DET": "det1",
    "BSTTG": "swsh9tg",
}


def sync_manifest_reference_assets(
    manifest_path: str | Path,
    asset_dir: str | Path,
) -> dict[str, Any]:
    manifest_file = Path(manifest_path)
    assets_path = Path(asset_dir)
    assets_path.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    resolved_cards: dict[str, dict[str, Any]] = {}
    downloaded = 0
    skipped: list[str] = []

    for page in manifest.get("pages", []):
        for slot in page.get("slots", []):
            card = slot.get("card")
            if not isinstance(card, dict):
                continue
            key = str(card.get("canonical_card_id", "")).strip()
            if not key:
                continue
            if key not in resolved_cards:
                try:
                    record = resolve_reference_card(card)
                    image_path = download_reference_image(record, assets_path)
                    resolved_cards[key] = {
                        "api_card_id": record.get("id"),
                        "api_set_id": record.get("set", {}).get("id"),
                        "reference_image_url": record.get("images", {}).get("small"),
                        "reference_image_path": str(image_path.relative_to(manifest_file.parent)),
                    }
                    downloaded += 1
                except RuntimeError:
                    resolved_cards[key] = {}
                    skipped.append(key)
            card.update(resolved_cards[key])

    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {
        "resolved_unique_cards": len([value for value in resolved_cards.values() if value]),
        "downloaded_images": downloaded,
        "skipped_unique_cards": skipped,
        "asset_dir": str(assets_path),
    }


def resolve_reference_card(card: dict[str, Any]) -> dict[str, Any]:
    queries = _candidate_queries(card)
    last_count = None
    for query in queries:
        response = _fetch_api_json(query)
        last_count = response.get("count", 0)
        if response.get("count"):
            return response["data"][0]
    raise RuntimeError(
        f"Failed to resolve Pokémon card reference for {card.get('name')} {card.get('collector_number')} "
        f"after {len(queries)} queries; last count={last_count}"
    )


def download_reference_image(record: dict[str, Any], asset_dir: Path) -> Path:
    card_id = str(record.get("id", "unknown-card"))
    image_url = str(record.get("images", {}).get("small", "")).strip()
    if not image_url:
        raise RuntimeError(f"Resolved card {card_id} does not have an image URL")
    output_path = asset_dir / f"{card_id}.png"
    if output_path.exists() and output_path.stat().st_size > 0:
        return output_path
    subprocess.run(["curl", "-sL", image_url, "-o", str(output_path)], check=True)
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"Failed to download image for {card_id} from {image_url}")
    return output_path


def _candidate_queries(card: dict[str, Any]) -> list[str]:
    name = str(card.get("name", "")).strip()
    number = str(card.get("collector_number", "")).strip()
    set_code = str(card.get("set_code", "")).strip().upper()

    quoted_name = name.replace('"', '\\"')
    queries: list[str] = []
    if set_code == "PROMO":
        promo_set_ids = ["swshp", "svp", "basep"]
        for set_id in promo_set_ids:
            queries.append(f'name:"{quoted_name}" set.id:{set_id} number:{number}')
        queries.append(f'name:"{quoted_name}" number:{number}')
        queries.append(f'name:"{quoted_name}"')
        return queries

    mapped_set_id = SET_ID_MAP.get(set_code)
    if mapped_set_id:
        queries.append(f'name:"{quoted_name}" set.id:{mapped_set_id} number:{number}')
    queries.append(f'name:"{quoted_name}" number:{number}')
    if mapped_set_id:
        queries.append(f'name:"{quoted_name}" set.id:{mapped_set_id}')
    queries.append(f'name:"{quoted_name}"')
    return queries


def _fetch_api_json(query: str) -> dict[str, Any]:
    curl_command = [
        "curl",
        "-sG",
        "-L",
        "--retry",
        "3",
        "--retry-all-errors",
        "-A",
        "pokemon-binder-scanner/0.1",
        "--data-urlencode",
        f"q={query}",
        POKEMON_TCG_API_BASE,
    ]
    result = subprocess.run(curl_command, capture_output=True, text=True, check=True)
    payload = result.stdout.strip()
    if not payload:
        return {"count": 0, "data": []}
    return json.loads(payload)
