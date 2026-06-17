# AGENTS.md — OCR Arena

This is the web demo for the `full-auto-de-pdf` OCR → EPUB3 pipeline.

## Start here

- Read [`README.md`](README.md) and [`docs/index.md`](docs/index.md) for the
  high-level tour and the `ocr.shsw.dev` deploy steps.
- Read [`active/dev-tools/full-auto-de-pdf/AGENTS.md`](../full-auto-de-pdf/AGENTS.md)
  for the underlying pipeline's architecture, test conventions, and lint
  rules — they apply here too.

## Role in the megarepo

- `full-auto-de-pdf` is the library + CLI that does the actual work.
- `ocr-arena` is a thin Flask frontend on top of it. The web app **never**
  reimplements OCR / cleanup / EPUB building — it always calls into the
  library:
  - `full_auto_de_pdf.ocr_pipeline.ocr_pdf_with_tesseract`
  - `full_auto_de_pdf.benchmark.calculate_accuracy_metrics`
  - `full_auto_de_pdf.epub.build_epub_from_ocr_file`
  - `full_auto_de_pdf.benchmark_corpus` for the manifest parser

## Conventions

- **Linter**: `pylint --rcfile=pyproject.toml src/ocr_arena/` — keep score ≥ 9.90/10.
- **Tests**: `pytest tests/`. The full-pipeline smoke test takes ~30s
  (warm cache) and polls a single-page book end-to-end. Skip it on
  hosts that don't have the bundled benchmark corpus.
- **Run state**: persists to `runs/<id>/state.json` (atomic write via
  `<id>.json.tmp` + rename). Don't change the file format without
  bumping the schema version.
- **Frontend**: vanilla JS in `static/app.js` and `static/app.css`. No
  build step. Polls `GET /api/runs/<id>` every 700 ms.
- **No data duplication**: never copy the benchmark corpus into this
  project. Always reference it via the manifest in
  `active/dev-tools/full-auto-de-pdf/data/benchmark-corpus-v3/`.

## Adding a new book

You don't need to touch this project. The book list is read at startup
from the corpus manifest; add the book to
`active/dev-tools/full-auto-de-pdf/data/benchmark-corpus-v3/manifest.json`
and restart the server.

## Touch points if upstream changes

- `full_auto_de_pdf.benchmark.calculate_accuracy_metrics` is called in
  `_run_pipeline`. If the return-dict keys change, update the field
  mapping in `RunState.metrics`.
- `full_auto_de_pdf.ocr_pipeline.ocr_pdf_with_tesseract` is called with
  the demo's "fast" preset (`apply_cleanup=True,
  verify_cleanup_spans=False`). If a new kwarg becomes required, plumb
  it through here and document it in the demo preset.
- `full_auto_de_pdf.epub.build_epub_from_ocr_file` is called with
  `language="en"`. If more metadata is exposed (e.g. author), add it
  to the book manifest schema and pass it through.
