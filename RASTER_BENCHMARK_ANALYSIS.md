# Raster Benchmark Unblocking - Implementation Reference

## Project: full-auto-de-pdf
**Location:** `/tmp/full-auto-de-pdf-raster-worktree/active/dev-tools/full-auto-de-pdf`

---

## 1. BUILD-IMAGE-TEXT-CORPUS: Input Reading & Manifest Writing

### Function: `build_image_text_corpus_manifest()`
**File:** `/tmp/full-auto-de-pdf-raster-worktree/active/dev-tools/full-auto-de-pdf/src/full_auto_de_pdf/benchmark_corpus.py`
**Lines:** 526–579

**Signature:**
```python
def build_image_text_corpus_manifest(
    output_manifest_path: Path,
    images_dir: Path,
    texts_dir: Path,
    *,
    image_glob: str = "**/*.tif*",
    text_glob: str = "**/*.txt",
    limit: int | None = None,
    title_prefix: str = "Ground Truth Page",
) -> dict[str, Any]:
```

**Key Operations:**
- **Lines 538–539**: Indexes image and text files by stem using `_index_paths_by_stem()` (line 518–523)
  - Returns `dict[stem, Path]` for images and texts
  - Uses glob patterns to find files
- **Lines 540**: Finds shared identifiers (stems matching in both directories)
- **Lines 541–542**: Optionally applies a limit
- **Lines 544**: Raises `ValueError` if no pairs found
- **Lines 546–559**: Iterates over identifiers, reads text files with `reference_text_path.read_text(encoding="utf-8")`
- **Lines 561–573**: Constructs manifest dict with structure:
  - `corpus_type: "local-image-text-groundtruth"`
  - `description`: hardcoded text (line 563–565)
  - `book_count, images_dir, texts_dir, image_glob, text_glob`
  - `books[]` array with entries containing:
    - `identifier, title, reference_text_path, page_image_paths, page_count, reference_word_count`
- **Lines 574–578**: Creates output directory and writes manifest to JSON

**Current Validation Behavior:**
- ✓ Checks image/text exist in directories (via glob)
- ✓ Validates matching stem pairs found
- **No image readability/corruption checks** – images are only indexed as paths, never loaded/opened

### CLI Entry Point: `_add_build_image_text_corpus_command()`
**File:** cli.py, Lines 253–285
- Registers `build-image-text-corpus` subcommand
- Arguments: `--output-manifest, --images-dir, --texts-dir, --image-glob, --text-glob, --limit, --title-prefix`

### CLI Handler: `_handle_build_image_text_corpus()`
**File:** cli.py, Lines 692–703
- Calls `build_image_text_corpus_manifest()` and prints result summary

---

## 2. OCR Entry Points & Raster Processing

### Function: `ocr_page_images()`
**File:** `/tmp/full-auto-de-pdf-raster-worktree/active/dev-tools/full-auto-de-pdf/src/full_auto_de_pdf/ocr_pipeline.py`
**Lines:** 1312–1337

**Signature:**
```python
def ocr_page_images(
    page_images: list[Path],
    output_text_path: Path,
    work_dir: Path,
    **kwargs: Any,
) -> dict[str, object]:
```

**Validation:**
- **Line 1324**: `_validate_page_image_run_options(page_images, options, dependencies.which)`
  - Located at lines 640–650
  - Checks images list is non-empty
  - Validates all paths exist via `path.exists()`
  - **Does NOT validate image file format or readability**

**Image Processing Chain:**
- **Line 1326–1331**: Calls `_collect_page_ocr_results()` (lines 1196–1240)
  - Iterates over each image path
  - For each image, calls `_run_ocr_on_page()` (lines 1077–1146)
    - **Lines 1088–1095**: Calls `_prepare_ocr_input_path()` (lines 701–724)
      - For non-"none" preprocess modes, calls `dependencies.preprocess_image()`
      - This is the first place images are actually **opened**

### Function: `_preprocess_image()` (Image Loading Point)
**File:** ocr_pipeline.py, Lines 397–429

**Signature:**
```python
def _preprocess_image(
    input_path: Path,
    output_path: Path,
    *args: Any,
) -> None:
```

**Image Opening:**
- **Line 410**: `with Image.open(input_path) as image:`
  - **⚠️ FIRST image file load/decode happens here**
  - Wrapped in context manager but **NO try-except for PIL.UnidentifiedImageError or file corruption**
  - If image is corrupt, PIL will raise exception and crash the entire OCR run

