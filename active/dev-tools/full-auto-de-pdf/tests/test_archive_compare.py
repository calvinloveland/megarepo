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

    def _fake_ocr_pdf_with_tesseract(pdf_path, output_text_path, work_dir, **kwargs):  # noqa: ANN001
        assert pdf_path.name == "demo-book.pdf"
        assert output_text_path == tmp_path / "compare_assets" / "demo-book_local_ocr.txt"
        assert work_dir == tmp_path / "compare_assets" / "generated" / "local_ocr_work"
        assert kwargs == {
            "language": "eng",
            "dpi": 300,
            "apply_cleanup": True,
            "preprocess_mode": "auto",
            "binarize_threshold": 190,
            "deskew_max_angle": 3.0,
            "deskew_angle_step": 0.5,
            "tesseract_psm": "auto",
            "ocr_engine": "tesseract",
            "emit_page_artifacts": True,
            "page_artifacts_dir": tmp_path / "compare_assets" / "page_ocr",
            "inverse_render_rerank": True,
            "inverse_render_top_k": 3,
            "inverse_render_workers": 1,
            "verify_cleanup_spans": True,
            "progress_callback": None,
        }
        output_text_path.write_text(
            "CHAPTER I\n\n"
            "Generated paragraph with several matching words for the aligned section.\n\n"
            "Second generated paragraph continues the same section with more matching words.",
            encoding="utf-8",
        )
        manifest_path = tmp_path / "compare_assets" / "page_ocr" / "manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text("{}", encoding="utf-8")
        return {
            "page_count": 2,
            "word_count": 23,
            "character_count": 160,
            "mode_usage": {"scan": 2},
            "tesseract_psm_usage": {"6": 2},
            "page_artifacts_manifest": str(manifest_path),
        }

    rendered_pages = []

    def _fake_extract_pdf_page_texts(pdf_path, max_pages=40, include_page_numbers=()):  # noqa: ANN001
        assert pdf_path.name == "demo-book.pdf"
        assert max_pages == 40
        assert include_page_numbers == (12,)
        return [
            {
                "page_number": 7,
                "text": (
                    "Archive paragraph with several matching words for the aligned section "
                    "another archive paragraph continues the same section with more matching words "
                    "generated paragraph with several matching words for the aligned section"
                ),
            },
            {
                "page_number": 12,
                "text": (
                    "Generated paragraph with several matching words for the aligned section "
                    "second generated paragraph continues the same section with more matching words "
                    "archive paragraph with several matching words for the aligned section"
                ),
            },
        ]

    def _fake_render_pdf_page_image(pdf_path, page_number, output_path):  # noqa: ANN001
        assert pdf_path.name == "demo-book.pdf"
        rendered_pages.append(page_number)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"fake-image")
        return output_path

    monkeypatch.setattr("full_auto_de_pdf.archive_compare.fetch_metadata", _fake_fetch_metadata)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._download_archive_file", _fake_download_archive_file)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare.ocr_pdf_with_tesseract", _fake_ocr_pdf_with_tesseract)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._extract_pdf_page_texts", _fake_extract_pdf_page_texts)
    monkeypatch.setattr("full_auto_de_pdf.archive_compare._render_pdf_page_image", _fake_render_pdf_page_image)

    output_html = tmp_path / "compare.html"
    summary = build_archive_epub_compare_page(
        archive_identifier="demo-book",
        output_html_path=output_html,
        archive_source_mode="djvu",
        timeout_seconds=15,
        run_epubcheck=False,
        selected_pdf_page=12,
    )

    html = output_html.read_text(encoding="utf-8")
    assert summary["generated_source"] == "local-ocr"
    assert summary["selected_pdf_page"] == 12
    assert "Archive Example" in html
    assert "Internet Archive EPUB vs generated EPUB" in html
    assert "Downloaded Internet Archive EPUB" in html
    assert "Generated EPUB" in html
    assert "Local OCR text used for generation" in html
    assert "generated_from=<code>local OCR on archive PDF</code>" in html
    assert "local OCR page artifacts manifest" in html
    assert "selected preprocess usage" in html
    assert "Aligned scanned page and EPUB excerpts" in html
    assert "Archive scan page 12" in html
    assert "Internet Archive EPUB excerpt" in html
    assert "Generated EPUB excerpt" in html
    assert "selected_pdf_page=<code>12</code>" in html
    assert "Random page" in html
    assert "id='aligned-page-select'" in html
    assert "compare_assets/aligned_page_0007.png" in html
    assert "compare_assets/aligned_page_0012.png" in html
    assert sorted(rendered_pages) == [7, 12]
    assert (tmp_path / "compare_assets" / "compare_summary.json").exists()
