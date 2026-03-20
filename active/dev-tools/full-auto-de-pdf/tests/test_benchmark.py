import json

from full_auto_de_pdf.benchmark import (
    BenchmarkBook,
    calculate_accuracy_metrics,
    parse_abbyy_xml_text,
    run_archive_benchmark,
    run_parallel_text_benchmark,
    summarize_token_confusions,
    strip_gutenberg_boilerplate,
)
from full_auto_de_pdf.ocr_cleanup import cleanup_ocr_text


def test_strip_gutenberg_boilerplate() -> None:
    raw = (
        "Header line\n"
        "*** START OF THE PROJECT GUTENBERG EBOOK Demo ***\n"
        "Actual book text.\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK Demo ***\n"
        "Footer line\n"
    )
    assert strip_gutenberg_boilerplate(raw) == "Actual book text."


def test_calculate_accuracy_metrics_identical_text_is_perfect() -> None:
    metrics = calculate_accuracy_metrics("Same text here", "Same text here")
    assert metrics["cer"] == 0.0
    assert metrics["wer"] == 0.0
    assert metrics["char_accuracy"] == 1.0
    assert metrics["word_accuracy"] == 1.0
    assert metrics["char_edit_distance"] == 0
    assert metrics["word_edit_distance"] == 0


def test_summarize_token_confusions_reports_substitutions() -> None:
    summary = summarize_token_confusions("the quick brown fox", "the quick brawn fox")
    assert summary["substitutions"][0]["reference"] == "brown"
    assert summary["substitutions"][0]["hypothesis"] == "brawn"
    assert summary["substitutions"][0]["count"] == 1


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
    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark.fetch_archive_abbyy_text",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_gutenberg_text", _fail_fetch)

    report = run_archive_benchmark(cache_dir=cache_dir, books=books)
    assert report["summary"]["book_count"] == 1
    assert report["summary"]["avg_wer_proxy"] == 0.0
    assert report["summary"]["avg_cer_proxy"] == 0.0
    assert report["summary"]["avg_raw_wer_proxy"] == 0.0
    assert report["summary"]["avg_raw_cer_proxy"] == 0.0
    assert report["books"][0]["alignment_applied"] is False
    assert report["books"][0]["selected_source"] == "djvu"
    assert report["summary"]["selected_source_counts"]["djvu"] == 1


