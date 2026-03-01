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
        assert kwargs["ocr_engine"] == "paddleocr"
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
            "--ocr-engine",
            "paddleocr",
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
        report_path, output_html_path, max_failures, max_pages_per_token
    ):
        assert report_path == input_report
        assert output_html_path == output_html
        assert max_failures == 20
        assert max_pages_per_token == 2
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
        ]
    )
    assert rc == 0
    assert output_html.exists()
