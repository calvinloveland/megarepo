import json

import pytest

import full_auto_de_pdf.benchmark as benchmark_module
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


def test_benchmark_download_and_filename_helpers(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self) -> bytes:
            return self._payload

    monkeypatch.setattr(
        benchmark_module,
        "urlopen",
        lambda url, timeout=60: _FakeResponse(f"{url}|{timeout}".encode("utf-8")),
    )
    assert benchmark_module._download_text("https://example.com/test", timeout_seconds=3) == (
        "https://example.com/test|3"
    )
    assert benchmark_module._download_bytes("https://example.com/raw", timeout_seconds=4) == (
        b"https://example.com/raw|4"
    )

    assert benchmark_module._extract_filename_by_suffix({}, ".txt", required=False) is None
    with pytest.raises(ValueError, match="files list"):
        benchmark_module._extract_filename_by_suffix({}, ".txt", required=True)
    metadata = {
        "files": [
            "bad",
            {"name": "book_scan_DJVU.TXT"},
            {"name": "book_djvu.txt"},
            {"name": "book_longer_djvu.txt"},
            {"name": "book_abbyy.gz"},
        ]
    }
    assert benchmark_module._extract_filename_by_suffix(metadata, "_djvu.txt", required=True) == (
        "book_djvu.txt"
    )
    assert benchmark_module._extract_archive_abbyy_filename(metadata) == "book_abbyy.gz"
    with pytest.raises(ValueError, match="_missing.gz"):
        benchmark_module._extract_filename_by_suffix(metadata, "_missing.gz", required=True)

    monkeypatch.setattr(benchmark_module, "_extract_filename_by_suffix", lambda *args, **kwargs: None)
    with pytest.raises(ValueError, match="_djvu.txt"):
        benchmark_module._extract_archive_djvu_filename({"files": []})


def test_benchmark_fetch_helpers(monkeypatch) -> None:
    monkeypatch.setattr(
        benchmark_module,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {
            "files": [
                {"name": f"{identifier}_djvu.txt"},
                {"name": f"{identifier}_abbyy.gz"},
            ]
        },
    )
    monkeypatch.setattr(
        benchmark_module,
        "_download_text",
        lambda url, timeout_seconds=60: f"text:{url}:{timeout_seconds}",
    )
    monkeypatch.setattr(
        benchmark_module,
        "_download_bytes",
        lambda url, timeout_seconds=60: benchmark_module.gzip.compress(
            b"<doc><line><charParams>A</charParams></line></doc>"
        ),
    )
    assert benchmark_module.fetch_archive_ocr_text("demo", timeout_seconds=7) == (
        "text:https://archive.org/download/demo/demo_djvu.txt:7"
    )
    assert benchmark_module.fetch_gutenberg_text(42, timeout_seconds=8) == (
        "text:https://www.gutenberg.org/cache/epub/42/pg42.txt:8"
    )
    assert benchmark_module.fetch_archive_abbyy_text("demo", timeout_seconds=9) == "A"

    monkeypatch.setattr(
        benchmark_module,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {"files": []},
    )
    assert benchmark_module.fetch_archive_abbyy_text("demo") is None


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


