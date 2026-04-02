import json
from pathlib import Path

import pytest

import full_auto_de_pdf.benchmark_viz as benchmark_viz
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


def test_benchmark_viz_helper_edges(tmp_path) -> None:
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    existing = report_dir / "existing.txt"
    existing.write_text("alpha", encoding="utf-8")
    cwd_existing = Path.cwd() / "benchmark-viz-cwd-temp.txt"
    cwd_existing.write_text("beta", encoding="utf-8")
    try:
        assert benchmark_viz._resolve_path(str(existing), report_dir) == existing
        assert benchmark_viz._resolve_path("existing.txt", report_dir) == existing
        assert benchmark_viz._resolve_path(cwd_existing.name, report_dir) == cwd_existing
        assert benchmark_viz._resolve_path("missing.txt", report_dir) == report_dir / "missing.txt"

        assert benchmark_viz._token_delta({"alpha": 1}, {"alpha": 2}, positive_only=False) == [
            ("alpha", -1)
        ]
        assert benchmark_viz._load_page_manifest({}, report_dir) == []
        assert benchmark_viz._load_page_manifest({"page_artifacts_manifest": "missing.json"}, report_dir) == []

        bad_manifest = report_dir / "bad-manifest.json"
        bad_manifest.write_text(json.dumps({"pages": "bad"}), encoding="utf-8")
        assert (
            benchmark_viz._load_page_manifest({"page_artifacts_manifest": str(bad_manifest)}, report_dir)
            == []
        )
        mixed_manifest = report_dir / "mixed-manifest.json"
        mixed_manifest.write_text(
            json.dumps({"pages": ["bad", {"page_index": 2}]}) + "\n",
            encoding="utf-8",
        )
        assert benchmark_viz._load_page_manifest(
            {"page_artifacts_manifest": str(mixed_manifest)},
            report_dir,
        ) == [
            {
                "page_index": 2,
                "_artifacts_dir": str(mixed_manifest.parent),
                "_work_dir": str(mixed_manifest.parent.parent),
            }
        ]

        assert benchmark_viz._read_mode_output_text({}, report_dir) is None
        assert benchmark_viz._read_mode_output_text({"output_text_path": "missing.txt"}, report_dir) is None
        assert benchmark_viz._read_page_manifest_texts({}, report_dir) == []
        fallback_page_text = report_dir / "fallback-page.txt"
        fallback_page_text.write_text("alpha beta", encoding="utf-8")
        fallback_manifest = report_dir / "fallback-manifest.json"
        fallback_manifest.write_text(
            json.dumps(
                {
                    "pages": [
                        {"text_path": 1},
                        {"text_path": "missing.txt"},
                        {"text_path": str(fallback_page_text)},
                    ]
                }
            )
            + "\n",
            encoding="utf-8",
        )
        assert benchmark_viz._read_page_manifest_texts(
            {"page_artifacts_manifest": str(fallback_manifest)},
            report_dir,
        ) == ["alpha beta"]
        assert benchmark_viz._load_mode_hypothesis_text(
            {"page_artifacts_manifest": str(fallback_manifest)},
            report_dir,
        ) == "alpha beta"
        assert benchmark_viz._read_page_text({}, report_dir) is None
        assert benchmark_viz._read_page_text({"text_path": "missing.txt"}, report_dir) is None
        assert benchmark_viz._modes_from_ranking_payload("bad") == []
        assert benchmark_viz._ranked_mode_names({"mode_ranking": [{"mode": "scan"}]}, {"scan": {}, "none": {}}) == [
            "scan",
            "none",
        ]
        assert benchmark_viz._render_page_image_gallery({}, report_dir, report_dir, include_processing_gallery=False) == ""
        assert benchmark_viz._page_snippet({}, report_dir) == ""
        assert benchmark_viz._page_snippet({"text_path": "missing.txt"}, report_dir) == ""
        assert benchmark_viz._candidate_preprocess_modes({"candidate_runs": ["bad"]}) == []
        assert benchmark_viz._source_page_image({}, report_dir) is None
        assert benchmark_viz._selected_page_image({}, report_dir) is None
        assert benchmark_viz._candidate_image_path({}, report_dir, "scan") is None
        assert benchmark_viz._format_optional_float("bad") is None
        assert "No per-page candidate breakdown" in benchmark_viz._render_candidate_runs_table({})
        with pytest.raises(ValueError):
            benchmark_viz._candidate_sort_key({"score": "bad"})
        assert "No page artifact examples were available." in benchmark_viz._render_page_examples_section(
            [],
            report_dir,
            report_dir,
            title="Examples",
            max_example_pages=2,
            include_candidate_runs=False,
            include_processing_gallery=False,
        )
        assert benchmark_viz._accuracy_tuple({"accuracy": "bad"}) == (0.0, 0.0, 0.0, 0.0)

        with pytest.raises(FileNotFoundError, match="Reference text not found"):
            benchmark_viz._load_reference_text(
                {"reference_text_path": "missing.txt"},
                report_dir,
            )
        with pytest.raises(ValueError, match="Report must contain modes"):
            benchmark_viz._validated_modes_payload({})
    finally:
        cwd_existing.unlink(missing_ok=True)


