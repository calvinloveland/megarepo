# full-auto-de-pdf

Scanned PDF to EPUB conversion toolkit.

## Quickstart

```bash
cd active/dev-tools/full-auto-de-pdf
python -m pip install -e .
full-auto-de-pdf --help
```

## Current commands

```bash
# Build starter archive.org metadata manifest
full-auto-de-pdf manifest --output data/archive_manifest.json

# Build a structured EPUB from OCR text
# (OCR cleanup is enabled by default; pass --no-cleanup to disable)
full-auto-de-pdf build-epub \
  --ocr-text sample.txt \
  --output out/book.epub \
  --metrics-output out/book.metrics.json \
  --title "Sample Book"

# Run OCR accuracy benchmark against Project Gutenberg references
# (true edit-distance CER/WER on normalized sampled text with cleanup + alignment,
# and per-book source selection between djvu/abbyy when available)
full-auto-de-pdf benchmark-archive \
  --source-mode djvu \
  --output data/benchmark_archive_accuracy.json

# Optional oracle mode (upper-bound): choose best source per book
full-auto-de-pdf benchmark-archive \
  --source-mode best \
  --output data/benchmark_archive_accuracy_best.json

# Build a local synthetic printed-text benchmark corpus from public-domain books
full-auto-de-pdf build-benchmark-corpus \
  --output-dir data/benchmark-corpus \
  --cache-dir data/cache \
  --max-books 5 \
  --artifact-profile clean \
  --artifact-profile scan-light \
  --artifact-profile scan-moderate \
  --artifact-seed 7

# Run the local OCR pipeline against the generated corpus
full-auto-de-pdf benchmark-corpus \
  --corpus-manifest data/benchmark-corpus/manifest.json \
  --output data/benchmark_corpus_report.json \
  --preprocess-mode auto \
  --tesseract-psm auto

# Build a benchmark manifest from existing page images + ground-truth text
# (useful for corpora like Old Books Dataset after downloading them locally)
full-auto-de-pdf build-image-text-corpus \
  --images-dir data/old-books/300dpi/tiff \
  --texts-dir data/old-books/groundtruth \
  --output-manifest data/old_books_manifest.json

# Benchmark a local aligned OCR/proofread TSV corpus such as
# Guten_HT_highpairs.tsv or Guten_HT_lowpairs.tsv from Illinois Data Bank
full-auto-de-pdf benchmark-parallel-text \
  --input data/Guten_HT_highpairs.tsv \
  --output data/guten_ht_highpairs_report.json \
  --domain Fiction \
  --limit 5000

# Run local OCR on a scanned PDF with pdftoppm + adaptive page-level OCR selection
full-auto-de-pdf ocr-pdf \
  --pdf scans/book.pdf \
  --output out/book.ocr.txt \
  --work-dir data/ocr-work \
  --preprocess-mode auto \
  --tesseract-psm auto \
  --inverse-render-rerank \
  --inverse-render-top-k 3 \
  --binarize-threshold 190 \
  --deskew-max-angle 3.0 \
  --deskew-angle-step 0.5 \
  --ocr-engine tesseract
# (tries multiple preprocess modes, including scan-tuned Otsu and
#  scan-local-threshold variants built from autocontrast + median + 3x upsample,
#  now prefers a near-best scan-local-threshold result over the plain scan winner
#  on strong degraded pages before falling back to the narrow visual tie-break,
#  plus multiple Tesseract page-segmentation modes per page,
#  applies a narrow inverse-render tie-break among close none/scan/scan-local-threshold
#  candidates in auto mode,
#  optionally re-renders the top OCR candidates back into page images to
#  rerank ambiguous pages by ink-overlap against the scan, then writes
#  per-page OCR artifacts and selection metadata under
#  data/ocr-work/page_ocr by default)

# Optional experimental degraded-scan mode:
# keep the scan stack, but swap final Otsu binarization for adaptive Gaussian thresholding
full-auto-de-pdf ocr-pdf \
  --pdf scans/book.pdf \
  --output out/book.scan-local-threshold.txt \
  --work-dir data/ocr-work-local-threshold \
  --preprocess-mode scan-local-threshold \
  --tesseract-psm 6

# Optional stronger engine (install first: pip install -e '.[ocr]')
# (the optional extras pin a CPU-compatible Paddle runtime for Linux/headless use)
full-auto-de-pdf ocr-pdf \
  --pdf scans/book.pdf \
  --output out/book.paddle.txt \
  --ocr-engine paddleocr

# Evaluate OCR output across preprocess modes (none/scan/basic/deskew/dewarp)
full-auto-de-pdf ocr-eval-modes \
  --pdf scans/book.pdf \
  --output data/ocr_mode_eval.json \
  --reference-text refs/book.txt \
  --ocr-engine paddleocr
# (includes mode_ranking and best_mode when reference text is supplied)

# Benchmark local OCR modes against archive OCR text for a specific identifier
full-auto-de-pdf benchmark-local-archive \
  --pdf scans/book.pdf \
  --archive-identifier dracu00stok \
  --archive-source-mode djvu \
  --ocr-engine paddleocr \
  --output data/local_archive_benchmark.json

# Render an HTML page with failure tokens and page images from local benchmark artifacts
full-auto-de-pdf benchmark-failures-page \
  --report data/local_archive_benchmark.json \
  --output data/benchmark_failures.html

# Render an HTML page that explains OCR processing with PDF/page examples
full-auto-de-pdf benchmark-processing-page \
  --report data/local_archive_benchmark.json \
  --output data/benchmark_processing.html

# Evaluate EPUB structure + optional epubcheck
full-auto-de-pdf eval-epub \
  --epub out/book.epub \
  --output data/epub_eval.json \
  --reference-headings refs/book_headings.txt
```