def test_benchmark_alignment_and_sampling_helpers(monkeypatch) -> None:
    assert benchmark_module._local_name("{ns}line") == "line"
    assert benchmark_module._local_name("line") == "line"
    assert benchmark_module._find_gutenberg_start(["header"]) == 0
    assert benchmark_module._find_gutenberg_end(["footer"]) == 1

    hypothesis_index = benchmark_module._build_hypothesis_index(["alpha", "beta", "alpha", "beta"], 2)
    assert hypothesis_index[("alpha", "beta")] == 0
    assert benchmark_module._find_start_anchor(["gamma", "delta"], {}, 2, 10) is None
    assert benchmark_module._find_end_anchor(["gamma", "delta"], {}, 2, 10) is None
    assert benchmark_module._alignment_is_valid(None, (1, 2), 1) is False
    assert benchmark_module._alignment_is_valid((2, 2), (2, 3), 1) is False
    assert benchmark_module._alignment_is_valid((0, 0), (1, 1), 2) is False
    assert benchmark_module._alignment_is_valid((0, 0), (3, 3), 2) is True
    assert benchmark_module._aligned_text_slices(
        ["one", "two", "three"],
        ["uno", "dos", "tres"],
        (1, 0),
        (3, 2),
    ) == ("two three", "uno dos")

    aligned = benchmark_module._align_text_by_shared_ngrams(
        "alpha beta gamma delta",
        "alpha beta gamma delta",
        ngram_size=2,
        window_words=10,
        min_aligned_words=2,
    )
    assert aligned == ("alpha beta gamma delta", "alpha beta gamma delta", True)
    assert benchmark_module._align_text_by_shared_ngrams("short words", "other", ngram_size=5) == (
        "short words",
        "other",
        False,
    )
    monkeypatch.setattr(benchmark_module, "_find_start_anchor", lambda *args, **kwargs: None)
    monkeypatch.setattr(benchmark_module, "_find_end_anchor", lambda *args, **kwargs: (2, 2))
    monkeypatch.setattr(benchmark_module, "_alignment_is_valid", lambda *args, **kwargs: True)
    assert benchmark_module._align_text_by_shared_ngrams(
        "alpha beta gamma",
        "alpha beta gamma",
        ngram_size=2,
        min_aligned_words=1,
    ) == ("alpha beta gamma", "alpha beta gamma", False)
    monkeypatch.setattr(benchmark_module, "_find_start_anchor", lambda *args, **kwargs: (0, 0))
    monkeypatch.setattr(benchmark_module, "_find_end_anchor", lambda *args, **kwargs: (2, 2))
    monkeypatch.setattr(benchmark_module, "_alignment_is_valid", lambda *args, **kwargs: False)
    assert benchmark_module._align_text_by_shared_ngrams(
        "alpha beta gamma",
        "alpha beta gamma",
        ngram_size=2,
        min_aligned_words=1,
    ) == ("alpha beta gamma", "alpha beta gamma", False)

    assert benchmark_module._sample_text_edges("abc", 5) == "abc"
    assert benchmark_module._sample_text_edges("abcdef", 4) == "abef"
    assert benchmark_module._sample_list_edges(["a", "b"], 4) == ["a", "b"]
    assert benchmark_module._sample_list_edges(["a", "b", "c", "d", "e"], 4) == ["a", "b", "d", "e"]
    assert benchmark_module._safe_ratio(1, 0) == 0.0


def test_benchmark_parallel_row_helpers_and_confusion_edges(monkeypatch, tmp_path) -> None:
    delete_summary = summarize_token_confusions("alpha beta", "alpha")
    insert_summary = summarize_token_confusions("alpha", "alpha beta")
    assert delete_summary["missing_tokens"][0]["token"] == "beta"
    assert insert_summary["unexpected_tokens"][0]["token"] == "beta"

    rows = [
        {"domain": "Fiction", "gid": "1"},
        {"domain": "  ", "gid": "1"},
        {"domain": "Fiction", "gid": "2"},
    ]
    assert benchmark_module._count_row_values(rows, "domain") == {"Fiction": 2}
    assert benchmark_module._unique_nonempty_values(rows, "gid") == 2

    missing_columns = tmp_path / "missing.tsv"
    missing_columns.write_text("domain\tgsent\nFiction\talpha\n", encoding="utf-8")
    with pytest.raises(ValueError, match="required columns"):
        benchmark_module._read_parallel_text_rows(
            missing_columns,
            reference_column="gsent",
            hypothesis_column="hsent",
            domains=(),
            row_limit=None,
        )

    filtered = tmp_path / "filtered.tsv"
    filtered.write_text(
        "domain\tgid\thid\tgsent\thsent\n"
        "News\t1\ta\talpha\tbeta\n"
        "Fiction\t2\tb\talpha\t \n"
        "Fiction\t3\tc\talpha\tgamma\n",
        encoding="utf-8",
    )
    assert benchmark_module._read_parallel_text_rows(
        filtered,
        reference_column="gsent",
        hypothesis_column="hsent",
        domains=("Fiction",),
        row_limit=1,
    ) == [
        {
            "domain": "Fiction",
            "gid": "3",
            "hid": "c",
            "reference_text": "alpha",
            "hypothesis_text": "gamma",
        }
    ]
    with pytest.raises(ValueError, match="did not yield any usable rows"):
        benchmark_module._read_parallel_text_rows(
            filtered,
            reference_column="gsent",
            hypothesis_column="hsent",
            domains=("Poetry",),
            row_limit=None,
        )

    class _FakeDictReader:
        fieldnames = ("domain", "gsent", "hsent", "gid", "hid")

        def __iter__(self):
            yield "bad-row"
            yield {"domain": "Fiction", "gid": "4", "hid": "d", "gsent": "left", "hsent": "right"}

    monkeypatch.setattr(benchmark_module.csv, "DictReader", lambda *args, **kwargs: _FakeDictReader())
    fake_path = tmp_path / "fake.tsv"
    fake_path.write_text("irrelevant", encoding="utf-8")
    assert benchmark_module._read_parallel_text_rows(
        fake_path,
        reference_column="gsent",
        hypothesis_column="hsent",
        domains=(),
        row_limit=None,
    )[0]["gid"] == "4"

    class _ReplaceDeletesMatcher:
        def __init__(self, *args, **kwargs) -> None:
            return None

        def get_opcodes(self):
            return [("replace", 0, 1, 0, 0)]

    class _ReplaceInsertsMatcher:
        def __init__(self, *args, **kwargs) -> None:
            return None

        def get_opcodes(self):
            return [("replace", 0, 0, 0, 1)]

    monkeypatch.setattr(benchmark_module, "SequenceMatcher", _ReplaceDeletesMatcher)
    replace_delete_summary = summarize_token_confusions("alpha", "")
    assert replace_delete_summary["missing_tokens"][0]["token"] == "alpha"
    monkeypatch.setattr(benchmark_module, "SequenceMatcher", _ReplaceInsertsMatcher)
    replace_insert_summary = summarize_token_confusions("", "beta")
    assert replace_insert_summary["unexpected_tokens"][0]["token"] == "beta"