**Processing Steps:**
- Lines 411–419: Convert to grayscale, auto-contrast, median denoise
- Lines 420–427: Apply preprocessing mode (deskew, dewarp, binarize)
- Line 429: Save output image

**Other Image Loading in ocr_pipeline.py:**
- **Line 809** in `_normalize_scan_for_inverse_render()`: Another `Image.open()` (no try-except)
- **Lines 410, 809**: Both unprotected image opens

### Function: `ocr_pdf_with_tesseract()`
**File:** ocr_pipeline.py, Lines 1278–1310
- Takes PDF path, rasterizes via `pdftoppm` (lines 653–677)
- Produces PNG images, then calls `ocr_page_images()`
- **PDF rasterization errors caught implicitly by pdftoppm failure**

### CLI Command: `benchmark-corpus`
**File:** cli.py, Lines 178–250 (subcommand), 706–730 (handler)
- Reads corpus manifest
- Calls `run_benchmark_corpus()` (benchmark_corpus.py, lines 582–669)
  - Iterates books, checks for `page_image_paths`
  - If present, calls `ocr_page_images()` ← **Image validation/loading happens here**
  - If absent, falls back to PDF-based processing

---

## 3. Existing Tests Covering Relevant Components

### Test: build_image_text_corpus_manifest
**File:** `/tmp/full-auto-de-pdf-raster-worktree/active/dev-tools/full-auto-de-pdf/tests/test_benchmark_corpus.py`
**Line:** 223–241
**Test Name:** `test_build_image_text_corpus_manifest_pairs_matching_stems`
- Creates fake TIFF and TXT files (no real image data)
- Verifies manifest structure and stem matching
- **Does NOT test corrupt image handling**

### Test: benchmark_corpus with images
**File:** test_benchmark_corpus.py, Lines 243–280
**Test Name:** `test_run_benchmark_corpus_supports_image_only_manifest`
- Creates fake image file (raw bytes `b"fake-image"`)
- Mocks `ocr_page_images()` to return dummy metrics
- **Real image loading never happens**

### CLI Tests
**File:** test_cli.py
- **Line 167–201** `test_build_image_text_corpus_command_writes_manifest`: Mocks the underlying function
- **Line 120–166** `test_benchmark_corpus_command_runs_pipeline`: Mocks OCR functions

### OCR Pipeline Tests (ocr_page_images)
**File:** test_ocr_pipeline.py
- **Line 293–377** `test_ocr_page_images_auto_can_use_inverse_render_tiebreak`
- **Line 463–535** `test_ocr_page_images_inverse_render_reranks_candidates`
- **Line 536–609** `test_ocr_page_images_inverse_render_can_select_cleaned_variant`
- **Line 749–776** `test_ocr_page_images_runs_without_pdftoppm`
  - Creates real PNG test images via PIL
  - Actually calls `ocr_page_images()` with real image paths
  - **Tests do create valid PNGs – would fail if images were corrupt**

---

## 4. Benchmark Report Metadata with "Synthetic" Labels

### Location: `run_benchmark_corpus()` Report Generation
**File:** benchmark_corpus.py, Lines 582–669

**Report Structure (lines 657–666):**
```python
report = {
    "corpus_manifest_path": str(corpus_manifest_path),
    "metric_note": (
        "This benchmark uses synthetic printed PDFs rendered from clean public-domain "
        "reference text. It is useful for measuring OCR engine and cleanup quality on "
        "clean printed pages, but it is easier than real scanned-book evaluation."
    ),  # ← Line 659–663: SYNTHETIC LABEL
    "books": results,
    "summary": summary,
}
```

**Key Finding:**
- The `metric_note` field (lines 659–663) explicitly labels corpora as **"synthetic printed PDFs"**
- This note is hardcoded for ALL benchmarks from `run_benchmark_corpus()`
- **Does NOT differentiate between synthetic and real image/text corpora**

### Another Synthetic Label
**File:** benchmark_corpus.py, Line 427
- Function docstring: `"""Build a local synthetic printed-text OCR benchmark corpus."""`

