import json

from full_auto_de_pdf import cli


def test_manifest_command_writes_output(monkeypatch, tmp_path) -> None:
    output = tmp_path / "manifest.json"

    def _fake_manifest(timeout_seconds: int) -> list[dict[str, object]]:
        assert timeout_seconds == 15
        return [{"identifier": "demo-book"}]

    monkeypatch.setattr(cli, "build_manifest", _fake_manifest)
    rc = cli.main(["manifest", "--output", str(output), "--timeout-seconds", "15"])

    assert rc == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["books"][0]["identifier"] == "demo-book"


def test_build_epub_command_builds_file(tmp_path) -> None:
    ocr_text = tmp_path / "ocr.txt"
    epub_path = tmp_path / "output.epub"
    metrics_path = tmp_path / "metrics.json"
    ocr_text.write_text("Test words here", encoding="utf-8")

    rc = cli.main(
        [
            "build-epub",
            "--ocr-text",
            str(ocr_text),
            "--output",
            str(epub_path),
            "--metrics-output",
            str(metrics_path),
            "--title",
            "CLI Example",
        ]
    )

    assert rc == 0
    assert epub_path.exists()
    assert metrics_path.exists()


def test_benchmark_archive_command_writes_report(monkeypatch, tmp_path) -> None:
    output = tmp_path / "benchmark.json"
    cache_dir = tmp_path / "cache"

    def _fake_run_archive_benchmark(cache_dir, timeout_seconds, source_mode):  # noqa: ANN001
        assert timeout_seconds == 45
        assert source_mode == "best"
        return {
            "summary": {
                "book_count": 1,
                "avg_char_accuracy_proxy": 0.95,
                "avg_word_accuracy_proxy": 0.90,
            },
            "books": [],
            "metric_note": "test",
        }

    monkeypatch.setattr(cli, "run_archive_benchmark", _fake_run_archive_benchmark)
    rc = cli.main(
        [
            "benchmark-archive",
            "--output",
            str(output),
            "--cache-dir",
            str(cache_dir),
            "--timeout-seconds",
            "45",
            "--source-mode",
            "best",
        ]
    )

    assert rc == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["summary"]["book_count"] == 1


def test_build_benchmark_corpus_command_writes_manifest(monkeypatch, tmp_path) -> None:
    output_dir = tmp_path / "corpus"
    cache_dir = tmp_path / "cache"

    def _fake_build_benchmark_corpus(**kwargs):  # noqa: ANN003
        assert kwargs["output_dir"] == output_dir
        assert kwargs["cache_dir"] == cache_dir
        assert kwargs["timeout_seconds"] == 30
        assert kwargs["max_books"] == 2
        assert kwargs["artifact_profiles"] == ("clean", "scan-moderate")
        assert kwargs["artifact_seed"] == 7
        return {"book_count": 2, "books": []}

    monkeypatch.setattr(cli, "build_benchmark_corpus", _fake_build_benchmark_corpus)
    rc = cli.main(
        [
            "build-benchmark-corpus",
            "--output-dir",
            str(output_dir),
            "--cache-dir",
            str(cache_dir),
            "--timeout-seconds",
            "30",
            "--max-books",
            "2",
            "--artifact-profile",
            "clean",
            "--artifact-profile",
            "scan-moderate",
            "--artifact-seed",
            "7",
        ]
    )

    assert rc == 0