## What changed

- `ocr-pdf` can now use `--preprocess-mode auto` and `--tesseract-psm auto` to try several page-level OCR candidates, including both scan-tuned Otsu and scan-local-threshold paths, and keep the best-scoring result for each page; on stronger degraded pages it now also prefers a near-best `scan-local-threshold` result over the plain `scan` winner before applying the existing narrow inverse-render tie-break across `none`/`scan`/`scan-local-threshold`.
- There is now an experimental `scan-local-threshold` preprocess mode that keeps the scan stack (`autocontrast -> median -> 3x upsample`) but swaps the final Otsu binarization for adaptive Gaussian thresholding; it is intended for degraded scans and is now included in `auto`.
- `ocr-pdf` and `benchmark-corpus` can optionally use `--inverse-render-rerank` to re-render the top OCR candidates and compare thresholded ink overlap against the scanned page as a slow second-pass verifier.
- `benchmark-failures-page` now includes richer representative PDF/page examples with selected preprocess metadata and candidate-score tables, and `benchmark-processing-page` renders a separate walkthrough page that explains the OCR pipeline stages with page examples.
- OCR cleanup now includes precision-gated adjacent-word merge repair plus conservative confusable-word repair for residual scan errors like split names and `world`/`worid`-style glyph confusions; inverse-render reranking also evaluates cleaned candidate variants so these repairs can be image-verified before selection.
- Per-page OCR manifests now record the selected preprocess mode, selected Tesseract PSM, and candidate scoring data for debugging and benchmarking.
- `build-epub` now emits a more structured EPUB3 archive with multiple XHTML chapters when chapter headings are detected, a richer navigation document, semantic headings, preserved ordered/unordered lists, and a bundled stylesheet.
- `build-benchmark-corpus` now creates a reproducible local printed-text corpus by rendering curated Project Gutenberg excerpts into synthetic PDFs and page images, and it can expand each excerpt into multiple deterministic scan-artifact variants (`clean`, `scan-light`, `scan-moderate`, `scan-heavy`).
- `benchmark-corpus` runs the local OCR pipeline against that generated corpus so printed-text accuracy can be measured end to end inside the repo.
- `build-image-text-corpus` can turn a local page-image + transcript directory pair into a `benchmark-corpus` manifest, which makes image-based external corpora easier to evaluate with the existing OCR pipeline.
- `benchmark-parallel-text` can score aligned OCR/proofread TSV corpora such as the Gutenberg-HathiTrust sentence-pair downloads without manual sampling.
- Generated benchmark pages now prefer system fontconfig fonts when available and are saved as OCR-ready monochrome 300 DPI images, which makes the built-in printed-text benchmark far more representative and stable.

## Accuracy note

This project now has a stronger adaptive OCR pipeline aimed at high printed-text accuracy, but a true 99.9% claim still depends on measuring against a representative benchmark corpus for the exact document set you care about.

### Current benchmark snapshot

- Best currently re-measured local benchmark: generated clean synthetic corpus slice (1 book, current seed-9 artifacts) at **0.999869 char accuracy / 0.984756 word accuracy**.
- Best degraded synthetic scan snapshot with the new Otsu-based `scan` mode: combined `scan-moderate` + `scan-heavy` slice at **0.997766 char accuracy / 0.973476 word accuracy**.
- In a newer local validation on the existing degraded scans-only manifest with `--tesseract-psm 6`, experimental `scan-local-threshold` improved aggregate accuracy from **0.989685 char / 0.935061 word** (`scan`) to **0.991656 char / 0.945122 word**.
- Inverse-render reranking is implemented, but it still needs broader corpus validation before its accuracy impact should be claimed beyond targeted page-level experiments.
- Most remaining clean-slice “word errors” are benchmark-normalization issues rather than serious reading errors: smart quotes vs straight quotes, Gutenberg italic markers (`_word_` vs `word`), and possessive tokenization (`author’s` vs `author s`). Under a light typography normalization pass, that clean slice rises to about **0.998386 word accuracy**.
- The remaining degraded-scan failures are much more informative: they cluster around merge/split errors and a few glyph confusions, such as `Norris -> not is`, `world -> worid`, `before -> be fox`, and `not -> net`. The pipeline now includes a precision-gated repair layer for these patterns and lets inverse-render reranking verify cleaned candidate variants, but the aggregate benchmark impact still needs remeasurement on a larger scan slice.

## Benchmark corpus strategy

- Ideal external corpus: the Gutenberg-HathiTrust Parallel Corpus described at <https://hdl.handle.net/2142/109695>, which reports 19,049 aligned OCR/proofread English book pairs.
- Built-in practical corpus: `build-benchmark-corpus` generates a smaller, reproducible public-domain printed-text corpus locally so you can benchmark immediately without depending on an external dataset mirror.
- Larger image-based candidates when you want true raster OCR benchmarking: Old Bailey Proceedings page images plus transcripts (~180k pages), IMPACT ground-truth collections, and local Old Books / NOD-style image-text datasets once downloaded into the workspace.
- Real scanned-book accuracy should still be checked with `benchmark-archive` and `benchmark-local-archive`, because the generated corpus is intentionally cleaner than real scans.