def test_benchmark_archive_helpers_and_guardrails(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(benchmark_module, "fetch_archive_ocr_text", lambda identifier, timeout_seconds=60: "djvu")
    monkeypatch.setattr(benchmark_module, "fetch_archive_abbyy_text", lambda identifier, timeout_seconds=60: "abbyy")
    monkeypatch.setattr(benchmark_module, "fetch_gutenberg_text", lambda gutenberg_id, timeout_seconds=60: "gutenberg")
    book = BenchmarkBook("demo", "Demo", 7)
    assert benchmark_module._fetch_djvu_text(book, 1) == "djvu"
    assert benchmark_module._fetch_abbyy_text(book, 1) == "abbyy"
    assert benchmark_module._fetch_gutenberg(book, 1) == "gutenberg"

    metrics = {"djvu": {"wer": 0.2, "cer": 0.2, "alignment_applied": False}}
    with pytest.raises(ValueError, match="no ABBYY OCR"):
        benchmark_module._select_source_metrics("abbyy", metrics, "demo")
    assert benchmark_module._select_source_metrics("other", metrics, "demo")[0] == "djvu"
    abbyy_metrics = {
        "djvu": {"wer": 0.2, "cer": 0.2, "alignment_applied": False},
        "abbyy": {"wer": 0.1, "cer": 0.1, "alignment_applied": True},
    }
    assert benchmark_module._select_source_metrics("abbyy", abbyy_metrics, "demo")[0] == "abbyy"

    with pytest.raises(ValueError, match="source_mode must be one of"):
        run_archive_benchmark(cache_dir=tmp_path, books=(), source_mode="nope")

    assert benchmark_module._average_metric([{"wer": 0.2}, {"wer": 0.4}], "wer") == pytest.approx(0.3)
    assert benchmark_module._count_selected_sources(
        [{"selected_source": "djvu"}, {"selected_source": "abbyy"}, {"selected_source": "djvu"}]
    ) == {"djvu": 2, "abbyy": 1}
    summary = benchmark_module._build_summary(
        [
            {"selected_source": "djvu", "cer": 0.1, "wer": 0.2, "raw_cer": 0.3, "raw_wer": 0.4},
            {"selected_source": "abbyy", "cer": 0.3, "wer": 0.4, "raw_cer": 0.5, "raw_wer": 0.6},
        ],
        "best",
    )
    assert summary["source_mode"] == "best"
    empty_guardrails = benchmark_module._evaluate_archive_guardrails(
        {"avg_word_accuracy": 1.0, "avg_wer": 0.0},
        [],
        max_book_wer=0.2,
        min_avg_word_accuracy=None,
        max_avg_wer=None,
    )
    assert empty_guardrails["checks"][0]["observed"] == 0.0