def test_benchmark_corpus_command_runs_pipeline(monkeypatch, tmp_path) -> None:
    corpus_manifest = tmp_path / "manifest.json"
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    corpus_manifest.write_text("{}", encoding="utf-8")

    def _fake_run_benchmark_corpus(**kwargs):  # noqa: ANN003
        assert kwargs["corpus_manifest_path"] == corpus_manifest
        assert kwargs["output_report_path"] == output_report
        assert kwargs["work_dir"] == work_dir
        assert kwargs["preprocess_mode"] == "scan-local-threshold"
        assert kwargs["tesseract_psm"] == "6"
        assert kwargs["ocr_engine"] == "paddleocr"
        assert kwargs["inverse_render_rerank"] is True
        assert kwargs["inverse_render_top_k"] == 4
        assert kwargs["verify_cleanup_spans"] is True
        return {
            "summary": {
                "avg_word_accuracy": 0.98,
                "avg_char_accuracy": 0.995,
            }
        }

    monkeypatch.setattr(cli, "run_benchmark_corpus", _fake_run_benchmark_corpus)
    rc = cli.main(
        [
            "benchmark-corpus",
            "--corpus-manifest",
            str(corpus_manifest),
            "--output",
            str(output_report),
            "--work-dir",
            str(work_dir),
            "--preprocess-mode",
            "scan-local-threshold",
            "--tesseract-psm",
            "6",
            "--ocr-engine",
            "paddleocr",
            "--inverse-render-rerank",
            "--inverse-render-top-k",
            "4",
            "--verify-cleanup-spans",
        ]
    )

    assert rc == 0


def test_benchmark_streaming_corpus_command_runs_pipeline(monkeypatch, tmp_path) -> None:
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    failures_dir = tmp_path / "failures"
    cache_dir = tmp_path / "cache"

    def _fake_run_streaming_benchmark_corpus(**kwargs):  # noqa: ANN003
        assert kwargs["output_report_path"] == output_report
        assert kwargs["work_dir"] == work_dir
        assert kwargs["failures_dir"] == failures_dir
        assert kwargs["cache_dir"] == cache_dir
        assert kwargs["samples_per_book"] == 4
        assert kwargs["artifact_profiles"] == ("scan-moderate", "scan-heavy")
        assert kwargs["max_recorded_failures"] == 12
        assert kwargs["failure_word_accuracy_below"] == 0.97
        assert kwargs["failure_char_accuracy_below"] == 0.995
        assert kwargs["preprocess_mode"] == "scan-local-threshold"
        assert kwargs["tesseract_psm"] == "6"
        assert kwargs["ocr_engine"] == "paddleocr"
        assert kwargs["inverse_render_rerank"] is True
        assert kwargs["inverse_render_top_k"] == 4
        assert kwargs["verify_cleanup_spans"] is True
        return {
            "summary": {
                "sample_count": 8,
                "failure_count": 3,
                "avg_word_accuracy": 0.98,
                "avg_char_accuracy": 0.995,
            }
        }

    monkeypatch.setattr(cli, "run_streaming_benchmark_corpus", _fake_run_streaming_benchmark_corpus)
    rc = cli.main(
        [
            "benchmark-streaming-corpus",
            "--output",
            str(output_report),
            "--work-dir",
            str(work_dir),
            "--failures-dir",
            str(failures_dir),
            "--cache-dir",
            str(cache_dir),
            "--samples-per-book",
            "4",
            "--artifact-profile",
            "scan-moderate",
            "--artifact-profile",
            "scan-heavy",
            "--max-recorded-failures",
            "12",
            "--failure-word-accuracy-below",
            "0.97",
            "--failure-char-accuracy-below",
            "0.995",
            "--preprocess-mode",
            "scan-local-threshold",
            "--tesseract-psm",
            "6",
            "--ocr-engine",
            "paddleocr",
            "--inverse-render-rerank",
            "--inverse-render-top-k",
            "4",
            "--verify-cleanup-spans",
        ]
    )

    assert rc == 0


def test_build_image_text_corpus_command_writes_manifest(monkeypatch, tmp_path) -> None:
    output_manifest = tmp_path / "manifest.json"
    images_dir = tmp_path / "images"
    texts_dir = tmp_path / "texts"

    def _fake_build_image_text_corpus_manifest(**kwargs):  # noqa: ANN003
        assert kwargs["output_manifest_path"] == output_manifest
        assert kwargs["images_dir"] == images_dir
        assert kwargs["texts_dir"] == texts_dir
        assert kwargs["image_glob"] == "*.tiff"
        assert kwargs["text_glob"] == "*.txt"
        assert kwargs["limit"] == 3
        return {"book_count": 3, "books": []}

    monkeypatch.setattr(cli, "build_image_text_corpus_manifest", _fake_build_image_text_corpus_manifest)
    rc = cli.main(
        [
            "build-image-text-corpus",
            "--output-manifest",
            str(output_manifest),
            "--images-dir",
            str(images_dir),
            "--texts-dir",
            str(texts_dir),
            "--image-glob",
            "*.tiff",
            "--text-glob",
            "*.txt",
            "--limit",
            "3",
        ]
    )

    assert rc == 0


