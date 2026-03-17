import json
from pathlib import Path

from full_auto_de_pdf.benchmark_viz import (
    build_local_benchmark_failure_page,
    build_local_benchmark_processing_page,
)


def _write_sample_report(tmp_path: Path) -> Path:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("the brown fox can jump", encoding="utf-8")

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    page_image = source_dir / "page-1.png"
    page_image.write_bytes(b"fake-image")

    work_none = tmp_path / "work-none"
    work_scan = tmp_path / "work-scan"
    (work_none / "page_ocr").mkdir(parents=True)
    (work_scan / "page_ocr").mkdir(parents=True)
    (work_scan / "preprocessed" / "scan").mkdir(parents=True)

    scan_image = work_scan / "preprocessed" / "scan" / "page-1.png"
    scan_image.write_bytes(b"fake-scan-image")

    none_page_text = work_none / "page_ocr" / "page-0001.txt"
    none_page_text.write_text("the bown fox can jump", encoding="utf-8")
    scan_page_text = work_scan / "page_ocr" / "page-0001.txt"
    scan_page_text.write_text("the brown fox can jump", encoding="utf-8")

    none_manifest = work_none / "page_ocr" / "manifest.json"
    none_manifest.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "page_index": 1,
                        "image_path": str(page_image),
                        "ocr_input_path": str(page_image),
                        "selected_preprocess_mode": "none",
                        "selection_strategy": "text-score",
                        "selection_score": 12.5,
                        "tesseract_psm": 6,
                        "text_path": str(none_page_text),
                        "candidate_runs": [
                            {
                                "preprocess_mode": "none",
                                "score": 12.5,
                                "tesseract_psm": 6,
                                "word_count": 5,
                            },
                            {
                                "preprocess_mode": "scan",
                                "score": 12.1,
                                "tesseract_psm": 6,
                                "word_count": 5,
                            },
                        ],
                    }
                ]
            }
        )
        + "\n",
        encoding="utf-8",
    )
    scan_manifest = work_scan / "page_ocr" / "manifest.json"
    scan_manifest.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "page_index": 1,
                        "image_path": str(page_image),
                        "ocr_input_path": str(scan_image),
                        "selected_preprocess_mode": "scan",
                        "selection_strategy": "text-score",
                        "selection_score": 13.0,
                        "tesseract_psm": 6,
                        "text_path": str(scan_page_text),
                    }
                ]
            }
        )
        + "\n",
        encoding="utf-8",
    )

    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "archive_identifier": "demo-book",
                "selected_archive_source": "djvu",
                "best_mode": "scan",
                "reference_text_path": str(reference_path),
                "mode_ranking": [
                    {"mode": "scan", "wer": 0.0, "cer": 0.0},
                    {"mode": "none", "wer": 0.2, "cer": 0.1},
                ],
                "modes": {
                    "none": {
                        "output_text_path": str(work_none / "none.txt"),
                        "page_artifacts_manifest": str(none_manifest),
                        "accuracy": {
                            "char_accuracy": 0.9,
                            "word_accuracy": 0.8,
                            "wer": 0.2,
                            "cer": 0.1,
                        },
                    },
                    "scan": {
                        "output_text_path": str(work_scan / "scan.txt"),
                        "page_artifacts_manifest": str(scan_manifest),
                        "accuracy": {
                            "char_accuracy": 1.0,
                            "word_accuracy": 1.0,
                            "wer": 0.0,
                            "cer": 0.0,
                        },
                    },
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (work_none / "none.txt").write_text("the bown fox can jump", encoding="utf-8")
    (work_scan / "scan.txt").write_text("the brown fox can jump", encoding="utf-8")
    return report_path


def test_build_local_benchmark_failure_page_renders_failures_and_images(tmp_path) -> None:
    report_path = _write_sample_report(tmp_path)
    output_html = tmp_path / "benchmark_failures.html"
    summary = build_local_benchmark_failure_page(
        report_path=report_path,
        output_html_path=output_html,
        max_failures=10,
        max_pages_per_token=2,
        max_example_pages=3,
    )
    assert summary["mode_count"] == 2
    assert output_html.exists()
    html = output_html.read_text(encoding="utf-8").lower()
    assert "local ocr benchmark failure explorer" in html
    assert "bown" in html
    assert "brown" in html
    assert "<img" in html
    assert "representative pdf page examples" in html
    assert "selected preprocess" in html
    assert "candidate scoring" in html


def test_build_local_benchmark_failure_page_copies_images_when_output_is_elsewhere(tmp_path) -> None:
    report_dir = tmp_path / "report_data"
    report_dir.mkdir()
    report_path = _write_sample_report(report_dir)
    output_dir = tmp_path / "site"
    output_html = output_dir / "benchmark_failures.html"
    build_local_benchmark_failure_page(
        report_path=report_path,
        output_html_path=output_html,
        max_failures=10,
        max_pages_per_token=2,
        max_example_pages=3,
    )
    html = output_html.read_text(encoding="utf-8")
    assert "file://" not in html
    assert "_assets/" in html
    copied_assets = list((output_dir / "_assets").rglob("*.png"))
    assert copied_assets


def test_build_local_benchmark_processing_page_renders_processing_examples(tmp_path) -> None:
    report_path = _write_sample_report(tmp_path)
    output_html = tmp_path / "benchmark_processing.html"

    summary = build_local_benchmark_processing_page(
        report_path=report_path,
        output_html_path=output_html,
        max_example_pages=2,
    )

    assert summary["mode_count"] == 2
    html = output_html.read_text(encoding="utf-8").lower()
    assert "local ocr processing explorer" in html
    assert "what this page shows" in html
    assert "mode summary" in html
    assert "ocr input (scan)" in html
    assert "candidate scoring" in html


def test_build_local_benchmark_processing_page_copies_images_when_output_is_elsewhere(tmp_path) -> None:
    report_dir = tmp_path / "report_data"
    report_dir.mkdir()
    report_path = _write_sample_report(report_dir)
    output_dir = tmp_path / "site"
    output_html = output_dir / "benchmark_processing.html"
    build_local_benchmark_processing_page(
        report_path=report_path,
        output_html_path=output_html,
        max_example_pages=2,
    )
    html = output_html.read_text(encoding="utf-8")
    assert "file://" not in html
    assert "_assets/" in html
    copied_assets = list((output_dir / "_assets").rglob("*.png"))
    assert copied_assets


def test_build_local_benchmark_failure_page_requires_reference_path(tmp_path) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps({"modes": {"none": {}}}) + "\n", encoding="utf-8")
    output_html = tmp_path / "benchmark_failures.html"
    try:
        build_local_benchmark_failure_page(report_path=report_path, output_html_path=output_html)
    except ValueError as exc:
        assert "reference_text_path" in str(exc)
    else:
        raise AssertionError("expected ValueError")
