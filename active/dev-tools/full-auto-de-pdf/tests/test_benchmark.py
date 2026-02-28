import json

from full_auto_de_pdf.benchmark import (
    BenchmarkBook,
    calculate_proxy_accuracy,
    run_archive_benchmark,
    strip_gutenberg_boilerplate,
)


def test_strip_gutenberg_boilerplate() -> None:
    raw = (
        "Header line\n"
        "*** START OF THE PROJECT GUTENBERG EBOOK Demo ***\n"
        "Actual book text.\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK Demo ***\n"
        "Footer line\n"
    )
    assert strip_gutenberg_boilerplate(raw) == "Actual book text."


def test_calculate_proxy_accuracy_identical_text_is_perfect() -> None:
    metrics = calculate_proxy_accuracy("Same text here", "Same text here")
    assert metrics["cer_proxy"] == 0.0
    assert metrics["wer_proxy"] == 0.0
    assert metrics["char_accuracy_proxy"] == 1.0
    assert metrics["word_accuracy_proxy"] == 1.0


def test_run_archive_benchmark_with_cached_inputs(monkeypatch, tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta gamma", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text(
        "*** START OF THE PROJECT GUTENBERG EBOOK Demo ***\n"
        "alpha beta gamma\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK Demo ***\n",
        encoding="utf-8",
    )

    def _fail_fetch(*_args, **_kwargs):
        raise AssertionError("network fetch should not run with cached files")

    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_archive_ocr_text", _fail_fetch)
    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_gutenberg_text", _fail_fetch)

    report = run_archive_benchmark(cache_dir=cache_dir, books=books)
    assert report["summary"]["book_count"] == 1
    assert report["summary"]["avg_wer_proxy"] == 0.0
    assert report["summary"]["avg_cer_proxy"] == 0.0
    assert report["summary"]["avg_raw_wer_proxy"] == 0.0
    assert report["summary"]["avg_raw_cer_proxy"] == 0.0
    assert report["books"][0]["alignment_applied"] is False


def test_benchmark_report_is_json_serializable(tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text("alpha zeta", encoding="utf-8")

    report = run_archive_benchmark(cache_dir=cache_dir, books=books)
    encoded = json.dumps(report, sort_keys=True)
    assert "avg_word_accuracy_proxy" in encoded
