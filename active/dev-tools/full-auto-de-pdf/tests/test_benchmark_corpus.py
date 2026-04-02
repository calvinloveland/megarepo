import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from PIL import Image
import pytest

import full_auto_de_pdf.benchmark_corpus as benchmark_corpus
from full_auto_de_pdf.benchmark import BenchmarkBook
from full_auto_de_pdf.benchmark_corpus import (
    build_benchmark_corpus,
    build_image_text_corpus_manifest,
    run_benchmark_corpus,
    run_streaming_benchmark_corpus,
)


def _write_test_image(path: Path) -> None:
    Image.new("L", (24, 24), color=255).save(path)


def test_build_benchmark_corpus_creates_manifest_and_assets(monkeypatch, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    source_text = (
        "Intro words only.\n\n"
        "Chapter One begins with clean printed text for OCR benchmarking.\n\n"
        "This paragraph should appear in the generated excerpt and PDF output.\n\n"
        "Another paragraph keeps the sample long enough for wrapping."
    )

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.fetch_gutenberg_text",
        lambda _gutenberg_id, timeout_seconds=60: source_text,
    )

    manifest = build_benchmark_corpus(
        output_dir=tmp_path / "corpus",
        cache_dir=tmp_path / "cache",
        books=(book,),
        excerpt_word_count=18,
        skip_word_count=2,
        font_size=20,
        page_width=900,
        page_height=1200,
        margin=80,
    )

    assert manifest["book_count"] == 1
    book_payload = manifest["books"][0]
    assert Path(book_payload["pdf_path"]).exists()
    assert Path(book_payload["reference_text_path"]).exists()
    assert Path(book_payload["page_image_paths"][0]).exists()
    saved_reference = Path(book_payload["reference_text_path"]).read_text(encoding="utf-8")
    assert "Chapter One begins" in saved_reference
    assert manifest["recommended_external_corpus"]["name"] == "Gutenberg-HathiTrust Parallel Corpus"
    assert book_payload["artifact_profile"] == "clean"


def test_build_benchmark_corpus_can_emit_multiple_artifact_profiles(monkeypatch, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    source_text = (
        "Intro words only.\n\n"
        "Chapter One begins with clean printed text for OCR benchmarking.\n\n"
        "This paragraph should appear in the generated excerpt and PDF output.\n\n"
        "Another paragraph keeps the sample long enough for wrapping."
    )

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.fetch_gutenberg_text",
        lambda _gutenberg_id, timeout_seconds=60: source_text,
    )

    manifest = build_benchmark_corpus(
        output_dir=tmp_path / "corpus",
        cache_dir=tmp_path / "cache",
        books=(book,),
        excerpt_word_count=18,
        skip_word_count=2,
        font_size=20,
        page_width=900,
        page_height=1200,
        margin=80,
        artifact_profiles=("clean", "scan-photocopy"),
        artifact_seed=11,
    )

    assert manifest["book_count"] == 2
    clean_book = next(item for item in manifest["books"] if item["artifact_profile"] == "clean")
    heavy_book = next(item for item in manifest["books"] if item["artifact_profile"] == "scan-photocopy")
    assert clean_book["identifier"] == "demo-book"
    assert heavy_book["identifier"] == "demo-book-scan-photocopy"
    assert Path(clean_book["page_image_paths"][0]).read_bytes() != Path(
        heavy_book["page_image_paths"][0]
    ).read_bytes()


def test_build_benchmark_corpus_artifacts_are_seed_stable(monkeypatch, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    source_text = (
        "Intro words only.\n\n"
        "Chapter One begins with clean printed text for OCR benchmarking.\n\n"
        "This paragraph should appear in the generated excerpt and PDF output.\n\n"
        "Another paragraph keeps the sample long enough for wrapping."
    )

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.fetch_gutenberg_text",
        lambda _gutenberg_id, timeout_seconds=60: source_text,
    )

    first_manifest = build_benchmark_corpus(
        output_dir=tmp_path / "corpus-a",
        cache_dir=tmp_path / "cache-a",
        books=(book,),
        excerpt_word_count=18,
        skip_word_count=2,
        artifact_profiles=("scan-moderate",),
        artifact_seed=21,
    )
    second_manifest = build_benchmark_corpus(
        output_dir=tmp_path / "corpus-b",
        cache_dir=tmp_path / "cache-b",
        books=(book,),
        excerpt_word_count=18,
        skip_word_count=2,
        artifact_profiles=("scan-moderate",),
        artifact_seed=21,
    )

    first_image = Path(first_manifest["books"][0]["page_image_paths"][0]).read_bytes()
    second_image = Path(second_manifest["books"][0]["page_image_paths"][0]).read_bytes()
    assert first_image == second_image