def test_benchmark_parallel_text_command_runs_pipeline(monkeypatch, tmp_path) -> None:
    input_tsv = tmp_path / "pairs.tsv"
    output_report = tmp_path / "report.json"
    input_tsv.write_text("domain\tgsent\thsent\n", encoding="utf-8")

    def _fake_run_parallel_text_benchmark(**kwargs):  # noqa: ANN003
        assert kwargs["corpus_path"] == input_tsv
        assert kwargs["output_report_path"] == output_report
        assert kwargs["reference_column"] == "clean"
        assert kwargs["hypothesis_column"] == "ocr"
        assert kwargs["domains"] == ("Fiction", "History")
        assert kwargs["row_limit"] == 10
        assert kwargs["include_reference_lexicon_cleanup"] is True
        return {
            "summary": {
                "raw_metrics": {"word_accuracy": 0.9},
                "cleaned_metrics": {"word_accuracy": 0.95},
            }
        }

    monkeypatch.setattr(cli, "run_parallel_text_benchmark", _fake_run_parallel_text_benchmark)
    rc = cli.main(
        [
            "benchmark-parallel-text",
            "--input",
            str(input_tsv),
            "--output",
            str(output_report),
            "--reference-column",
            "clean",
            "--hypothesis-column",
            "ocr",
            "--domain",
            "Fiction",
            "--domain",
            "History",
            "--limit",
            "10",
            "--reference-lexicon-cleanup",
        ]
    )

    assert rc == 0