### Generated Benchmark Corpus Metadata
**File:** benchmark_corpus.py, Lines 481–511 (build_benchmark_corpus)
- Manifest includes:
  - `corpus_type: "generated-public-domain-printed-text"` (line 482)
  - `description: "Synthetic printed-text benchmark corpus..."` (lines 483–485)
  - `artifact_profiles` list (line 488): tracks profiles like "clean", "scan-heavy"
  - Per-book `artifact_profile` field (line 503)

### Local Image/Text Manifest Label
**File:** benchmark_corpus.py, Lines 561–566 (build_image_text_corpus_manifest)
- Manifest includes:
  - `corpus_type: "local-image-text-groundtruth"` (line 562)
  - `description: "Image/text OCR corpus manifest built from existing local page images..."` (lines 563–565)
  - **This correctly identifies real images, but `run_benchmark_corpus()` generic report still uses synthetic label**

---

## 5. Recommended Minimal File Edits for Raster Unblocking

### Issue Analysis
**Problem:** Corrupt/unreadable images in manifests can crash OCR pipeline at image-open time without clear diagnostics.

### Scope: Defensive Image Validation Only

#### Edit 1: Add Image Validation to `build_image_text_corpus_manifest()`
**File:** `benchmark_corpus.py`, after line 549 (inside loop)

**Purpose:** Quick PIL open test during manifest building to surface corrupt images early
**Lines to add after 549:**
```python
        # Quick validation that image is readable
        try:
            with Image.open(image_paths[identifier]) as img:
                img.load()  # Force decode to catch format errors early
        except Exception as e:
            raise ValueError(
                f"Image file unreadable or corrupt at {image_paths[identifier]}: {e}"
            ) from e
```

#### Edit 2: Add Defensive Try-Except in `_preprocess_image()`
**File:** `ocr_pipeline.py`, wrap lines 410–429

**Purpose:** Catch corrupt images during actual OCR run, emit diagnostic error
**Replace line 410–429 with:**
```python
    try:
        with Image.open(input_path) as image:
            gray = image.convert("L")
            if _uses_scan_preprocess_stack(preprocess_mode):
                contrasted = ImageOps.autocontrast(gray)
                denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
                ocr_ready = _upsample_for_ocr(denoised, scale_factor=3)
            else:
                contrasted = ImageOps.autocontrast(gray)
                denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
                ocr_ready = _upsample_for_ocr(denoised)
            candidate = _preprocess_candidate(
                ocr_ready,
                preprocess_mode,
                deskew_max_angle,
                deskew_angle_step,
                binarize_threshold,
            )
            binarized = _binarize_preprocessed_candidate(candidate, preprocess_mode, binarize_threshold)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            binarized.save(output_path)
    except Exception as e:
        raise RuntimeError(
            f"Failed to preprocess image {input_path} with mode '{preprocess_mode}': {e}"
        ) from e
```

#### Edit 3: Fix Inverse Render Image Opening
**File:** `ocr_pipeline.py`, line 809 in `_normalize_scan_for_inverse_render()`

**Purpose:** Same defensive handling as Edit 2
**Replace lines 809–815 with try-except:**
```python
    try:
        with Image.open(image_path) as image:
            gray = image.convert("L")
            contrasted = ImageOps.autocontrast(gray)
            denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
            inverted = ImageOps.invert(_threshold_image(denoised, 127))
            binary = inverted.point(lambda p: 0 if p > 127 else 255)
    except Exception as e:
        raise RuntimeError(
            f"Failed to normalize scan image {image_path} for inverse render: {e}"
        ) from e
```

#### Edit 4: Update Report Metadata for Real Image Corpora
**File:** `benchmark_corpus.py`, lines 657–666 in `run_benchmark_corpus()`

**Purpose:** Differentiate synthetic vs. real image corpora in report notes
**Replace metric_note generation (lines 659–663):**
```python
    corpus_type = payload.get("corpus_type", "unknown")
    is_synthetic = "generated" in corpus_type.lower() or "synthetic" in corpus_type.lower()
    if is_synthetic:
        metric_note = (
            "This benchmark uses synthetic printed PDFs rendered from clean public-domain "
            "reference text. It is useful for measuring OCR engine and cleanup quality on "
            "clean printed pages, but it is easier than real scanned-book evaluation."
        )
    else:
        metric_note = (
            "This benchmark uses real OCR inputs from local page images and ground-truth text "
            "transcriptions. Results reflect actual OCR engine performance on provided materials."
        )
    report = {
        "corpus_manifest_path": str(corpus_manifest_path),
        "metric_note": metric_note,
        "books": results,
        "summary": summary,
    }
```

