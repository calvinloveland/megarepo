#!/usr/bin/env python3
"""
Rebuild CLIP index with N variants per card for better recall.

Usage:
  python scripts/rebuild_clip_index.py              # default: 8 variants
  python scripts/rebuild_clip_index.py --variants 12  # 12 variants
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
from PIL import Image, ImageOps
from transformers import CLIPModel, CLIPProcessor

from pokemon_binder_scanner.binder_fixtures import _apply_card_transform

CORPUS = Path("/data/home/calvin/pokemon-binder-scanner/cards_manifest.json")
REF_DIR = CORPUS.parent / "reference_cards"
OUTPUT = Path("/data/home/calvin/pokemon-binder-scanner/clip_index")

VARIANT_CONFIGS = [
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "desaturate"]},
    {"visibility": "glare", "tilt_degrees": 4.0, "render_effects": ["heavy_glare"]},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["blue_cast"]},
    {"visibility": "soft_focus", "tilt_degrees": 2.0, "render_effects": []},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["motion_blur"]},
    {"visibility": "glare", "tilt_degrees": -3.0, "render_effects": ["low_light"]},
    {"visibility": "sleeve_glare", "tilt_degrees": 5.0, "render_effects": []},
    {"visibility": "tilted", "tilt_degrees": 7.0, "render_effects": ["desaturate"]},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["heavy_glare", "center_band"]},
    {"visibility": "glare", "tilt_degrees": 6.0, "render_effects": ["blue_cast"]},
    {"visibility": "soft_focus", "tilt_degrees": -3.0, "render_effects": ["low_light", "desaturate"]},
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variants", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()

    num_variants = min(args.variants, len(VARIANT_CONFIGS))
    configs = VARIANT_CONFIGS[:num_variants]
    print(f"Building index with {num_variants} variants per card")

    print("Loading CLIP ViT-B/32...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()

    cards = json.loads(CORPUS.read_text())["cards"]
    all_feats: list[np.ndarray] = []
    meta: list[dict[str, Any]] = []
    t0 = time.time()

    for i, card in enumerate(cards):
        cid = card["canonical_card_id"]
        img_path = REF_DIR / f"{cid}.png"
        if not img_path.exists():
            continue

        with Image.open(img_path) as src:
            img = ImageOps.exif_transpose(src).convert("RGBA")

        # Generate variants.
        variant_imgs = [img.convert("RGB")]  # clean
        for cfg in configs[1:]:  # skip clean (already added)
            try:
                rng = random.Random(f"{cid}-{cfg['visibility']}-{cfg['tilt_degrees']}")
                slot = {
                    "visibility": cfg["visibility"],
                    "tilt_degrees": cfg["tilt_degrees"],
                    "render_effects": list(cfg["render_effects"]),
                }
                variant = _apply_card_transform(img.copy(), slot, rng)
                variant_imgs.append(variant.convert("RGB"))
            except Exception:
                variant_imgs.append(img.convert("RGB"))

        # Batch CLIP embedding.
        inputs = processor(images=variant_imgs, return_tensors="pt")
        with torch.no_grad():
            emb = model.get_image_features(**inputs).pooler_output
            emb = emb / emb.norm(dim=-1, keepdim=True)
        embs = emb.cpu().numpy().astype(np.float32)

        price = float(card.get("fixture_price_usd", 0.0))
        base_meta = {
            "canonical_card_id": cid,
            "name": card.get("name", "Unknown"),
            "set_code": card.get("set_code", ""),
            "set_name": card.get("set_name", ""),
            "rarity": card.get("rarity", ""),
            "collector_number": str(card.get("collector_number", "")),
            "fixture_price_usd": round(price, 2),
        }
        for emb_vec in embs:
            all_feats.append(emb_vec)
            meta.append(dict(base_meta))

        if (i + 1) % 500 == 0:
            elapsed = time.time() - t0
            print(f"  {i+1}/{len(cards)} cards, {len(all_feats)} vectors, {elapsed:.0f}s")

    # Build FAISS index.
    print(f"Building FAISS index with {len(all_feats)} vectors...")
    feats = np.stack(all_feats, axis=0).astype(np.float32)
    dim = feats.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(feats)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(OUTPUT / "clip.index"))
    np.save(OUTPUT / "embeddings.npy", feats)
    with (OUTPUT / "cards.json").open("w") as f:
        json.dump(meta, f, ensure_ascii=False)

    elapsed = time.time() - t0
    print(f"Done: {feats.shape[0]} vectors x {dim} dims in {elapsed:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
