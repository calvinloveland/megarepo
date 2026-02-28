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
full-auto-de-pdf build-epub \
  --ocr-text sample.txt \
  --output out/book.epub \
  --metrics-output out/book.metrics.json \
  --title "Sample Book"

# Run proxy OCR accuracy benchmark against Project Gutenberg references
full-auto-de-pdf benchmark-archive \
  --output data/benchmark_archive_accuracy.json
```