def test_run_benchmark_corpus_aggregates_accuracy(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    pdf_path = tmp_path / "synthetic.pdf"
    pdf_path.write_bytes(b"fake-pdf")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "books": [
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "pdf_path": str(pdf_path),
                        "reference_text_path": str(reference_path),
                        "artifact_profile": "scan-extreme",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("clean printed text", encoding="utf-8")
        return {
            "page_count": 1,
            "word_count": 3,
            "character_count": 18,
            "mode_usage": {"auto": 1},
            "tesseract_psm_usage": {"6": 1},
            "page_analysis": {
                "page_type_counts": {"body": 1},
                "page_quality_tier_counts": {"high": 1},
                "page_route_counts": {"body": 1},
                "front_matter_page_count": 0,
                "front_matter_page_indices": [],
                "low_quality_page_count": 0,
                "low_quality_page_indices": [],
                "targeted_page_retry_count": 0,
                "targeted_page_retry_page_indices": [],
                "targeted_page_retry_reason_counts": {},
            },
        }

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.ocr_pdf_with_tesseract",
        _fake_ocr_pdf_with_tesseract,
    )
    monotonic_values = iter([0.0, 0.0, 1.0, 3.0, 4.0, 5.0])
    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.time.monotonic",
        lambda: next(monotonic_values),
    )

    report = run_benchmark_corpus(
        corpus_manifest_path=manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
        preprocess_mode="auto",
        tesseract_psm="auto",
    )

    assert report["summary"]["avg_word_accuracy"] == 1.0
    assert report["summary"]["avg_char_accuracy"] == 1.0
    assert report["summary"]["perfect_word_accuracy_rate"] == 1.0
    assert report["summary"]["perfect_char_accuracy_rate"] == 1.0
    assert report["summary"]["worst_word_accuracy"] == 1.0
    assert report["summary"]["worst_char_accuracy"] == 1.0
    assert report["summary"]["avg_unexpected_alpha_token_rate"] == 0.0
    assert report["summary"]["avg_low_quality_page_rate"] == 0.0
    assert report["summary"]["avg_front_matter_page_rate"] == 0.0
    assert report["summary"]["avg_targeted_page_retry_rate"] == 0.0
    assert report["summary"]["benchmark_elapsed_seconds"] == 5.0
    assert report["summary"]["total_page_count"] == 1
    assert report["summary"]["total_word_count"] == 3
    assert report["summary"]["total_character_count"] == 18
    assert report["summary"]["total_ocr_elapsed_seconds"] == 2.0
    assert report["summary"]["avg_ocr_elapsed_seconds_per_item"] == 2.0
    assert report["summary"]["overall_ocr_pages_per_second"] == 0.5
    assert report["summary"]["overall_ocr_words_per_second"] == 1.5
    assert report["summary"]["overall_ocr_characters_per_second"] == 9.0
    assert report["summary"]["lowest_word_accuracy_items"] == [
        {
            "identifier": "demo-book",
            "title": "Demo Book",
            "artifact_profile": "scan-extreme",
            "word_accuracy": 1.0,
            "char_accuracy": 1.0,
            "unexpected_alpha_token_count": 0,
        }
    ]
    assert report["summary"]["artifact_profile_summary"] == {
        "scan-extreme": {
            "item_count": 1,
            "avg_char_accuracy": 1.0,
            "avg_word_accuracy": 1.0,
            "avg_unexpected_alpha_token_rate": 0.0,
            "perfect_char_accuracy_rate": 1.0,
            "perfect_word_accuracy_rate": 1.0,
            "worst_char_accuracy": 1.0,
            "worst_word_accuracy": 1.0,
            "total_page_count": 1,
            "total_word_count": 3,
            "total_character_count": 18,
            "total_ocr_elapsed_seconds": 2.0,
            "avg_ocr_elapsed_seconds_per_item": 2.0,
            "overall_ocr_pages_per_second": 0.5,
            "overall_ocr_words_per_second": 1.5,
            "overall_ocr_characters_per_second": 9.0,
        }
    }
    assert report["summary"]["common_unexpected_alpha_tokens"] == []
    assert report["summary"]["page_type_counts"] == {"body": 1}
    assert report["summary"]["page_quality_tier_counts"] == {"high": 1}
    assert report["summary"]["page_route_counts"] == {"body": 1}
    assert report["summary"]["targeted_page_retry_reason_counts"] == {}
    assert report["books"][0]["mode_usage"] == {"auto": 1}
    assert report["books"][0]["page_analysis"]["page_type_counts"] == {"body": 1}
    assert report["books"][0]["ocr_elapsed_seconds"] == 2.0
    assert report["books"][0]["ocr_pages_per_second"] == 0.5
    assert report["books"][0]["ocr_words_per_second"] == 1.5
    assert report["books"][0]["ocr_characters_per_second"] == 9.0
    assert "synthetic printed PDFs" in report["metric_note"]


