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

# Build baseline EPUB from OCR text
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

# Run local OCR on a scanned PDF with pdftoppm + tesseract
full-auto-de-pdf ocr-pdf \
  --pdf scans/book.pdf \
  --output out/book.ocr.txt \
  --work-dir data/ocr-work \
  --preprocess-mode deskew \
  --binarize-threshold 170 \
  --deskew-max-angle 3.0 \
  --deskew-angle-step 0.5
# (writes per-page OCR artifacts under data/ocr-work/page_ocr by default)

# Evaluate OCR output across preprocess modes (none/basic/deskew/dewarp)
full-auto-de-pdf ocr-eval-modes \
  --pdf scans/book.pdf \
  --output data/ocr_mode_eval.json \
  --reference-text refs/book.txt
# (includes mode_ranking and best_mode when reference text is supplied)

# Benchmark local OCR modes against archive OCR text for a specific identifier
full-auto-de-pdf benchmark-local-archive \
  --pdf scans/book.pdf \
  --archive-identifier dracu00stok \
  --archive-source-mode djvu \
  --output data/local_archive_benchmark.json
```
