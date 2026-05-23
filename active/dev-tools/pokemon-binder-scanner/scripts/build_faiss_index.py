#!/usr/bin/env python3
"""
Build a persistent FAISS index + compact reference store for all 20K+ cards.

This pre-computes everything the scanner needs so the web app can load it
instantly without re-processing card images.

Usage:
  python scripts/build_faiss_index.py
  python scripts/build_faiss_index.py --output /data/home/calvin/pokemon-binder-scanner/index
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pokemon_binder_scanner.scanner import (  # noqa: E402
    MATCH_SIZE,
    REFERENCE_VARIANT_CONFIGS,
    _fingerprint_from_hsv,
    _prepare_match_image,
    _prepare_reference_variant,
    _signature,
)
from PIL import Image, ImageOps  # noqa: E402

DATA_ROOT = Path("/data/home/calvin/pokemon-binder-scanner")
DEFAULT_CORPUS = DATA_ROOT / "cards_manifest.json"
DEFAULT_OUTPUT = DATA_ROOT / "faiss_index"


def build_index(
    corpus_path: Path,
    output_dir: Path,
    *,
    fingerprint_dim: int = 96,
) -> dict[str, Any]:
    """Build FAISS index and compact reference store from the full corpus."""
    import faiss

    output_dir.mkdir(parents=True, exist_ok=True)
    ref_dir = corpus_path.parent / "reference_cards"

    corpus = json.loads(corpus_path.read_text())
    cards = corpus.get("cards", [])
    print(f"Loading {len(cards)} cards from corpus...")

    fingerprints: list[np.ndarray] = []
    edge_fingerprints: list[np.ndarray] = []
    card_meta: list[dict[str, Any]] = []
    seen: set[str] = set()

    for i, card in enumerate(cards):
        cid = card["canonical_card_id"]
        if cid in seen:
            continue
        seen.add(cid)

        img_path = ref_dir / f"{cid}.png"
        if not img_path.exists():
            continue

        try:
            with Image.open(img_path) as source:
                source_img = ImageOps.exif_transpose(source).convert("RGBA")
        except Exception:
            continue

        # Generate the "clear" reference variant for fingerprinting.
        prepared = _prepare_reference_variant(
            source_img,
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []},
        )
        match_img = _prepare_match_image(prepared.convert("RGB"))
        sig = _signature(match_img)

        # HSV fingerprint (96 dims).
        hsv_fp = _fingerprint_from_hsv(sig["hsv"]).astype(np.float32)
        fingerprints.append(hsv_fp)

        # Edge-density fingerprint (56 dims — column-wise edge energy).
        edge = sig["edge"]
        col_edge = edge.mean(axis=0).astype(np.float32)
        row_edge = edge.mean(axis=1).astype(np.float32)
        edge_fp = np.concatenate([col_edge, row_edge]).astype(np.float32)
        edge_fingerprints.append(edge_fp)

        # Card metadata for the reference store.
        price = float(card.get("fixture_price_usd", 0.0))
        card_meta.append({
            "canonical_card_id": cid,
            "name": card.get("name", "Unknown"),
            "set_code": card.get("set_code", ""),
            "set_name": card.get("set_name", ""),
            "rarity": card.get("rarity", ""),
            "collector_number": str(card.get("collector_number", "")),
            "fixture_price_usd": round(price, 2),
        })

        if (i + 1) % 1000 == 0:
            print(f"  Processed {i + 1}/{len(cards)} cards...")

    print(f"Processed {len(fingerprints)} unique cards")

    # Build FAISS index for HSV fingerprints (primary).
    fp_matrix = np.stack(fingerprints, axis=0).astype(np.float32)
    edge_matrix = np.stack(edge_fingerprints, axis=0).astype(np.float32)

    # Normalise for cosine similarity.
    faiss.normalize_L2(fp_matrix)
    faiss.normalize_L2(edge_matrix)

    # Build combined index: HSV (70%) + edge-profile (30%).
    combined = np.concatenate([fp_matrix * 0.7, edge_matrix * 0.3], axis=1).astype(np.float32)
    faiss.normalize_L2(combined)
    combined_dim = combined.shape[1]
    combined_index = faiss.IndexFlatIP(combined_dim)
    combined_index.add(combined)

    # Persist.
    faiss.write_index(combined_index, str(output_dir / "combined.index"))

    # Write compact reference store.
    with (output_dir / "cards.json").open("w") as f:
        json.dump(card_meta, f, ensure_ascii=False)

    # Write combined fingerprint matrix for direct numpy access.
    np.save(output_dir / "combined_fingerprints.npy", combined)

    print(f"\nIndex built: {len(fingerprints)} cards")
    print(f"  Combined index: {output_dir / 'combined.index'}")
    print(f"  Fingerprints:   {output_dir / 'combined_fingerprints.npy'}")
    print(f"  Card store:     {output_dir / 'cards.json'}")

    return {"card_count": len(fingerprints)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build FAISS index for card corpus")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.corpus.exists():
        print(f"Corpus not found: {args.corpus}")
        print("Run scripts/bulk_download_cards.py first.")
        return 1

    t0 = time.time()
    build_index(args.corpus, args.output)
    t1 = time.time()
    print(f"Total time: {t1 - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
