import json
from pathlib import Path

from full_auto_de_pdf.benchmark_viz import build_local_benchmark_failure_page


def test_build_local_benchmark_failure_page_renders_failures_and_images(tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("the brown fox can jump", encoding="utf-8")

    page_image = tmp_path / "page-1.png"
    page_image.write_bytes(b"fake-image")
    page_text = tmp_path / "page-0001.txt"
    page_text.write_text("the bown fox can jump", encoding="utf-8")
    mode_output = tmp_path / "none.txt"
    mode_output.write_text("the bown fox can jump", encoding="utf-8")

    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "page_index": 1,
                        "ocr_input_path": str(page_image),
                        "text_path": str(page_text),
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
                "best_mode": "none",
                "reference_text_path": str(reference_path),
                "mode_ranking": [{"mode": "none", "wer": 0.1, "cer": 0.1}],
                "modes": {
                    "none": {
                        "output_text_path": str(mode_output),
                        "page_artifacts_manifest": str(manifest_path),
                        "accuracy": {
                            "char_accuracy": 0.9,
                            "word_accuracy": 0.8,
                            "wer": 0.2,
                            "cer": 0.1,
                        },
                    }
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )

    output_html = tmp_path / "benchmark_failures.html"
    summary = build_local_benchmark_failure_page(
        report_path=report_path,
        output_html_path=output_html,
        max_failures=10,
        max_pages_per_token=2,
    )
    assert summary["mode_count"] == 1
    assert output_html.exists()
    html = output_html.read_text(encoding="utf-8").lower()
    assert "local ocr benchmark failure explorer" in html
    assert "bown" in html
    assert "brown" in html
    assert "<img" in html


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