def test_benchmark_report_is_json_serializable(tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text("alpha zeta", encoding="utf-8")

    report = run_archive_benchmark(cache_dir=cache_dir, books=books)
    encoded = json.dumps(report, sort_keys=True)
    assert "avg_word_accuracy_proxy" in encoded
    assert "selected_source_counts" in encoded


def test_parse_abbyy_xml_text_extracts_line_text() -> None:
    xml_payload = (
        "<?xml version='1.0' encoding='UTF-8'?>"
        "<document xmlns='http://www.abbyy.com/FineReader_xml/FineReader10-schema-v1.xml'>"
        "<page><block><text><par>"
        "<line><formatting><charParams>H</charParams><charParams>i</charParams></formatting></line>"
        "<line><formatting><charParams>T</charParams><charParams>h</charParams><charParams>e</charParams></formatting></line>"
        "</par></text></block></page>"
        "</document>"
    )
    assert parse_abbyy_xml_text(xml_payload) == "Hi\nThe"


def test_run_archive_benchmark_source_mode_best_can_select_abbyy(tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta typo", encoding="utf-8")
    (cache_dir / "archive-id_archive_abbyy.txt").write_text("alpha beta gamma", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text("alpha beta gamma", encoding="utf-8")

    report = run_archive_benchmark(cache_dir=cache_dir, books=books, source_mode="best")
    assert report["books"][0]["selected_source"] == "abbyy"
    assert report["summary"]["selected_source_counts"]["abbyy"] == 1


def test_run_archive_benchmark_source_mode_djvu_is_strict(tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta typo", encoding="utf-8")
    (cache_dir / "archive-id_archive_abbyy.txt").write_text("alpha beta gamma", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text("alpha beta gamma", encoding="utf-8")

    report = run_archive_benchmark(cache_dir=cache_dir, books=books, source_mode="djvu")
    assert report["books"][0]["selected_source"] == "djvu"
    assert report["summary"]["selected_source_counts"]["djvu"] == 1


def test_run_archive_benchmark_emits_guardrails_when_requested(tmp_path) -> None:
    books = (BenchmarkBook("archive-id", "Title", 123),)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "archive-id_archive_djvu.txt").write_text("alpha beta typo", encoding="utf-8")
    (cache_dir / "pg123_gutenberg.txt").write_text("alpha beta gamma", encoding="utf-8")

    report = run_archive_benchmark(
        cache_dir=cache_dir,
        books=books,
        min_avg_word_accuracy=0.95,
        max_avg_wer=0.05,
        max_book_wer=0.05,
    )
    guardrails = report["guardrails"]
    assert guardrails["enabled"] is True
    assert guardrails["passed"] is False
    assert len(guardrails["checks"]) == 3


def test_run_parallel_text_benchmark_improves_split_words(tmp_path) -> None:
    corpus_path = tmp_path / "pairs.tsv"
    corpus_path.write_text(
        "domain\tgid\thid\tgsent\thsent\n"
        "Fiction\t1\ta\tThe fox jumps over the dog.\tThe foxjumps over the dog.\n"
        "Fiction\t1\ta\tReaders keep the story moving.\tReaders keepsthe story moving.\n",
        encoding="utf-8",
    )

    report = run_parallel_text_benchmark(
        corpus_path=corpus_path,
        output_report_path=tmp_path / "report.json",
    )

    assert report["summary"]["row_count"] == 2
    assert report["summary"]["cleaned_metrics"]["word_accuracy"] > report["summary"]["raw_metrics"]["word_accuracy"]


def test_run_parallel_text_benchmark_can_score_reference_lexicon_cleanup(tmp_path) -> None:
    corpus_path = tmp_path / "pairs.tsv"
    corpus_path.write_text(
        "domain\tgid\thid\tgsent\thsent\n"
        "Fiction\t1\ta\tIt contains realistic synthetic notes for readers.\tIt teontains realistcsynthetic notes for eaders.\n",
        encoding="utf-8",
    )

    report = run_parallel_text_benchmark(
        corpus_path=corpus_path,
        output_report_path=tmp_path / "report.json",
        include_reference_lexicon_cleanup=True,
    )

    assert "reference_lexicon_metrics" in report["summary"]
    assert report["summary"]["reference_lexicon_metrics"]["word_accuracy"] > report["summary"]["cleaned_metrics"]["word_accuracy"]


def test_run_parallel_text_benchmark_catches_dracula_symbol_corruption(tmp_path) -> None:
    reference = (
        "The living ring of terror encompassed them on every side, and they had "
        "perforce to remain within it. Just then a heavy cloud passed across the "
        "face of the moon, so that we were again in darkness. The driver was in "
        "the act of pulling up the horses in the courtyard of a vast ruined "
        "castle. She answered with a low laugh, and pointed to the bag on the floor."
    )
    hypothesis = (
        "| of terror encompassed them on every side, and they had perforce to "
        "remain with in it. })ust then a heavy cloud passed across the face of the "
        "moon, so that we were again in darkness. The driver was in the act of "
        "J)ulling up the horses in the courtyard of a vast ruined castle. She "
        "answered with a low lau{éh, and pointed to the ba% on the floor. | |"
    )
    corpus_path = tmp_path / "pairs.tsv"
    corpus_path.write_text(
        "domain\tgid\thid\tgsent\thsent\n"
        f"Fiction\t345\tdracu00stok\t{reference}\t{hypothesis}\n",
        encoding="utf-8",
    )

    report = run_parallel_text_benchmark(
        corpus_path=corpus_path,
        output_report_path=tmp_path / "report.json",
    )
    cleaned_hypothesis = cleanup_ocr_text(hypothesis)

    assert "})ust" in hypothesis
    assert "J)ulling" in hypothesis
    assert "lau{éh" in hypothesis
    assert "ba%" in hypothesis
    assert "Just then a heavy cloud passed across the face of the moon" in cleaned_hypothesis
    assert "the act of pulling up the horses" in cleaned_hypothesis
    assert "a low laugh, and pointed to the bag on the floor." in cleaned_hypothesis
    assert report["summary"]["cleaned_metrics"]["word_accuracy"] > report["summary"]["raw_metrics"]["word_accuracy"]
    assert report["summary"]["cleaned_metrics"]["char_accuracy"] > report["summary"]["raw_metrics"]["char_accuracy"]
