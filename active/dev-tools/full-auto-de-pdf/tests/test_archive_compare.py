import shutil

from full_auto_de_pdf.archive_compare import build_archive_epub_compare_page
from full_auto_de_pdf.epub import build_epub_from_ocr_text


def test_build_archive_epub_compare_page_writes_html(monkeypatch, tmp_path) -> None:
    source_epub = tmp_path / "source.epub"
    build_epub_from_ocr_text(
        ocr_text=(
            "Chapter 1\n\n"
            "Archive paragraph with several matching words for the aligned section.\n\n"
            "Another archive paragraph continues the same section with more matching words."
        ),
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
        assert timeout_seconds == 15
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if filename == "demo-book.epub":
            shutil.copy2(source_epub, output_path)
        else:
            output_path.write_bytes(b"%PDF-1.4\nfake\n")
        return output_path

    def _fake_fetch_archive_ocr_text(identifier: str, timeout_seconds: int = 60) -> str:
        assert identifier == "demo-book"
        assert timeout_seconds == 15
        return (
            "CHAPTER I\n\n"
            "Generated paragraph with several matching words for the aligned section.\n\n"
            "Second generated paragraph continues the same section with more matching words."
        )

    def _fake_extract_pdf_page_texts(pdf_path, max_pages=40):  # noqa: ANN001
        assert pdf_path.name == "demo-book.pdf"
        assert max_pages == 40
        return [
                {
                    "page_number": 7,
                    "text": (
                        "Archive paragraph with several matching words for the aligned section "
                        "another archive paragraph continues the same section with more matching words "
                        "generated paragraph with several matching words for the aligned section"
                    ),
                }
            ]

    def _fake_render_pdf_page_image(pdf_path, page_number, output_path):  # noqa: ANN001
        assert pdf_path.name == "demo-book.pdf"
        assert page_number == 7
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"fake-image")
        return output_path

    monkeypatch.setattr("full_auto_de_pdf.archive_compare.fetch_metadata", _fake_fetch_metadata)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._download_archive_file", _fake_download_archive_file)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare.fetch_archive_ocr_text", _fake_fetch_archive_ocr_text)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._extract_pdf_page_texts", _fake_extract_pdf_page_texts)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._render_pdf_page_image", _fake_render_pdf_page_image)

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
    assert "Aligned scanned page and EPUB excerpts" in html
    assert "Archive scan page 7" in html
    assert "Internet Archive EPUB excerpt" in html
    assert "Generated EPUB excerpt" in html
    assert (tmp_path / "compare_assets" / "compare_summary.json").exists()
