# Pokemon Binder Scanner

Identify and price Pokemon cards from binder page photos using CLIP + FAISS.

**Live at:** `http://192.168.1.168:7860`

## Features

- **Drop a photo** — auto-scans on upload, no submit button needed
- **Overlay** — toggle bounding boxes, card names, and prices on the image
- **20,000+ cards** — identifies against the full Pokemon TCG corpus
- **CLIP embeddings** — 98% top-1 accuracy on moderate phone-photo degradation
- **1st-edition detection** — template matching on the edition stamp region
- **Variant dropdown** — manually select holo/non-holo when CLIP can't tell
- **TCGPlayer links** — buy any identified card directly
- **Export** — CSV download or JSON copy to clipboard

## Accuracy (12-variant CLIP index)

| Degradation | Accuracy |
|---|---|
| Moderate (single effect) | 97.7% |
| Hard (two stacked effects) | 92.3% |
| Extreme (three+ effects + JPEG 5) | 40.9% |

1,050 adversarial test cases across 50 confusable Pokemon pairs.

## Architecture

```
Uploaded photo
    ↓
Contour detection + grid inference (finds card bounding boxes)
    ↓
CLIP ViT-B/32 embedding (512-dim) per card crop
    ↓
FAISS inner-product search over 245K pre-computed embeddings
    ↓
Edition stamp template matching (1st edition vs unlimited)
    ↓
Results with toggleable overlay + variant selector
```

## Setup

```bash
source scripts/env.sh              # set up NixOS library paths
pip install -e '.[dev]'            # install Python dependencies

# Build card database (one-time):
python scripts/bulk_download_cards.py      # ~20K cards from pokemontcg.io
python scripts/rebuild_clip_index.py       # CLIP + FAISS index (~5h CPU)
python scripts/build_adversarial_corpus.py # test cases
```

## Run

```bash
source scripts/env.sh
python -m pokemon_binder_scanner.cli web    # http://localhost:7860
```

Or via systemd: `systemctl --user start pokemon-binder-scanner`

## Tests

```bash
source scripts/env.sh
python -m pytest tests/ -v

# Key test suites:
#   test_scanner_units.py        - 68 unit tests
#   test_binder_fixtures.py      - fixture validation + web app
#   test_edition_stamps.py       - 1st-edition stamp detection
#   AdversarialCorpusTests       - 1,050 hard cases (95/90/38% thresholds)
```

## Data

- Reference images: `/data/home/calvin/pokemon-binder-scanner/reference_cards/` (20K PNGs)
- CLIP index: `/data/home/calvin/pokemon-binder-scanner/clip_index/` (245K vectors, 502MB)
- Adversarial corpus: `/data/home/calvin/pokemon-binder-scanner/adversarial_corpus.json`
