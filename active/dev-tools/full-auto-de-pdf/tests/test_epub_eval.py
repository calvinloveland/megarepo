from full_auto_de_pdf.epub import build_epub_from_ocr_text
from full_auto_de_pdf.epub_eval import evaluate_epub_structure


def test_evaluate_epub_structure_reports_expected_fields(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    build_epub_from_ocr_text(
        "Chapter start.\n\nMore text.",
        output_path=epub_path,
        title="Eval Book",
    )
    report = evaluate_epub_structure(epub_path, run_epubcheck=False)
    assert report["checks"]["has_mimetype"] is True
    assert report["checks"]["has_opf"] is True
    assert report["checks"]["reading_order_valid"] is True
    assert report["metrics"]["toc_entry_count"] >= 1
    assert report["epubcheck"]["status"] == "skipped"


def test_evaluate_epub_structure_handles_missing_epubcheck(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    build_epub_from_ocr_text("Text", output_path=epub_path, title="Eval Book")
    report = evaluate_epub_structure(
        epub_path,
        run_epubcheck=True,
        epubcheck_cmd="nonexistent-epubcheck-cmd",
    )
    assert report["epubcheck"]["status"] == "unavailable"


def test_evaluate_epub_structure_with_reference_headings(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    reference_path = tmp_path / "headings.txt"
    build_epub_from_ocr_text(
        "Chapter start.\n\nMore text.",
        output_path=epub_path,
        title="Eval Book",
    )
    reference_path.write_text("Eval Book\nChapter One\n", encoding="utf-8")
    report = evaluate_epub_structure(
        epub_path,
        run_epubcheck=False,
        reference_headings_path=reference_path,
    )
    heading_eval = report["heading_sequence_eval"]
    assert heading_eval["reference_count"] == 2
    assert heading_eval["extracted_count"] >= 1
    assert "sequence_ratio" in heading_eval
