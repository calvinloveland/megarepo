"""Tests for the on-disk OCR result cache."""

from __future__ import annotations

from pathlib import Path

from full_auto_de_pdf.ocr_cache import (
    get_cache_stats,
    hash_image_file,
    load_ocr_cache,
    ocr_cache_key,
    reset_cache_stats,
    run_with_ocr_cache,
    save_ocr_cache,
)


def _write_image(path: Path, content: bytes = b"fake-image-bytes") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def test_hash_image_file_changes_with_content(tmp_path: Path) -> None:
    image_a = tmp_path / "a.png"
    image_b = tmp_path / "b.png"
    image_c = tmp_path / "c.png"
    _write_image(image_a, b"alpha")
    _write_image(image_b, b"beta")
    _write_image(image_c, b"alpha")
    assert hash_image_file(image_a) != hash_image_file(image_b)
    # Same bytes -> same hash.
    assert hash_image_file(image_a) == hash_image_file(image_c)


def test_ocr_cache_key_is_deterministic() -> None:
    a = ocr_cache_key("abc", "scan", "tesseract", "6", "text")
    b = ocr_cache_key("abc", "scan", "tesseract", "6", "text")
    assert a == b
    # Different inputs -> different keys.
    assert ocr_cache_key("abc", "scan", "tesseract", "6", "text") != \
        ocr_cache_key("abc", "scan", "tesseract", "3", "text")


def test_save_and_load_round_trip(tmp_path: Path) -> None:
    cache_dir = tmp_path / "cache"
    save_ocr_cache(
        cache_dir,
        "abc",
        "scan",
        "tesseract",
        "6",
        "text",
        "hello world",
        {"score": 42.0, "words": 2},
    )
    loaded = load_ocr_cache(cache_dir, "abc", "scan", "tesseract", "6", "text")
    assert loaded is not None
    text, metadata = loaded
    assert text == "hello world"
    assert metadata == {"score": 42.0, "words": 2}


def test_load_returns_none_for_missing_cache(tmp_path: Path) -> None:
    assert load_ocr_cache(tmp_path / "cache", "missing", "scan", "tesseract", "6", "text") is None


def test_run_with_ocr_cache_invokes_runner_on_miss(tmp_path: Path) -> None:
    calls = []

    def runner() -> tuple[str, dict]:
        calls.append("ran")
        return "ran-text", {"key": "value"}

    text, metadata, hit = run_with_ocr_cache(
        tmp_path / "cache",
        "img1",
        "scan",
        "tesseract",
        "6",
        "text",
        runner,
    )
    assert text == "ran-text"
    assert metadata == {"key": "value"}
    assert hit is False
    assert calls == ["ran"]


def test_run_with_ocr_cache_skips_runner_on_hit(tmp_path: Path) -> None:
    cache_dir = tmp_path / "cache"
    save_ocr_cache(cache_dir, "img1", "scan", "tesseract", "6", "text", "cached", {"k": 1})

    def runner() -> tuple[str, dict]:
        raise AssertionError("runner should not be called on cache hit")

    text, metadata, hit = run_with_ocr_cache(
        cache_dir, "img1", "scan", "tesseract", "6", "text", runner
    )
    assert text == "cached"
    assert metadata == {"k": 1}
    assert hit is True


def test_run_with_ocr_cache_no_cache_dir_always_runs(tmp_path: Path) -> None:
    calls = []

    def runner() -> tuple[str, dict]:
        calls.append("ran")
        return "ok", {}

    text, metadata, hit = run_with_ocr_cache(
        None, "img1", "scan", "tesseract", "6", "text", runner
    )
    assert text == "ok"
    assert hit is False
    assert calls == ["ran"]


def test_cache_stats_track_ocr_hits_and_misses(tmp_path) -> None:
    """``get_cache_stats`` should report OCR hit/miss counts."""
    reset_cache_stats()
    assert get_cache_stats().ocr_calls == 0

    def runner() -> tuple[str, dict]:
        return "ok", {}

    # First call: miss.
    run_with_ocr_cache(
        tmp_path, "stats-img", "scan", "tesseract", "6", "text", runner
    )
    # Second call: hit (same key).
    run_with_ocr_cache(
        tmp_path, "stats-img", "scan", "tesseract", "6", "text", runner
    )
    stats = get_cache_stats()
    assert stats.ocr_calls == 2
    assert stats.ocr_hits == 1

    # Reset clears the counters for the next run.
    reset_cache_stats()
    assert get_cache_stats().ocr_calls == 0
    assert get_cache_stats().ocr_hits == 0