def test_ocr_pdf_command_runs_pipeline(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    output_text = tmp_path / "book.txt"
    work_dir = tmp_path / "work"
    input_pdf.write_bytes(b"fake")

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        assert kwargs["pdf_path"] == input_pdf
        assert kwargs["output_text_path"] == output_text
        assert kwargs["work_dir"] == work_dir
        assert kwargs["language"] == "eng"
        assert kwargs["dpi"] == 200
        assert kwargs["preprocess_mode"] == "deskew"
        assert kwargs["binarize_threshold"] == 180
        assert kwargs["deskew_max_angle"] == 4.0
        assert kwargs["deskew_angle_step"] == 0.25
        assert kwargs["tesseract_psm"] == "6"
        assert kwargs["tesseract_output_format"] == "hocr"
        assert kwargs["confidence_aware_cleanup"] is True
        assert kwargs["cleanup_high_confidence_threshold"] == 92.0
        assert kwargs["ocr_engine"] == "paddleocr"
        assert kwargs["inverse_render_rerank"] is True
        assert kwargs["inverse_render_top_k"] == 5
        assert kwargs["verify_cleanup_spans"] is True
        assert callable(kwargs["progress_callback"])
        return {"page_count": 3, "word_count": 120, "character_count": 600}

    monkeypatch.setattr(cli, "ocr_pdf_with_tesseract", _fake_ocr_pdf_with_tesseract)
    rc = cli.main(
        [
            "ocr-pdf",
            "--pdf",
            str(input_pdf),
            "--output",
            str(output_text),
            "--work-dir",
            str(work_dir),
            "--dpi",
            "200",
            "--preprocess-mode",
            "deskew",
            "--binarize-threshold",
            "180",
            "--deskew-max-angle",
            "4.0",
            "--deskew-angle-step",
            "0.25",
            "--tesseract-psm",
            "6",
            "--tesseract-output-format",
            "hocr",
            "--confidence-aware-cleanup",
            "--cleanup-high-confidence-threshold",
            "92",
            "--ocr-engine",
            "paddleocr",
            "--inverse-render-rerank",
            "--inverse-render-top-k",
            "5",
            "--verify-cleanup-spans",
        ]
    )
    assert rc == 0


def test_ocr_eval_modes_command_runs_pipeline(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    reference_text = tmp_path / "reference.txt"
    input_pdf.write_bytes(b"fake")
    reference_text.write_text("ref", encoding="utf-8")

    def _fake_evaluate_ocr_preprocess_modes(**kwargs):  # noqa: ANN003
        assert kwargs["pdf_path"] == input_pdf
        assert kwargs["work_dir"] == work_dir
        assert kwargs["output_report_path"] == output_report
        assert kwargs["reference_text_path"] == reference_text
        assert kwargs["language"] == "eng"
        assert kwargs["dpi"] == 250
        assert kwargs["binarize_threshold"] == 160
        assert kwargs["deskew_max_angle"] == 5.0
        assert kwargs["deskew_angle_step"] == 0.5
        assert kwargs["tesseract_psm"] == "4"
        assert kwargs["ocr_engine"] == "paddleocr"
        return {"modes": {"none": {}, "basic": {}, "deskew": {}, "dewarp": {}}}

    monkeypatch.setattr(cli, "evaluate_ocr_preprocess_modes", _fake_evaluate_ocr_preprocess_modes)
    rc = cli.main(
        [
            "ocr-eval-modes",
            "--pdf",
            str(input_pdf),
            "--output",
            str(output_report),
            "--work-dir",
            str(work_dir),
            "--reference-text",
            str(reference_text),
            "--dpi",
            "250",
            "--binarize-threshold",
            "160",
            "--deskew-max-angle",
            "5.0",
            "--tesseract-psm",
            "4",
            "--ocr-engine",
            "paddleocr",
        ]
    )
    assert rc == 0


def test_benchmark_local_archive_command_runs(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    input_pdf.write_bytes(b"fake")

    def _fake_benchmark_local_ocr_against_archive(**kwargs):  # noqa: ANN003
        assert kwargs["pdf_path"] == input_pdf
        assert kwargs["archive_identifier"] == "example-book-id"
        assert kwargs["output_report_path"] == output_report
        assert kwargs["work_dir"] == work_dir
        assert kwargs["archive_source_mode"] == "best"
        assert kwargs["tesseract_psm"] == "3"
        assert kwargs["ocr_engine"] == "paddleocr"
        return {
            "selected_archive_source": "djvu",
            "best_mode": "deskew",
        }

    monkeypatch.setattr(cli, "benchmark_local_ocr_against_archive", _fake_benchmark_local_ocr_against_archive)
    rc = cli.main(
        [
            "benchmark-local-archive",
            "--pdf",
            str(input_pdf),
            "--archive-identifier",
            "example-book-id",
            "--output",
            str(output_report),
            "--work-dir",
            str(work_dir),
            "--archive-source-mode",
            "best",
            "--tesseract-psm",
            "3",
            "--ocr-engine",
            "paddleocr",
        ]
    )
    assert rc == 0


def test_eval_epub_command_writes_report(monkeypatch, tmp_path) -> None:
    input_epub = tmp_path / "book.epub"
    output_report = tmp_path / "epub_eval.json"
    reference_headings = tmp_path / "headings.txt"
    input_epub.write_bytes(b"fake")
    reference_headings.write_text("Eval Book", encoding="utf-8")

    def _fake_evaluate_epub_structure(  # noqa: ANN001
        epub_path, run_epubcheck, epubcheck_cmd, reference_headings_path
    ):
        assert epub_path == input_epub
        assert run_epubcheck is False
        assert epubcheck_cmd == "epubcheck"
        assert reference_headings_path == reference_headings
        return {
            "metrics": {"structure_score": 0.9},
            "epubcheck": {"status": "skipped"},
            "checks": {},
        }

    monkeypatch.setattr(cli, "evaluate_epub_structure", _fake_evaluate_epub_structure)
    rc = cli.main(
        [
            "eval-epub",
            "--epub",
            str(input_epub),
            "--output",
            str(output_report),
            "--skip-epubcheck",
            "--reference-headings",
            str(reference_headings),
        ]
    )
    assert rc == 0
    payload = json.loads(output_report.read_text(encoding="utf-8"))
    assert payload["epubcheck"]["status"] == "skipped"


def test_benchmark_failures_page_command_writes_html(monkeypatch, tmp_path) -> None:
    input_report = tmp_path / "report.json"
    output_html = tmp_path / "failures.html"
    input_report.write_text("{}", encoding="utf-8")

    def _fake_build_local_benchmark_failure_page(  # noqa: ANN001
        report_path, output_html_path, max_failures, max_pages_per_token, max_example_pages
    ):
        assert report_path == input_report
        assert output_html_path == output_html
        assert max_failures == 20
        assert max_pages_per_token == 2
        assert max_example_pages == 5
        output_html_path.write_text("<html></html>", encoding="utf-8")
        return {"mode_count": 4, "best_mode": "deskew"}

    monkeypatch.setattr(cli, "build_local_benchmark_failure_page", _fake_build_local_benchmark_failure_page)
    rc = cli.main(
        [
            "benchmark-failures-page",
            "--report",
            str(input_report),
            "--output",
            str(output_html),
            "--max-failures",
            "20",
            "--max-pages-per-token",
            "2",
            "--max-example-pages",
            "5",
        ]
    )
    assert rc == 0
    assert output_html.exists()


def test_benchmark_processing_page_command_writes_html(monkeypatch, tmp_path) -> None:
    input_report = tmp_path / "report.json"
    output_html = tmp_path / "processing.html"
    input_report.write_text("{}", encoding="utf-8")

    def _fake_build_local_benchmark_processing_page(report_path, output_html_path, max_example_pages):  # noqa: ANN001
        assert report_path == input_report
        assert output_html_path == output_html
        assert max_example_pages == 3
        output_html_path.write_text("<html></html>", encoding="utf-8")
        return {"mode_count": 2, "best_mode": "scan"}

    monkeypatch.setattr(cli, "build_local_benchmark_processing_page", _fake_build_local_benchmark_processing_page)
    rc = cli.main(
        [
            "benchmark-processing-page",
            "--report",
            str(input_report),
            "--output",
            str(output_html),
            "--max-example-pages",
            "3",
        ]
    )
    assert rc == 0
    assert output_html.exists()


def test_archive_epub_compare_page_command_writes_html(monkeypatch, tmp_path) -> None:
    output_html = tmp_path / "compare.html"

    def _fake_build_archive_epub_compare_page(  # noqa: ANN001
        archive_identifier,
        output_html_path,
        generated_source,
        archive_source_mode,
        timeout_seconds,
        run_epubcheck,
        selected_pdf_page,
        ocr_language,
        dpi,
        ocr_engine,
        preprocess_mode,
        binarize_threshold,
        deskew_max_angle,
        deskew_angle_step,
        tesseract_psm,
        apply_cleanup,
        emit_page_artifacts,
        page_artifacts_dir,
        inverse_render_rerank,
        inverse_render_top_k,
        verify_cleanup_spans,
        progress_callback,
    ):
        assert archive_identifier == "demo-book"
        assert output_html_path == output_html
        assert generated_source == "local-ocr"
        assert archive_source_mode == "abbyy"
        assert timeout_seconds == 75
        assert run_epubcheck is True
        assert selected_pdf_page == 12
        assert ocr_language is None
        assert dpi == 300
        assert ocr_engine == "tesseract"
        assert preprocess_mode == "auto"
        assert binarize_threshold == 190
        assert deskew_max_angle == 3.0
        assert deskew_angle_step == 0.5
        assert tesseract_psm == "auto"
        assert apply_cleanup is True
        assert emit_page_artifacts is True
        assert page_artifacts_dir is None
        assert inverse_render_rerank is True
        assert inverse_render_top_k == 3
        assert verify_cleanup_spans is True
        assert callable(progress_callback)
        output_html_path.write_text("<html></html>", encoding="utf-8")
        return {
            "generated_source": "local-ocr",
            "title": "Demo Book",
        }

    monkeypatch.setattr(cli, "build_archive_epub_compare_page", _fake_build_archive_epub_compare_page)
    rc = cli.main(
        [
            "archive-epub-compare-page",
            "--archive-identifier",
            "demo-book",
            "--output",
            str(output_html),
            "--archive-source-mode",
            "abbyy",
            "--timeout-seconds",
            "75",
            "--run-epubcheck",
            "--pdf-page",
            "12",
        ]
    )
    assert rc == 0
    assert output_html.exists()
