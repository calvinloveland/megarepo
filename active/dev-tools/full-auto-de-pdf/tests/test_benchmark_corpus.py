import json
from pathlib import Path

from full_auto_de_pdf.benchmark import BenchmarkBook
from full_auto_de_pdf.benchmark_corpus import build_benchmark_corpus, run_benchmark_corpus


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
    assert report["books"][0]["mode_usage"] == {"auto": 1}


def test_run_benchmark_corpus_prefers_page_images_when_available(monkeypatch, tmp_path) -> None:
    reference_path = tmp_path / "reference.txt"
    reference_path.write_text("clean printed text", encoding="utf-8")
    pdf_path = tmp_path / "synthetic.pdf"
    pdf_path.write_bytes(b"fake-pdf")
    page_path = tmp_path / "page-1.png"
    page_path.write_bytes(b"fake-image")
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