---

## 6. Test Commands for Validation

### Run Full Test Suite
```bash
cd /tmp/full-auto-de-pdf-raster-worktree/active/dev-tools/full-auto-de-pdf
pip install -e ".[dev]"
pytest tests/ -v
```

### Run Specific Relevant Tests
```bash
# Image/text corpus manifest tests
pytest tests/test_benchmark_corpus.py::test_build_image_text_corpus_manifest_pairs_matching_stems -v

# Image-based OCR tests
pytest tests/test_benchmark_corpus.py::test_run_benchmark_corpus_supports_image_only_manifest -v
pytest tests/test_ocr_pipeline.py::test_ocr_page_images_runs_without_pdftoppm -v

# CLI integration tests
pytest tests/test_cli.py::test_build_image_text_corpus_command_writes_manifest -v
pytest tests/test_cli.py::test_benchmark_corpus_command_runs_pipeline -v
```

### Test Corrupt Image Handling (after edits)
```bash
# Create a test that sends corrupt image to ocr_page_images()
# Example: pytest tests/test_ocr_pipeline.py -k corrupt -v
# (Would require adding new test after edits)
```

---

## 7. File Structure Summary

### Core Source Files
- `src/full_auto_de_pdf/benchmark_corpus.py` – Manifest building and corpus benchmarking
  - `build_image_text_corpus_manifest()` [526–579] – Image/text pair indexing
  - `build_benchmark_corpus()` [410–511] – Synthetic PDF corpus generation
  - `run_benchmark_corpus()` [582–669] – OCR evaluation against manifest
  - `_index_paths_by_stem()` [518–523] – Path indexing helper
  
- `src/full_auto_de_pdf/ocr_pipeline.py` – OCR orchestration
  - `ocr_page_images()` [1312–1337] – Main entry point for image-list OCR
  - `_preprocess_image()` [397–429] – **First real image load point** ⚠️
  - `_run_ocr_on_page()` [1077–1146] – Per-page OCR orchestration
  - `_prepare_ocr_input_path()` [701–724] – Image preprocessing dispatcher
  - `_normalize_scan_for_inverse_render()` [803–824] – **Second image load point** ⚠️
  - `_collect_page_ocr_results()` [1196–1240] – Multi-page aggregation

- `src/full_auto_de_pdf/cli.py` – Command-line interface
  - `_add_build_image_text_corpus_command()` [253–285] – CLI registration
  - `_handle_build_image_text_corpus()` [692–703] – CLI handler
  - `_add_benchmark_corpus_command()` [178–250] – Benchmark runner CLI
  - `_handle_benchmark_corpus()` [706–730] – Benchmark handler

### Test Files
- `tests/test_benchmark_corpus.py`
  - `test_build_image_text_corpus_manifest_pairs_matching_stems` [223–241]
  - `test_run_benchmark_corpus_supports_image_only_manifest` [243–280]
  
- `tests/test_ocr_pipeline.py`
  - `test_ocr_page_images_*` (multiple tests with real PNG creation)
  - `test_ocr_page_images_runs_without_pdftoppm` [749–776]
  
- `tests/test_cli.py`
  - `test_build_image_text_corpus_command_writes_manifest` [167–201]
  - `test_benchmark_corpus_command_runs_pipeline` [120–166]

---

## 8. Summary Table

| Component | File | Lines | Current Validation | Gap |
|-----------|------|-------|-------------------|-----|
| Image input reading | benchmark_corpus.py | 538–539 | Glob exists check | No image readability test |
| Manifest writing | benchmark_corpus.py | 574–578 | Path write check | N/A – read-time is the issue |
| Image validation | ocr_pipeline.py | 640–650 | File exists check | No PIL format/readability check |
| Image opening (preprocess) | ocr_pipeline.py | 410 | None ⚠️ | Unprotected PIL.open() |
| Image opening (inverse render) | ocr_pipeline.py | 809 | None ⚠️ | Unprotected PIL.open() |
| Report metadata | benchmark_corpus.py | 659–663 | Hardcoded "synthetic" | Doesn't check corpus_type |
| Tests (manifest) | test_benchmark_corpus.py | 223–241 | Fake image bytes | No real image validation |
| Tests (OCR images) | test_ocr_pipeline.py | 749–776 | Real valid PNGs | No corrupt image test |

