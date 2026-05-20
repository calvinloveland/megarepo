# pokemon-binder-scanner

Starter project for a real-time Pokémon binder scanning and pricing workflow.

This project was brought into the megarepo from a standalone `photo_pipeline` experiment and now combines two pieces:

- a **video/photo preprocessing pipeline** for turning a shaky phone capture into a cleaner representative frame
- a **picture-only whole-binder fixture corpus** that renders JPEG binder-page photos from real card scans for testing card identification, duplicate handling, edition-sensitive recognition, and binder-total pricing

## Current focus

The immediate goal is not perfect live pricing yet. The goal is to build a stable development loop for:

1. ingesting a phone video or page image
2. stabilizing / stacking frames when helpful
3. detecting binder pockets across different layouts, not just 3×3 pages, including partially irregular scattered pages
4. identifying cards in each pocket
5. pricing the whole binder page-by-page and in aggregate

## Repository layout

```text
active/dev-tools/pokemon-binder-scanner/
├── pyproject.toml
├── README.md
├── src/pokemon_binder_scanner/
│   ├── benchmark.py
│   ├── binder_fixtures.py
│   ├── cli.py
│   ├── pipeline.py
│   └── webapp.py
└── tests/
    ├── fixtures/pokemon_binder/
    └── test_binder_fixtures.py
```

## Install

```bash
cd active/dev-tools/pokemon-binder-scanner
python -m pip install -e .
```

For local development with the web UI and OpenCV stack:

```bash
cd active/dev-tools/pokemon-binder-scanner
python -m pip install -e '.[dev]'
```

## Validate the binder fixture corpus

```bash
cd active/dev-tools/pokemon-binder-scanner
python -m pokemon_binder_scanner.cli validate-fixtures
```

To regenerate the JPEG page previews:

```bash
cd active/dev-tools/pokemon-binder-scanner
PYTHONPATH=src python -m pokemon_binder_scanner.cli render-fixtures
```

To run the picture-only scanner against the rendered fixture pages:

```bash
cd active/dev-tools/pokemon-binder-scanner
PYTHONPATH=src python -m pokemon_binder_scanner.cli evaluate-scanner
```

To audit the raster pipeline for SVG or metadata leakage:

```bash
cd active/dev-tools/pokemon-binder-scanner
PYTHONPATH=src python -m pokemon_binder_scanner.cli audit-picture-only
```

To generate the dataset demo webpage with captured test output, audit output, and scanner evaluation:

```bash
cd active/dev-tools/pokemon-binder-scanner
PYTHONPATH=src python -m pokemon_binder_scanner.cli demo-page
```

This writes `tests/fixtures/pokemon_binder/index.html`.

## Run tests

```bash
cd active/dev-tools/pokemon-binder-scanner
python -m unittest tests/test_binder_fixtures.py
```

The current real-card corpus covers:

- 38 binder pages
- 315 total pockets
- 315 priced cards
- 315 rendered card placements backed by locally cached real reference images
- 0 empty pockets
- 81 duplicate groups
- $15671.79 binder total based on current fixture price fields

## Run the local web app

```bash
cd active/dev-tools/pokemon-binder-scanner
python -m pokemon_binder_scanner.cli web
```

Then open `http://127.0.0.1:7860`.

The default tab is now an image appraiser UI with drag-and-drop upload support:

- drop one or more `.jpg`, `.png`, or `.webp` images into the page
- a loading throbber appears while the image is being appraised
- the page auto-scrolls to the results after appraisal completes
- the UI shows the detected card count, predicted total, and an overlay preview of the detected slots
- each predicted card row includes thumbs up / thumbs down feedback, and a manual correction field when the appraisal is wrong

The legacy video cleanup pipeline remains available on the `Pipeline` tab, and the older benchmark UI remains on the `Benchmark` tab.

## Notes

- The current fixture prices are intentionally stable so regression tests remain deterministic.
- The raster fixture generator creates JPEG binder-page photos with real card scans, including mild and adversarial skew, sleeve glare, soft focus, motion blur, occlusion, and page-level lighting variation.
- The scanner now identifies cards from picture pixels only. It does not parse SVG/XML metadata or hidden per-slot labels.
- The current scanner is more robust than the original baseline because it matches against augmentation-aware reference variants and searches multiple candidate crops per pocket.
- Regression tests now cover layout diversity too: single-card pages, two-card spreads, six-card layouts, and denser 12-card pages so evaluation is not locked to a 3×3 assumption.
- Page 14 includes side-by-side unlimited and 1st-edition Jungle Pikachu scans to regression-test edition-sensitive matching.
- Pages 15–30 are intentionally adversarial and still break the scanner in useful ways, but the improved matcher now recovers much more of the hard set than before.
- Pages 31–34 add non-3×3 layout probes to the main fixture corpus, and the scanner now chooses among common layout templates from the image itself instead of being told the page layout by the evaluator.
- Pages 35–38 add deliberately scattered random layouts that do not fit the original template families. The scanner now falls back to a picture-only irregular-layout detector for low-confidence pages. The detector combines three complementary approaches — HSV saturation/value thresholding, gradient-edge component detection, and local texture variance analysis — to recover most scattered cards, though a few low-signal slots (heavy glare, extreme soft focus) are still missed.
