import shutil

from full_auto_de_pdf.archive_compare import build_archive_epub_compare_page
from full_auto_de_pdf.epub import build_epub_from_ocr_text


def test_build_archive_epub_compare_page_writes_html(monkeypatch, tmp_path) -> None:
    source_epub = tmp_path / "source.epub"
    build_epub_from_ocr_text(
        ocr_text="Chapter 1\n\nArchive paragraph.\n\nAnother archive paragraph.",
        output_path=source_epub,
        title="Archive Example",
    )

    def _fake_fetch_metadata(identifier: str, timeout_seconds: int = 60):  # noqa: ANN001
        assert identifier == "demo-book"
        assert timeout_seconds == 15
        return {
            "metadata": {"title": "Archive Example", "language": "eng"},
            "files": [
                {"name": "demo-book.epub"},
                {"name": "demo-book.pdf"},
            ],
        }

    def _fake_download_archive_file(identifier, filename, output_path, timeout_seconds):  # noqa: ANN001
        assert identifier == "demo-book"
        assert filename == "demo-book.epub"
        assert timeout_seconds == 15
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_epub, output_path)
        return output_path

    def _fake_fetch_archive_ocr_text(identifier: str, timeout_seconds: int = 60) -> str:
        assert identifier == "demo-book"
        assert timeout_seconds == 15
        return "CHAPTER I\n\nGenerated paragraph.\n\nSecond generated paragraph."

    monkeypatch.setattr("full_auto_de_pdf.archive_compare.fetch_metadata", _fake_fetch_metadata)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._download_archive_file", _fake_download_archive_file)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare.fetch_archive_ocr_text", _fake_fetch_archive_ocr_text)

    output_html = tmp_path / "compare.html"
    summary = build_archive_epub_compare_page(
        archive_identifier="demo-book",
        output_html_path=output_html,
        archive_source_mode="djvu",
        timeout_seconds=15,
        run_epubcheck=False,
    )

    html = output_html.read_text(encoding="utf-8")
    assert summary["archive_source"] == "djvu"
    assert "Archive Example" in html
    assert "Internet Archive EPUB vs generated EPUB" in html
    assert "Downloaded Internet Archive EPUB" in html
    assert "Generated EPUB" in html
    assert "Source OCR text used for generation" in html
    assert (tmp_path / "compare_assets" / "compare_summary.json").exists()
