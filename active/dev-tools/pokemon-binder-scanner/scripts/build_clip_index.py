#!/usr/bin/env python3
"""
Build a FAISS index using CLIP (ViT-B/32) embeddings for all Pokémon cards.

CLIP embeddings bridge the domain gap between clean reference scans and
real-world phone photos — same card, different lighting/quality → similar vector.

Usage:
  python scripts/build_clip_index.py
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import faiss
import torch
from transformers import CLIPModel, CLIPProcessor
from PIL import Image, ImageOps

DATA_ROOT = Path("/data/home/calvin/pokemon-binder-scanner")
CORPUS_PATH = DATA_ROOT / "cards_manifest.json"
OUTPUT_DIR = DATA_ROOT / "clip_index"
REF_DIR = DATA_ROOT / "reference_cards"

BATCH_SIZE = 64  # CPU-friendly batch size


def build_index(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    corpus = json.loads(CORPUS_PATH.read_text())
    cards = corpus.get("cards", [])
    print(f"Loading CLIP ViT-B/32...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()

    print(f"Processing {len(cards)} cards (batch size {BATCH_SIZE})...")
    all_feats: list[np.ndarray] = []
    meta: list[dict[str, Any]] = []
    seen: set[str] = set()
    batch_images: list[Image.Image] = []
    batch_cids: list[str] = []
    batch_meta: list[dict[str, Any]] = []

    def flush_batch() -> None:
        nonlocal batch_images, batch_cids, batch_meta
        if not batch_images:
            return
        inputs = processor(images=batch_images, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model.get_image_features(**inputs)
            feats = outputs.pooler_output if hasattr(outputs, 'pooler_output') else outputs
            feats = feats / feats.norm(dim=-1, keepdim=True)
        all_feats.append(feats.cpu().numpy().astype(np.float32))
        meta.extend(batch_meta)
        batch_images, batch_cids, batch_meta = [], [], []

    for i, card in enumerate(cards):
        cid = card["canonical_card_id"]
        if cid in seen:
            continue
        seen.add(cid)

        img_path = REF_DIR / f"{cid}.png"
        if not img_path.exists():
            continue

        try:
            with Image.open(img_path) as src:
                img = ImageOps.exif_transpose(src).convert("RGB")
        except Exception:
            continue

        batch_images.append(img)
        batch_cids.append(cid)

        # Also generate phone-photo variants to bridge the domain gap.
        for variant_cfg in [
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "desaturate"]},
            {"visibility": "glare", "tilt_degrees": 4.0, "render_effects": ["heavy_glare"]},
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["blue_cast"]},
        ]:
            try:
                rng = random.Random(f"{cid}-{variant_cfg['visibility']}")
                from pokemon_binder_scanner.binder_fixtures import _apply_card_transform
                variant_img = _apply_card_transform(img.copy().convert("RGBA"), variant_cfg, rng)
                batch_images.append(variant_img.convert("RGB"))
                batch_cids.append(cid)
            except Exception:
                pass

        price = float(card.get("fixture_price_usd", 0.0))
        batch_meta.append({
            "canonical_card_id": cid,
            "name": card.get("name", "Unknown"),
            "set_code": card.get("set_code", ""),
            "set_name": card.get("set_name", ""),
            "rarity": card.get("rarity", ""),
            "collector_number": str(card.get("collector_number", "")),
            "fixture_price_usd": round(price, 2),
        })

        if len(batch_images) >= BATCH_SIZE:
            flush_batch()

        if (i + 1) % 2000 == 0:
            print(f"  {i + 1}/{len(cards)} cards, {len(seen)} unique...")

    flush_batch()

    feats = np.concatenate(all_feats, axis=0).astype(np.float32)
    dim = feats.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(feats)

    faiss.write_index(index, str(output_dir / "clip.index"))
    np.save(output_dir / "embeddings.npy", feats)
    with (output_dir / "cards.json").open("w") as f:
        json.dump(meta, f, ensure_ascii=False)

    print(f"\nDone: {feats.shape[0]} vectors × {dim} dims")
    return {"card_count": feats.shape[0]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    t0 = time.time()
    build_index(args.output)
    print(f"Total time: {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