def test_benchmark_viz_path_and_copy_helpers(tmp_path) -> None:
    output_dir = tmp_path / "site"
    output_dir.mkdir()
    local_asset = output_dir / "local.png"
    local_asset.write_bytes(b"local")
    assert benchmark_viz._to_href(local_asset, output_dir) == "local.png"

    external_asset = tmp_path / "external.png"
    external_asset.write_bytes(b"external")
    href = benchmark_viz._to_href(external_asset, output_dir)
    copied_path = output_dir / href
    assert copied_path.exists()

    copied_again = benchmark_viz._copy_asset_into_output_dir(external_asset, output_dir)
    assert copied_again == copied_path

    external_asset.write_bytes(b"external-updated")
    recopied = benchmark_viz._copy_asset_into_output_dir(external_asset, output_dir)
    assert recopied.read_bytes() == b"external-updated"


def test_benchmark_viz_rendering_helpers_with_sparse_inputs(tmp_path) -> None:
    report_dir = tmp_path / "report"
    output_dir = tmp_path / "out"
    report_dir.mkdir()
    output_dir.mkdir()

    page_text = report_dir / "page.txt"
    page_text.write_text("alpha beta gamma", encoding="utf-8")
    page_image = report_dir / "page.png"
    page_image.write_bytes(b"png")

    page = {
        "page_index": 1,
        "text_path": str(page_text),
        "image_path": str(page_image),
        "ocr_input_path": str(page_image),
        "selected_preprocess_mode": "none",
        "candidate_runs": [
            {"preprocess_mode": "none", "score": 1.0, "word_count": 3},
        ],
    }

    token_index = benchmark_viz._build_page_token_index([page], report_dir)
    assert "alpha" in token_index
    unexpected_html = benchmark_viz._render_unexpected_html(
        [("ghost", 2)],
        token_index,
        report_dir,
        output_dir,
        max_pages_per_token=1,
    )
    assert "No matching page artifacts found." in unexpected_html

    missing_rows = benchmark_viz._render_missing_rows([])
    assert "No missing tokens detected." in missing_rows

    image_panel = benchmark_viz._render_image_panel("source", page_image, output_dir, selected=True)
    assert "selected" in image_panel

    metadata_html = benchmark_viz._render_page_metadata(
        {
            "selected_preprocess_mode": "scan",
            "selection_strategy": "text-score",
            "tesseract_psm": 6,
            "selection_score": 1.25,
            "inverse_render_score": 2.5,
        }
    )
    assert "inverse-render score" in metadata_html

    candidate_html = benchmark_viz._render_candidate_runs_table(page)
    assert "selected-row" in candidate_html

    processing_specs = benchmark_viz._processing_image_specs(page, report_dir)
    assert processing_specs

    report = {
        "archive_identifier": "demo",
        "selected_archive_source": "djvu",
        "best_mode": "scan",
    }
    assert "OCR Benchmark Failures" in benchmark_viz._render_html_document(
        tmp_path / "report.json",
        report,
        ["<section>mode</section>"],
    )
    assert "Mode summary" in benchmark_viz._render_processing_overview(
        tmp_path / "report.json",
        report,
        ["scan"],
        {"scan": {"accuracy": {}}},
        report_dir,
    )
    assert "Local OCR Processing Explorer" in benchmark_viz._render_processing_html_document(
        tmp_path / "report.json",
        report,
        "<section>overview</section>",
        ["<section>mode</section>"],
    )


def test_benchmark_viz_selected_image_and_empty_candidate_rows(tmp_path, monkeypatch) -> None:
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    output_dir = tmp_path / "out"
    output_dir.mkdir()

    source_image = report_dir / "page.png"
    source_image.write_bytes(b"png")
    selected_image = report_dir / "selected.png"
    selected_image.write_bytes(b"selected")
    page = {
        "image_path": str(source_image),
        "ocr_input_path": str(selected_image),
        "selected_preprocess_mode": "scan",
        "_work_dir": str(report_dir / "work"),
        "candidate_runs": ["bad"],
    }
    assert benchmark_viz._candidate_image_path(page, report_dir, "scan") == selected_image

    monkeypatch.setattr(benchmark_viz, "_candidate_sort_key", lambda run: (0.0, "", -1))
    assert "No per-page candidate breakdown" in benchmark_viz._render_candidate_runs_table(page)


def test_benchmark_viz_build_page_token_index_skips_pages_without_text(tmp_path, monkeypatch) -> None:
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    page = {"page_index": 1}
    monkeypatch.setattr(
        benchmark_viz,
        "_read_page_text",
        lambda page, report_dir: None,
    )
    assert benchmark_viz._build_page_token_index([page], report_dir) == {}


def test_benchmark_viz_builders_skip_non_dict_modes(tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("alpha beta", encoding="utf-8")
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "reference_text_path": str(reference_path),
                "best_mode": "scan",
                "mode_ranking": [{"mode": "scan"}, {"mode": "junk"}],
                "modes": {"scan": {"accuracy": {}}, "junk": "bad"},
            }
        )
        + "\n",
        encoding="utf-8",
    )

    failure_summary = build_local_benchmark_failure_page(
        report_path=report_path,
        output_html_path=tmp_path / "failures.html",
    )
    processing_summary = build_local_benchmark_processing_page(
        report_path=report_path,
        output_html_path=tmp_path / "processing.html",
    )
    assert failure_summary["mode_count"] == 1
    assert processing_summary["mode_count"] == 1


def test_benchmark_viz_builders_validate_modes(tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("alpha beta", encoding="utf-8")
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps({"reference_text_path": str(reference_path), "modes": []}) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Report must contain modes"):
        build_local_benchmark_failure_page(
            report_path=report_path,
            output_html_path=tmp_path / "failures.html",
        )

    with pytest.raises(ValueError, match="Report must contain modes"):
        build_local_benchmark_processing_page(
            report_path=report_path,
            output_html_path=tmp_path / "processing.html",
        )
