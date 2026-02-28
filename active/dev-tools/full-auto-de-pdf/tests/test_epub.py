import json
import zipfile

from full_auto_de_pdf.epub import build_epub_from_ocr_file, build_epub_from_ocr_text


def test_build_epub_from_ocr_text_creates_required_epub_entries(tmp_path) -> None:
    output_epub = tmp_path / "book.epub"
    metrics = build_epub_from_ocr_text(
        "First paragraph.\n\nSecond paragraph.",
        output_path=output_epub,
        title="Example Title",
    )

    assert metrics["paragraph_count"] == 2
    assert metrics["word_count"] == 4
    with zipfile.ZipFile(output_epub) as epub_file:
        names = epub_file.namelist()
        assert names[0] == "mimetype"
        assert "META-INF/container.xml" in names
        assert "OEBPS/content.opf" in names
        assert "OEBPS/nav.xhtml" in names
        assert "OEBPS/chapter1.xhtml" in names


def test_build_epub_from_ocr_file_writes_metrics(tmp_path) -> None:
    ocr_text = tmp_path / "ocr.txt"
    output_epub = tmp_path / "book.epub"
    metrics_path = tmp_path / "metrics.json"
    ocr_text.write_text("One line only.", encoding="utf-8")

    metrics = build_epub_from_ocr_file(
        ocr_text_path=ocr_text,
        output_epub_path=output_epub,
        metrics_output_path=metrics_path,
        title="Demo",
    )

    assert output_epub.exists()
    assert metrics["word_count"] == 3
    parsed_metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert parsed_metrics["character_count"] == len("One line only.")