def test_run_benchmark_corpus_emits_progress_updates(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    pdf_path = tmp_path / "synthetic.pdf"
    pdf_path.write_bytes(b"fake-pdf")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "books": [
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "pdf_path": str(pdf_path),
                        "reference_text_path": str(reference_path),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("clean printed text", encoding="utf-8")
        return {"page_count": 1, "word_count": 3, "character_count": 18}

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.ocr_pdf_with_tesseract",
        _fake_ocr_pdf_with_tesseract,
    )
    events: list[dict[str, object]] = []

    run_benchmark_corpus(
        corpus_manifest_path=manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
        progress_callback=events.append,
    )

    assert [event["status"] for event in events] == ["running", "running", "complete"]
    assert events[0]["stage"] == "benchmark-corpus"
    assert events[0]["completed_items"] == 0
    assert events[0]["total_items"] == 1
    assert events[1]["current_identifier"] == "demo-book"
    assert events[1]["completed_items"] == 1
    assert events[2]["completed_items"] == 1
    assert events[2]["estimated_remaining_seconds"] == 0.0


def test_run_benchmark_corpus_prefers_page_images_when_available(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    pdf_path = tmp_path / "synthetic.pdf"
    pdf_path.write_bytes(b"fake-pdf")
    page_path = tmp_path / "page-1.png"
    _write_test_image(page_path)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "books": [
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "pdf_path": str(pdf_path),
                        "reference_text_path": str(reference_path),
                        "page_image_paths": [str(page_path)],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    seen = {"page_images": False}

    def _fake_ocr_page_images(**kwargs):  # noqa: ANN003
        seen["page_images"] = True
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("clean printed text", encoding="utf-8")
        return {"page_count": 1, "word_count": 3, "character_count": 18}

    monkeypatch.setattr("full_auto_de_pdf.benchmark_corpus.ocr_page_images", _fake_ocr_page_images)

    report = run_benchmark_corpus(
        corpus_manifest_path=manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
    )

    assert seen["page_images"] is True
    assert report["summary"]["avg_word_accuracy"] == 1.0


def test_run_benchmark_corpus_reports_unexpected_alpha_tokens(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("I seem calm and have seen each note.", encoding="utf-8")
    pdf_path = tmp_path / "synthetic.pdf"
    pdf_path.write_bytes(b"fake-pdf")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "books": [
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "pdf_path": str(pdf_path),
                        "reference_text_path": str(reference_path),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("I scem calm and have scen cach note.", encoding="utf-8")
        return {"page_count": 1, "word_count": 8, "character_count": 37}

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.ocr_pdf_with_tesseract",
        _fake_ocr_pdf_with_tesseract,
    )

    report = run_benchmark_corpus(
        corpus_manifest_path=manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
    )

    assert report["books"][0]["unexpected_alpha_token_count"] == 3
    assert report["books"][0]["unexpected_alpha_tokens"] == [
        {"token": "scem", "count": 1},
        {"token": "scen", "count": 1},
        {"token": "cach", "count": 1},
    ]
    assert report["summary"]["common_unexpected_alpha_tokens"] == [
        {"token": "scem", "count": 1},
        {"token": "scen", "count": 1},
        {"token": "cach", "count": 1},
    ]
    assert report["summary"]["avg_unexpected_alpha_token_rate"] == 3 / 8
    assert report["summary"]["perfect_word_accuracy_rate"] == 0.0
    assert report["summary"]["worst_word_accuracy"] == report["books"][0]["word_accuracy"]


def test_build_image_text_corpus_manifest_pairs_matching_stems(tmp_path) -> None:
    images_dir = tmp_path / "images"
    texts_dir = tmp_path / "texts"
    images_dir.mkdir()
    texts_dir.mkdir()
    _write_test_image(images_dir / "a006.tiff")
    (texts_dir / "a006.txt").write_text("Ground truth text", encoding="utf-8")
    _write_test_image(images_dir / "orphan.tiff")

    manifest = build_image_text_corpus_manifest(
        output_manifest_path=tmp_path / "manifest.json",
        images_dir=images_dir,
        texts_dir=texts_dir,
    )

    assert manifest["book_count"] == 1
    assert manifest["books"][0]["identifier"] == "a006"
    assert manifest["books"][0]["page_image_paths"] == [str(images_dir / "a006.tiff")]


def test_build_image_text_corpus_manifest_rejects_corrupt_images(tmp_path) -> None:
    images_dir = tmp_path / "images"
    texts_dir = tmp_path / "texts"
    images_dir.mkdir()
    texts_dir.mkdir()
    (images_dir / "a006.tiff").write_bytes(b"fake-image")
    (texts_dir / "a006.txt").write_text("Ground truth text", encoding="utf-8")

    with pytest.raises(ValueError, match="unreadable or corrupt image"):
        build_image_text_corpus_manifest(
            output_manifest_path=tmp_path / "manifest.json",
            images_dir=images_dir,
            texts_dir=texts_dir,
        )


def test_run_benchmark_corpus_supports_image_only_manifest(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    page_path = tmp_path / "page-1.png"
    _write_test_image(page_path)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "corpus_type": "local-image-text-groundtruth",
                "books": [
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "reference_text_path": str(reference_path),
                        "page_image_paths": [str(page_path)],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_ocr_page_images(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("clean printed text", encoding="utf-8")
        return {"page_count": 1, "word_count": 3, "character_count": 18}

    monkeypatch.setattr("full_auto_de_pdf.benchmark_corpus.ocr_page_images", _fake_ocr_page_images)

    report = run_benchmark_corpus(
        corpus_manifest_path=manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
    )

    assert report["books"][0]["pdf_path"] is None
    assert report["summary"]["avg_char_accuracy"] == 1.0
    assert report["corpus_type"] == "local-image-text-groundtruth"
    assert "existing local page images" in report["metric_note"]


def test_run_streaming_benchmark_corpus_records_only_failures(monkeypatch, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    source_text = (
        "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.\n\n"
        "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda nu."
    )

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.fetch_gutenberg_text",
        lambda _gutenberg_id, timeout_seconds=60: source_text,
    )

    seen_identifiers: list[str] = []

    def _fake_ocr_page_images(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        sample_identifier = output_path.stem
        seen_identifiers.append(sample_identifier)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if sample_identifier.endswith("sample-001"):
            output_path.write_text(
                "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.",
                encoding="utf-8",
            )
        else:
            output_path.write_text(
                "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda net.",
                encoding="utf-8",
            )
            page_ocr_dir = kwargs["work_dir"] / "page_ocr"
            page_ocr_dir.mkdir(parents=True, exist_ok=True)
            (page_ocr_dir / "page-0001.txt").write_text("failure page text", encoding="utf-8")
            (page_ocr_dir / "manifest.json").write_text(
                json.dumps({"pages": [{"page_index": 1}], "progress": {"status": "complete"}}),
                encoding="utf-8",
            )
        return {
            "page_count": 1,
            "word_count": len(output_path.read_text(encoding="utf-8").split()),
            "character_count": len(output_path.read_text(encoding="utf-8")),
            "mode_usage": {"scan-local-threshold": 1},
            "tesseract_psm_usage": {"6": 1},
            "page_analysis": {
                "page_type_counts": {"front-matter": 1}
                if sample_identifier.endswith("sample-001")
                else {"body": 1},
                "page_quality_tier_counts": {"high": 1}
                if sample_identifier.endswith("sample-001")
                else {"low": 1},
                "page_route_counts": {"front-matter": 1}
                if sample_identifier.endswith("sample-001")
                else {"body-low-quality": 1},
                "front_matter_page_count": 1 if sample_identifier.endswith("sample-001") else 0,
                "front_matter_page_indices": [1] if sample_identifier.endswith("sample-001") else [],
                "low_quality_page_count": 0 if sample_identifier.endswith("sample-001") else 1,
                "low_quality_page_indices": [] if sample_identifier.endswith("sample-001") else [1],
                "targeted_page_retry_count": 1 if sample_identifier.endswith("sample-002") else 0,
                "targeted_page_retry_page_indices": [] if sample_identifier.endswith("sample-001") else [1],
                "targeted_page_retry_reason_counts": {}
                if sample_identifier.endswith("sample-001")
                else {"low-quality": 1},
            },
        }

    monkeypatch.setattr("full_auto_de_pdf.benchmark_corpus.ocr_page_images", _fake_ocr_page_images)
    monotonic_values = iter([0.0, 0.0, 1.0, 2.0, 2.5, 3.0, 5.0, 5.5, 6.0])
    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.time.monotonic",
        lambda: next(monotonic_values),
    )

    report = run_streaming_benchmark_corpus(
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
        cache_dir=tmp_path / "cache",
        books=(book,),
        samples_per_book=2,
        excerpt_word_count=12,
        skip_word_count=0,
        artifact_profiles=("clean",),
        failures_dir=tmp_path / "failures",
        max_recorded_failures=1,
        failure_word_accuracy_below=1.0,
        failure_char_accuracy_below=1.0,
    )

    assert seen_identifiers == ["demo-book-sample-001", "demo-book-sample-002"]
    assert report["summary"]["sample_count"] == 2
    assert report["summary"]["failure_count"] == 1
    assert report["summary"]["recorded_failure_count"] == 1
    assert report["summary"]["avg_low_quality_page_rate"] == 0.5
    assert report["summary"]["avg_front_matter_page_rate"] == 0.5
    assert report["summary"]["avg_targeted_page_retry_rate"] == 0.5
    assert report["summary"]["perfect_word_accuracy_rate"] == 0.5
    assert report["summary"]["worst_word_accuracy"] == 11 / 12
    assert report["summary"]["benchmark_elapsed_seconds"] == 6.0
    assert report["summary"]["total_page_count"] == 2
    assert report["summary"]["total_word_count"] == 24
    total_character_count = sum(sample["character_count"] for sample in report["samples"])
    assert report["summary"]["total_character_count"] == total_character_count
    assert report["summary"]["total_ocr_elapsed_seconds"] == 3.0
    assert report["summary"]["avg_ocr_elapsed_seconds_per_item"] == 1.5
    assert report["summary"]["overall_ocr_pages_per_second"] == 2 / 3
    assert report["summary"]["overall_ocr_words_per_second"] == 8.0
    assert report["summary"]["overall_ocr_characters_per_second"] == total_character_count / 3
    assert report["summary"]["artifact_profile_summary"] == {
        "clean": {
            "item_count": 2,
            "avg_char_accuracy": report["summary"]["avg_char_accuracy"],
            "avg_word_accuracy": report["summary"]["avg_word_accuracy"],
            "avg_unexpected_alpha_token_rate": report["summary"]["avg_unexpected_alpha_token_rate"],
            "perfect_char_accuracy_rate": 0.5,
            "perfect_word_accuracy_rate": 0.5,
            "worst_char_accuracy": report["samples"][1]["char_accuracy"],
            "worst_word_accuracy": 11 / 12,
            "total_page_count": 2,
            "total_word_count": 24,
            "total_character_count": total_character_count,
            "total_ocr_elapsed_seconds": 3.0,
            "avg_ocr_elapsed_seconds_per_item": 1.5,
            "overall_ocr_pages_per_second": 2 / 3,
            "overall_ocr_words_per_second": 8.0,
            "overall_ocr_characters_per_second": total_character_count / 3,
            "failure_count": 1,
        }
    }
    assert report["summary"]["lowest_word_accuracy_items"][0]["identifier"] == "demo-book-sample-002"
    assert report["summary"]["common_unexpected_alpha_tokens"] == [{"token": "net", "count": 1}]
    assert report["summary"]["page_type_counts"] == {"body": 1, "front-matter": 1}
    assert report["summary"]["page_quality_tier_counts"] == {"high": 1, "low": 1}
    assert report["summary"]["page_route_counts"] == {"body-low-quality": 1, "front-matter": 1}
    assert report["summary"]["targeted_page_retry_reason_counts"] == {"low-quality": 1}
    assert report["summary"]["common_failure_patterns"]["substitutions"] == [
        {"reference": "nu.", "hypothesis": "net.", "count": 1}
    ]
    assert report["summary"]["common_failure_patterns"]["missing_tokens"] == []
    assert report["summary"]["common_failure_patterns"]["unexpected_tokens"] == []
    success_artifact_dir = tmp_path / "failures" / "demo-book-sample-001"
    failure_artifact_dir = tmp_path / "failures" / "demo-book-sample-002"
    assert not success_artifact_dir.exists()
    assert failure_artifact_dir.exists()
    assert report["samples"][0]["ocr_elapsed_seconds"] == 1.0
    assert report["samples"][0]["ocr_pages_per_second"] == 1.0
    assert report["samples"][0]["ocr_words_per_second"] == 12.0
    assert report["samples"][0]["ocr_characters_per_second"] == float(
        report["samples"][0]["character_count"]
    )
    assert report["samples"][1]["ocr_elapsed_seconds"] == 2.0
    assert report["samples"][1]["ocr_pages_per_second"] == 0.5
    assert report["samples"][1]["ocr_words_per_second"] == 6.0
    assert report["samples"][1]["ocr_characters_per_second"] == (
        float(report["samples"][1]["character_count"]) / 2.0
    )
    assert (failure_artifact_dir / "reference.txt").exists()
    assert (failure_artifact_dir / "hypothesis.txt").exists()
    assert (failure_artifact_dir / "pages" / "page-0001.png").exists()
    assert (failure_artifact_dir / "page_ocr" / "page-0001.txt").exists()
    assert not any((tmp_path / "work" / "generated").glob("**/*"))
    assert not any((tmp_path / "work" / "ocr").glob("**/*"))


def test_run_streaming_benchmark_corpus_emits_progress_updates(monkeypatch, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    source_text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu."

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.fetch_gutenberg_text",
        lambda _gutenberg_id, timeout_seconds=60: source_text,
    )

    def _fake_ocr_page_images(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(source_text, encoding="utf-8")
        return {"page_count": 1, "word_count": 12, "character_count": len(source_text)}

    monkeypatch.setattr("full_auto_de_pdf.benchmark_corpus.ocr_page_images", _fake_ocr_page_images)
    events: list[dict[str, object]] = []

    run_streaming_benchmark_corpus(
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
        cache_dir=tmp_path / "cache",
        books=(book,),
        samples_per_book=1,
        excerpt_word_count=12,
        skip_word_count=0,
        artifact_profiles=("clean",),
        progress_callback=events.append,
    )

    assert [event["status"] for event in events] == ["running", "running", "complete"]
    assert events[0]["stage"] == "benchmark-streaming-corpus"
    assert events[0]["completed_items"] == 0
    assert events[0]["total_items"] == 1
    assert events[1]["current_identifier"] == "demo-book-sample-001"
    assert events[1]["completed_items"] == 1
    assert events[2]["completed_items"] == 1
    assert events[2]["estimated_remaining_seconds"] == 0.0


def test_benchmark_corpus_helper_guards_and_fallbacks(monkeypatch) -> None:
    monkeypatch.setattr(benchmark_corpus.shutil, "which", lambda name: None)
    assert benchmark_corpus._fontconfig_match("serif") is None

    monkeypatch.setattr(benchmark_corpus.shutil, "which", lambda name: "/usr/bin/fc-match")
    monkeypatch.setattr(
        benchmark_corpus.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=""),
    )
    assert benchmark_corpus._fontconfig_match("serif") is None

    assert benchmark_corpus._extract_excerpt("   ", excerpt_word_count=5, skip_word_count=0) == ""
    fallback_excerpt = benchmark_corpus._extract_excerpt(
        "Alpha beta gamma.\n\nDelta epsilon zeta.",
        excerpt_word_count=5,
        skip_word_count=99,
    )
    assert fallback_excerpt == "Alpha beta gamma.\n\nDelta epsilon zeta."
    many_paragraphs = "\n\n".join(f"word{i} alpha beta" for i in range(100))
    assert benchmark_corpus._extract_excerpt(
        many_paragraphs,
        excerpt_word_count=10,
        skip_word_count=999,
    ).count("\n\n") < 99

    monkeypatch.setattr(benchmark_corpus, "ImageFont", None)
    with pytest.raises(RuntimeError, match="Missing dependency for corpus rendering: pillow"):
        benchmark_corpus._resolve_font(None, 12)

    fake_font_module = SimpleNamespace(
        truetype=lambda *args, **kwargs: "truetype-font",
        load_default=lambda: "default-font",
    )
    monkeypatch.setattr(benchmark_corpus, "ImageFont", fake_font_module)
    monkeypatch.setattr(benchmark_corpus, "_fontconfig_match", lambda family: None)
    monkeypatch.setattr(benchmark_corpus, "_DEFAULT_FONT_CANDIDATES", ("",))
    assert benchmark_corpus._resolve_font(None, 12) == (
        "default-font",
        "Pillow default bitmap font",
    )

    assert benchmark_corpus._wrap_paragraph(None, None, "", 100) == [""]
    assert benchmark_corpus._normalize_artifact_profiles([" ", ""]) == ("clean",)
    with pytest.raises(ValueError, match="artifact_profiles must be chosen from"):
        benchmark_corpus._normalize_artifact_profiles(("clean", "bogus"))

    monkeypatch.setattr(benchmark_corpus, "Image", None)
    assert benchmark_corpus._resampling_filter("BILINEAR") is None


def test_benchmark_corpus_rendering_helpers_cover_guard_paths(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(benchmark_corpus, "Image", None)
    with pytest.raises(RuntimeError, match="pillow is required for artifact rendering"):
        benchmark_corpus._noise_texture((10, 10), benchmark_corpus.random.Random(1), 1)
    with pytest.raises(RuntimeError, match="pillow is required for artifact rendering"):
        benchmark_corpus._gradient_mask((10, 10), benchmark_corpus.random.Random(1), 1)

    monkeypatch.setattr(benchmark_corpus, "ImageChops", None)
    with pytest.raises(RuntimeError, match="pillow is required for artifact rendering"):
        benchmark_corpus._paper_texture((10, 10), benchmark_corpus.random.Random(1), 1)

    monkeypatch.setattr(benchmark_corpus, "ImageFilter", None)
    with pytest.raises(RuntimeError, match="pillow is required for artifact rendering"):
        benchmark_corpus._edge_shadow_mask((10, 10), benchmark_corpus.random.Random(1), 1)
    with pytest.raises(RuntimeError, match="pillow is required for artifact rendering"):
        benchmark_corpus._speckle_mask((10, 10), benchmark_corpus.random.Random(1), 1)

    monkeypatch.setattr(benchmark_corpus, "ImageDraw", None)
    with pytest.raises(RuntimeError, match="Missing dependency for corpus rendering: pillow"):
        benchmark_corpus._render_page_images(
            "Alpha beta gamma",
            tmp_path / "rendered",
            font_path=None,
            font_size=12,
            page_width=100,
            page_height=100,
            margin=5,
            artifact_profile="clean",
            artifact_seed=0,
        )

    with pytest.raises(RuntimeError, match="Missing dependency for corpus rendering: pillow"):
        benchmark_corpus._apply_scan_artifacts(Image.new("L", (10, 10), color=255), "scan-photocopy", 1)

    with pytest.raises(RuntimeError, match="Missing dependency for corpus rendering: pillow"):
        benchmark_corpus._write_pdf([], tmp_path / "output.pdf")


def test_benchmark_corpus_rendering_helpers_cover_scan_extreme_and_rollover(tmp_path) -> None:
    page_image = Image.new("L", (120, 120), color=255)
    processed = benchmark_corpus._apply_scan_artifacts(page_image, "scan-extreme", 7)
    assert processed.size == page_image.size

    excerpt = "\n\n".join(
        [
            "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.",
            "Nu xi omicron pi rho sigma tau upsilon phi chi psi omega.",
            "More words to force a second page with a very small canvas height.",
        ]
    )
    page_paths, resolved_font_path = benchmark_corpus._render_page_images(
        excerpt,
        tmp_path / "rendered",
        font_path=None,
        font_size=14,
        page_width=180,
        page_height=80,
        margin=8,
        artifact_profile="clean",
        artifact_seed=0,
    )
    assert len(page_paths) >= 2
    assert resolved_font_path


def test_benchmark_corpus_counter_and_failure_helpers(monkeypatch, tmp_path) -> None:
    assert benchmark_corpus._safe_rate(3, 0) == 0.0
    assert benchmark_corpus._string_counter_from_mapping(
        {1: 2, "alpha": True, "beta": 3, "gamma": 4.0, "delta": 2.5}
    ) == Counter({"gamma": 4, "beta": 3})

    assert benchmark_corpus._iter_streaming_excerpts(
        "Alpha beta gamma.",
        excerpt_word_count=10,
        skip_word_count=0,
        samples_per_book=3,
    ) == [(1, 0, "Alpha beta gamma.")]

    substitution_counter: Counter[tuple[str, str]] = Counter()
    missing_counter: Counter[str] = Counter()
    unexpected_counter: Counter[str] = Counter()
    benchmark_corpus._update_token_failure_counters(
        "alpha beta",
        "alpha",
        substitution_counter=substitution_counter,
        missing_counter=missing_counter,
        unexpected_counter=unexpected_counter,
    )
    benchmark_corpus._update_token_failure_counters(
        "alpha",
        "alpha beta",
        substitution_counter=substitution_counter,
        missing_counter=missing_counter,
        unexpected_counter=unexpected_counter,
    )
    assert missing_counter == Counter({"beta": 1})
    assert unexpected_counter == Counter({"beta": 1})

    failure_dir = tmp_path / "failure"
    failure_dir.mkdir()
    monkeypatch.setattr(benchmark_corpus.shutil, "rmtree", lambda path, ignore_errors=True: None)
    with pytest.raises(RuntimeError, match="could not clear existing failure artifact directory"):
        benchmark_corpus._record_streaming_failure_artifacts(
            sample_dir=tmp_path / "sample",
            ocr_work_dir=tmp_path / "ocr",
            failure_dir=failure_dir,
            reference_text="reference",
            hypothesis_text="hypothesis",
            metadata={"identifier": "demo"},
        )


def test_build_image_text_corpus_manifest_limit_and_empty_match_errors(tmp_path) -> None:
    images_dir = tmp_path / "images"
    texts_dir = tmp_path / "texts"
    images_dir.mkdir()
    texts_dir.mkdir()
    _write_test_image(images_dir / "a006.tiff")
    (texts_dir / "a006.txt").write_text("Ground truth text", encoding="utf-8")

    with pytest.raises(ValueError, match="no matching image/text pairs"):
        build_image_text_corpus_manifest(
            output_manifest_path=tmp_path / "manifest.json",
            images_dir=images_dir,
            texts_dir=texts_dir,
            limit=0,
        )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"excerpt_word_count": 0}, "excerpt_word_count must be greater than 0"),
        ({"skip_word_count": -1}, "skip_word_count must be zero or greater"),
        ({"books": ()}, "build_benchmark_corpus requires at least one book"),
    ],
)
def test_build_benchmark_corpus_validates_inputs(kwargs, message, tmp_path) -> None:
    with pytest.raises(ValueError, match=message):
        build_benchmark_corpus(
            output_dir=tmp_path / "corpus",
            cache_dir=tmp_path / "cache",
            **kwargs,
        )


def test_run_benchmark_corpus_validates_manifest_and_skips_non_dict_books(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    page_path = tmp_path / "page-1.png"
    _write_test_image(page_path)

    empty_manifest_path = tmp_path / "empty-manifest.json"
    empty_manifest_path.write_text(json.dumps({"books": []}), encoding="utf-8")
    with pytest.raises(ValueError, match="corpus manifest did not include any books"):
        run_benchmark_corpus(
            corpus_manifest_path=empty_manifest_path,
            output_report_path=tmp_path / "empty-report.json",
            work_dir=tmp_path / "empty-work",
        )

    mixed_manifest_path = tmp_path / "mixed-manifest.json"
    mixed_manifest_path.write_text(
        json.dumps(
            {
                "books": [
                    "skip-me",
                    {
                        "identifier": "demo-book",
                        "title": "Demo Book",
                        "reference_text_path": str(reference_path),
                        "page_image_paths": [str(page_path)],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_ocr_page_images(**kwargs):  # noqa: ANN003
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("clean printed text", encoding="utf-8")
        return {
            "page_count": 1,
            "word_count": 3,
            "character_count": 18,
        }

    monkeypatch.setattr(benchmark_corpus, "ocr_page_images", _fake_ocr_page_images)
    report = run_benchmark_corpus(
        corpus_manifest_path=mixed_manifest_path,
        output_report_path=tmp_path / "report.json",
        work_dir=tmp_path / "work",
    )
    assert [book["identifier"] for book in report["books"]] == ["demo-book"]


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"excerpt_word_count": 0}, "excerpt_word_count must be greater than 0"),
        ({"skip_word_count": -1}, "skip_word_count must be zero or greater"),
        ({"samples_per_book": 0}, "samples_per_book must be greater than 0"),
        ({"max_recorded_failures": -1}, "max_recorded_failures must be zero or greater"),
        (
            {"failure_word_accuracy_below": 1.5},
            "failure_word_accuracy_below must be between 0.0 and 1.0",
        ),
        (
            {"failure_char_accuracy_below": -0.1},
            "failure_char_accuracy_below must be between 0.0 and 1.0",
        ),
    ],
)
def test_run_streaming_benchmark_corpus_validates_inputs(kwargs, message, tmp_path) -> None:
    book = BenchmarkBook("demo-book", "Demo Book", 123)
    with pytest.raises(ValueError, match=message):
        run_streaming_benchmark_corpus(
            output_report_path=tmp_path / "report.json",
            work_dir=tmp_path / "work",
            cache_dir=tmp_path / "cache",
            books=(book,),
            **kwargs,
        )


def test_run_streaming_benchmark_corpus_requires_books_and_pdf_paths(tmp_path) -> None:
    with pytest.raises(ValueError, match="run_streaming_benchmark_corpus requires at least one book"):
        run_streaming_benchmark_corpus(
            output_report_path=tmp_path / "report.json",
            work_dir=tmp_path / "work",
            cache_dir=tmp_path / "cache",
            books=(),
        )

    with pytest.raises(ValueError, match="did not include page_image_paths or a pdf_path"):
        benchmark_corpus._require_pdf_path(None, "demo-book")
