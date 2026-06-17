"""Persistent on-disk cache for OCR results.

The OCR pipeline runs Tesseract (and optionally PaddleOCR) per
candidate. Each call costs several seconds per page, and the
results are fully deterministic for a given input image. Caching
the OCR text to disk keyed by a content hash of the input image
lets re-runs (e.g. after a flag tweak or a cleanup-only change)
skip the expensive OCR step entirely.

The cache is keyed by:
- a content hash of the input image bytes (sha256, 16 hex chars)
- the preprocess mode (e.g. ``none``, ``basic``, ``scan``)
- the OCR engine (``tesseract`` or ``paddleocr``)
- the Tesseract PSM (only relevant for ``tesseract``)
- the Tesseract output format (``text`` or ``hocr``)

A cache hit returns the previously stored OCR text and metadata
without invoking the OCR engine. A cache miss invokes the OCR
engine and stores the result for next time.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass
class CacheStats:
    """Process-local counters for cache hit/miss telemetry.

    Each counter is incremented at the point of the check so the
    numbers are accurate even if the caller does not inspect the
    return values of the cache wrappers. Reset with
    ``reset_cache_stats()``.
    """

    ocr_calls: int = 0
    ocr_hits: int = 0
    inverse_render_calls: int = 0
    inverse_render_hits: int = 0
    inverse_render_disk_hits: int = 0

    def reset(self) -> None:
        self.ocr_calls = 0
        self.ocr_hits = 0
        self.inverse_render_calls = 0
        self.inverse_render_hits = 0
        self.inverse_render_disk_hits = 0


_CACHE_STATS = CacheStats()


def get_cache_stats() -> CacheStats:
    """Return a snapshot of the current cache hit/miss counters."""
    return CacheStats(
        ocr_calls=_CACHE_STATS.ocr_calls,
        ocr_hits=_CACHE_STATS.ocr_hits,
        inverse_render_calls=_CACHE_STATS.inverse_render_calls,
        inverse_render_hits=_CACHE_STATS.inverse_render_hits,
        inverse_render_disk_hits=_CACHE_STATS.inverse_render_disk_hits,
    )


def reset_cache_stats() -> None:
    """Zero out all cache hit/miss counters."""
    _CACHE_STATS.reset()


def hash_image_file(path: Path) -> str:
    """Return a short content hash of the image file at ``path``.

    Uses ``hashlib.sha256`` over the full file contents. The hash
    is 16 hex characters (64 bits) which is more than enough to
    avoid collisions for the benchmark corpus sizes.
    """
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def ocr_cache_key(
    image_hash: str,
    preprocess_mode: str,
    ocr_engine: str,
    tesseract_psm: str,
    tesseract_output_format: str,
) -> str:
    """Build the cache subdirectory name for an OCR candidate."""
    # Use a deterministic, filesystem-safe key. The components are
    # all short and ASCII-safe so no escaping is needed.
    return f"{image_hash}__{preprocess_mode}__{ocr_engine}__{tesseract_psm}__{tesseract_output_format}"


def load_ocr_cache(
    cache_dir: Path,
    image_hash: str,
    preprocess_mode: str,
    ocr_engine: str,
    tesseract_psm: str,
    tesseract_output_format: str,
) -> tuple[str, dict[str, Any]] | None:
    """Return a cached OCR result for the given candidate, or None.

    The cache directory layout is::

        cache_dir/
            <key>/
                text.txt       - the OCR text
                metadata.json  - the OCR metadata dict

    Returns ``None`` when the cache is missing, malformed, or the
    key does not match.
    """
    if cache_dir is None:
        return None
    key = ocr_cache_key(
        image_hash,
        preprocess_mode,
        ocr_engine,
        tesseract_psm,
        tesseract_output_format,
    )
    candidate_dir = cache_dir / key
    text_path = candidate_dir / "text.txt"
    metadata_path = candidate_dir / "metadata.json"
    if not text_path.exists() or not metadata_path.exists():
        return None
    try:
        text = text_path.read_text(encoding="utf-8")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(metadata, dict):
        return None
    return text, metadata


def save_ocr_cache(
    cache_dir: Path,
    image_hash: str,
    preprocess_mode: str,
    ocr_engine: str,
    tesseract_psm: str,
    tesseract_output_format: str,
    text: str,
    metadata: dict[str, Any],
) -> None:
    """Persist an OCR result to the cache."""
    if cache_dir is None:
        return
    key = ocr_cache_key(
        image_hash,
        preprocess_mode,
        ocr_engine,
        tesseract_psm,
        tesseract_output_format,
    )
    candidate_dir = cache_dir / key
    candidate_dir.mkdir(parents=True, exist_ok=True)
    (candidate_dir / "text.txt").write_text(text, encoding="utf-8")
    (candidate_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def run_with_ocr_cache(
    cache_dir: Path | None,
    image_hash: str,
    preprocess_mode: str,
    ocr_engine: str,
    tesseract_psm: str,
    tesseract_output_format: str,
    runner: Callable[[], tuple[str, dict[str, Any]]],
) -> tuple[str, dict[str, Any], bool]:
    """Run ``runner`` with on-disk caching.

    Returns a 3-tuple of ``(text, metadata, cache_hit)`` where
    ``cache_hit`` is True when the result was loaded from the
    cache and False when ``runner`` was invoked.
    """
    _CACHE_STATS.ocr_calls += 1
    if cache_dir is not None:
        cached = load_ocr_cache(
            cache_dir,
            image_hash,
            preprocess_mode,
            ocr_engine,
            tesseract_psm,
            tesseract_output_format,
        )
        if cached is not None:
            _CACHE_STATS.ocr_hits += 1
            return cached[0], cached[1], True
    text, metadata = runner()
    if cache_dir is not None:
        save_ocr_cache(
            cache_dir,
            image_hash,
            preprocess_mode,
            ocr_engine,
            tesseract_psm,
            tesseract_output_format,
            text,
            metadata,
        )
    return text, metadata, False


def inverse_render_cache_key(
    image_hash: str,
    text: str,
    bbox: tuple[int, int, int, int],
) -> str:
    """Build the cache subdirectory name for an inverse-render score."""
    safe_text = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return f"{image_hash}__{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}__{safe_text}"


def load_inverse_render_cache(
    cache_dir: Path | None,
    image_hash: str,
    text: str,
    bbox: tuple[int, int, int, int],
) -> tuple[float, dict[str, Any]] | None:
    """Return a cached inverse-render score for the given input, or None.

    The cache stores a JSON file with the score and metadata for
    each (image_hash, text, bbox) triple. The text is hashed to
    keep the cache directory names short and filesystem-safe.
    """
    if cache_dir is None:
        return None
    key = inverse_render_cache_key(image_hash, text, bbox)
    candidate_path = cache_dir / "inverse_render" / f"{key}.json"
    if not candidate_path.exists():
        return None
    try:
        payload = json.loads(candidate_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    score = payload.get("score")
    metadata = payload.get("metadata")
    if not isinstance(score, (int, float)) or not isinstance(metadata, dict):
        return None
    return float(score), metadata


def save_inverse_render_cache(
    cache_dir: Path | None,
    image_hash: str,
    text: str,
    bbox: tuple[int, int, int, int],
    score: float,
    metadata: dict[str, Any],
) -> None:
    """Persist an inverse-render score to the cache."""
    if cache_dir is None:
        return
    key = inverse_render_cache_key(image_hash, text, bbox)
    candidate_path = cache_dir / "inverse_render" / f"{key}.json"
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"score": score, "metadata": metadata}
    candidate_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
