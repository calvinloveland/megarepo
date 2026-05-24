#!/usr/bin/env python3
"""
Fine-tune a lightweight adapter on top of frozen CLIP embeddings.

Trains a small MLP projection head using contrastive loss on pairs of
(degraded card image, clean card image).  The adapter learns to map
degraded queries closer to their clean reference embeddings while
pushing different cards apart.

After training, rebuild the FAISS index with adapted embeddings.
"""
from __future__ import annotations

import json
import random
import sys
import time
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import faiss
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image, ImageOps
from transformers import CLIPModel, CLIPProcessor

from pokemon_binder_scanner.binder_fixtures import _apply_card_transform

CORPUS = Path("/data/home/calvin/pokemon-binder-scanner/cards_manifest.json")
REF_DIR = CORPUS.parent / "reference_cards"
OUTPUT_DIR = Path("/data/home/calvin/pokemon-binder-scanner/clip_adapted_index")
ADAPTER_PATH = OUTPUT_DIR / "adapter.pt"

BATCH_SIZE = 32
EPOCHS = 5
LEARNING_RATE = 1e-3
ADAPTER_HIDDEN = 256


class CLIPAdapter(nn.Module):
    """A small MLP that projects CLIP embeddings into a better similarity space."""

    def __init__(self, input_dim: int = 512, hidden_dim: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, input_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.net(x)
        return out / out.norm(dim=-1, keepdim=True)


def generate_degraded_image(
    img: Image.Image, rng: random.Random, difficulty: str = "mixed"
) -> Image.Image:
    """Apply random photographic degradation to a clean card image."""
    degradations = []
    roll = rng.random()

    if difficulty == "easy" or (difficulty == "mixed" and roll < 0.4):
        # Single degradation.
        choices = [
            lambda i: _apply_degradation(i, rng, "glare", 5, ["heavy_glare"]),
            lambda i: _apply_degradation(i, rng, "clear", 0, ["low_light", "desaturate"]),
            lambda i: _apply_degradation(i, rng, "clear", 0, ["blue_cast"]),
            lambda i: _apply_degradation(i, rng, "soft_focus", 0, []),
            lambda i: _jpeg_compress(i, rng.randint(15, 40)),
        ]
        degradations.append(rng.choice(choices))
    elif difficulty == "hard" or (difficulty == "mixed" and roll < 0.7):
        # Two degradations.
        choices = [
            (lambda i: _apply_degradation(i, rng, "glare", 5, ["heavy_glare"]),
             lambda i: _jpeg_compress(i, rng.randint(10, 25))),
            (lambda i: _apply_degradation(i, rng, "clear", 0, ["low_light", "desaturate"]),
             lambda i: _apply_degradation(i, rng, "glare", 3, [])),
            (lambda i: _apply_degradation(i, rng, "clear", 0, ["motion_blur"]),
             lambda i: _apply_degradation(i, rng, "clear", 0, ["blue_cast"])),
        ]
        d1, d2 = rng.choice(choices)
        degradations.extend([d1, d2])
    else:
        # Three+ degradations.
        degradations = [
            lambda i: _apply_degradation(i, rng, "glare", 6, ["heavy_glare"]),
            lambda i: _apply_degradation(i, rng, "clear", 0, ["low_light", "desaturate"]),
            lambda i: _jpeg_compress(i, rng.randint(5, 15)),
        ]

    result = img.convert("RGB")
    for d in degradations:
        result = d(result)
    return result


def _jpeg_compress(img: Image.Image, quality: int) -> Image.Image:
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _apply_degradation(
    img: Image.Image, rng: random.Random, visibility: str, tilt: float, effects: list[str]
) -> Image.Image:
    slot = {"visibility": visibility, "tilt_degrees": tilt, "render_effects": effects}
    return _apply_card_transform(img.convert("RGBA"), slot, rng).convert("RGB")


def embed_batch(model, processor, images: list[Image.Image]) -> torch.Tensor:
    """Get CLIP embeddings for a batch of images."""
    inputs = processor(images=images, return_tensors="pt")
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
        feats = outputs.pooler_output
    return feats / feats.norm(dim=-1, keepdim=True)


def train_adapter() -> CLIPAdapter:
    """Train the CLIP adapter on degraded→clean card pairs."""
    print("Loading CLIP model...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()

    corpus = json.loads(CORPUS.read_text())
    cards = corpus["cards"]
    # Filter to cards with existing reference images.
    valid_cards = []
    for c in cards:
        if (REF_DIR / f"{c['canonical_card_id']}.png").exists():
            valid_cards.append(c)
    print(f"Training on {len(valid_cards)} cards")

    adapter = CLIPAdapter()
    optimizer = optim.Adam(adapter.parameters(), lr=LEARNING_RATE)
    criterion = nn.CosineEmbeddingLoss()

    rng = random.Random(42)
    card_ids = [c["canonical_card_id"] for c in valid_cards]
    # Pre-build a mapping from card_id to index for negative sampling.
    id_to_idx = {cid: i for i, cid in enumerate(card_ids)}

    # Pre-compute clean CLIP embeddings for all cards (we'll need them for
    # positive pairs and for the index rebuild).
    print("Pre-computing clean CLIP embeddings...")
    clean_embs: dict[str, torch.Tensor] = {}
    for i in range(0, len(valid_cards), BATCH_SIZE):
        batch_cards = valid_cards[i : i + BATCH_SIZE]
        images = []
        for c in batch_cards:
            with Image.open(REF_DIR / f"{c['canonical_card_id']}.png") as src:
                img = ImageOps.exif_transpose(src).convert("RGB")
            images.append(img)
        with torch.no_grad():
            embs = embed_batch(model, processor, images)
        for c, emb in zip(batch_cards, embs):
            clean_embs[c["canonical_card_id"]] = emb

    print(f"Training adapter for {EPOCHS} epochs...")
    steps_per_epoch = min(2000, len(valid_cards) // 4)
    adapter.train()

    for epoch in range(EPOCHS):
        total_loss = 0.0
        rng.shuffle(valid_cards)

        for step in range(0, steps_per_epoch, BATCH_SIZE // 2):
            batch = valid_cards[step : step + BATCH_SIZE // 2]
            if len(batch) < 2:
                continue

            anchors: list[torch.Tensor] = []
            positives: list[torch.Tensor] = []
            negatives: list[torch.Tensor] = []

            for card in batch:
                cid = card["canonical_card_id"]
                # Load clean image.
                with Image.open(REF_DIR / f"{cid}.png") as src:
                    clean_img = ImageOps.exif_transpose(src).convert("RGB")

                # Generate a degraded version (anchor).
                degraded = generate_degraded_image(clean_img.copy(), rng, "mixed")

                # Embed both.
                with torch.no_grad():
                    anchor_emb = embed_batch(model, processor, [degraded])[0]
                positive_emb = clean_embs[cid]

                # Negative: a different random card.
                neg_cid = rng.choice(card_ids)
                while neg_cid == cid:
                    neg_cid = rng.choice(card_ids)
                negative_emb = clean_embs[neg_cid]

                anchors.append(anchor_emb)
                positives.append(positive_emb)
                negatives.append(negative_emb)

            anchor_t = torch.stack(anchors)
            positive_t = torch.stack(positives)
            negative_t = torch.stack(negatives)

            # Apply adapter.
            anchor_adapted = adapter(anchor_t)
            positive_adapted = adapter(positive_t)
            negative_adapted = adapter(negative_t)

            # Contrastive loss: push anchor towards positive, away from negative.
            # CosEmbeddingLoss with y=1 for positive pairs, y=-1 for negative.
            loss_pos = criterion(anchor_adapted, positive_adapted, torch.ones(len(anchors)))
            loss_neg = criterion(anchor_adapted, negative_adapted, -torch.ones(len(anchors)))
            loss = loss_pos + 0.5 * loss_neg

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

            if (step // (BATCH_SIZE // 2)) % 200 == 0:
                print(f"  Epoch {epoch+1}, step {step}: loss={loss.item():.4f}")

        avg_loss = total_loss / max(1, steps_per_epoch / (BATCH_SIZE // 2))
        print(f"Epoch {epoch+1}/{EPOCHS}: avg_loss={avg_loss:.4f}")

    # Save adapter.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(adapter.state_dict(), ADAPTER_PATH)
    print(f"Adapter saved to {ADAPTER_PATH}")

    # Rebuild FAISS index with adapted embeddings.
    print("Rebuilding FAISS index with adapted embeddings...")
    rebuild_index(model, processor, adapter, clean_embs, card_ids)
    return adapter


def rebuild_index(
    model, processor, adapter: CLIPAdapter, clean_embs: dict, card_ids: list[str]
) -> None:
    """Build a new FAISS index using adapted embeddings."""
    adapter.eval()
    corpus = json.loads(CORPUS.read_text())
    cards = corpus["cards"]

    all_feats: list[np.ndarray] = []
    meta: list[dict[str, Any]] = []

    for card in cards:
        cid = card["canonical_card_id"]
        if cid not in clean_embs:
            continue

        # Clean variant.
        with torch.no_grad():
            adapted = adapter(clean_embs[cid].unsqueeze(0))[0].cpu().numpy().astype(np.float32)
        all_feats.append(adapted)

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
        meta.append(base_meta)

        # Phone-photo variants.
        rng = random.Random(cid)
        img_path = REF_DIR / f"{cid}.png"
        if not img_path.exists():
            continue
        with Image.open(img_path) as src:
            img = ImageOps.exif_transpose(src).convert("RGBA")

        for variant_cfg in [
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "desaturate"]},
            {"visibility": "glare", "tilt_degrees": 4.0, "render_effects": ["heavy_glare"]},
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["blue_cast"]},
            {"visibility": "soft_focus", "tilt_degrees": 2.0, "render_effects": []},
            {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["motion_blur"]},
        ]:
            try:
                rng2 = random.Random(f"{cid}-{variant_cfg['visibility']}")
                variant_img = _apply_card_transform(img.copy(), variant_cfg, rng2)
                with torch.no_grad():
                    emb = embed_batch(model, processor, [variant_img.convert("RGB")])
                    adapted = adapter(emb[0].unsqueeze(0))[0].cpu().numpy().astype(np.float32)
                all_feats.append(adapted)
                meta.append(dict(base_meta))
            except Exception:
                pass

    feats = np.stack(all_feats, axis=0).astype(np.float32)
    dim = feats.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(feats)
    faiss.write_index(index, str(OUTPUT_DIR / "clip.index"))
    np.save(OUTPUT_DIR / "embeddings.npy", feats)
    with (OUTPUT_DIR / "cards.json").open("w") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(f"Index: {feats.shape[0]} vectors × {dim} dims")


def main() -> int:
    t0 = time.time()
    train_adapter()
    print(f"Total time: {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
