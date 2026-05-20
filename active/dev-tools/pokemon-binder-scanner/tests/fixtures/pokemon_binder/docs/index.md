# Pokémon binder fixture set

This picture-only fixture set is an expanded starting point for a real-time binder-pricing workflow.

## What it covers

- **Whole-binder pricing** instead of a single card crop
- **Layout flexibility checks** so the scanner can be regression-tested on single-card, sparse, and denser multi-card pages
- **Page totals and binder totals** for regression checks
- **Duplicate cards** so rollups can be tested
- **Visibility edge cases** like glare, sleeve glare, soft focus, and tilt
- **A broader value spread** from budget pages to high-end chase-card pages
- **A side-by-side first-edition vs unlimited test pair** so edition-sensitive matching is exercised
- **A much larger bank of adversarial breakage pages** with motion blur, occlusion, extreme tilt, glare, low light, and similar-looking cards so the current scanner has many known hard failures
- **A stronger picture-only matcher** that uses augmentation-aware references, multi-crop pocket search, and image-only layout selection, improving recovery on the hard pages without reintroducing metadata leakage
- **Random scattered layout pages** that intentionally fall outside the current template detector so future work has clear counting and localization failures to attack

Current corpus size:

- **38 pages**
- **315 slots**
- **315 priced cards**
- **315 rendered card placements backed by locally cached real reference images**
- **0 empty pockets**
- **$15671.79 binder total from current fixture price fields**

## Files

- `manifest.json` — canonical fixture data and expected pricing totals
- `rendered/*.jpg` — generated JPEG binder-page photos derived from the manifest
- `index.html` — generated dataset demo page with summary metrics, audit output, and scanner evaluation

## Regenerate previews

From `active/dev-tools/pokemon-binder-scanner`:

```bash
python -m pokemon_binder_scanner.cli render-fixtures
python -m pokemon_binder_scanner.cli evaluate-scanner
python -m pokemon_binder_scanner.cli demo-page
```

## Why stable fixture prices?

The prices are intentionally stable rather than live-fetched on every run. That keeps tests deterministic when market prices move, while still letting the pricing pipeline prove that it can:

- identify cards consistently
- total a page correctly
- total a binder correctly
- handle duplicates without double-counting mistakes
