import json
from pathlib import Path

from PIL import Image
import pytest

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
        artifact_profiles=("clean", "scan-heavy"),
        artifact_seed=11,
    )

    assert manifest["book_count"] == 2
    clean_book = next(item for item in manifest["books"] if item["artifact_profile"] == "clean")
    heavy_book = next(item for item in manifest["books"] if item["artifact_profile"] == "scan-heavy")
    assert clean_book["identifier"] == "demo-book"
    assert heavy_book["identifier"] == "demo-book-scan-heavy"
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
        }

    monkeypatch.setattr(
        "full_auto_de_pdf.benchmark_corpus.ocr_pdf_with_tesseract",
        _fake_ocr_pdf_with_tesseract,
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
    assert report["summary"]["avg_unexpected_alpha_token_rate"] == 0.0
    assert report["summary"]["common_unexpected_alpha_tokens"] == []
    assert report["books"][0]["mode_usage"] == {"auto": 1}
    assert "synthetic printed PDFs" in report["metric_note"]


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
        }

    monkeypatch.setattr("full_auto_de_pdf.benchmark_corpus.ocr_page_images", _fake_ocr_page_images)

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
    assert report["summary"]["common_unexpected_alpha_tokens"] == [{"token": "net", "count": 1}]
    assert report["summary"]["common_failure_patterns"]["substitutions"] == [
        {"reference": "nu.", "hypothesis": "net.", "count": 1}
    ]
    assert report["summary"]["common_failure_patterns"]["missing_tokens"] == []
    assert report["summary"]["common_failure_patterns"]["unexpected_tokens"] == []
    success_artifact_dir = tmp_path / "failures" / "demo-book-sample-001"
    failure_artifact_dir = tmp_path / "failures" / "demo-book-sample-002"
    assert not success_artifact_dir.exists()
    assert failure_artifact_dir.exists()
    assert (failure_artifact_dir / "reference.txt").exists()
    assert (failure_artifact_dir / "hypothesis.txt").exists()
    assert (failure_artifact_dir / "pages" / "page-0001.png").exists()
    assert (failure_artifact_dir / "page_ocr" / "page-0001.txt").exists()
    assert not any((tmp_path / "work" / "generated").glob("**/*"))
    assert not any((tmp_path / "work" / "ocr").glob("**/*"))
