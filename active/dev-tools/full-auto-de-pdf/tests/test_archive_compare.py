import shutil
from types import SimpleNamespace

import full_auto_de_pdf.archive_compare as archive_compare
import pytest
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
            "inverse_render_rerank": False,
            "inverse_render_top_k": 3,
            "inverse_render_workers": 1,
            "verify_cleanup_spans": False,
            "llm_suspicious_sections": False,
            "llm_suspicious_max_candidates": 12,
            "llm_suspicious_max_sections": 6,
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
            "suspicious_sections": {
                "status": "applied",
                "sections": [
                    {
                        "page_index": 12,
                        "llm_confidence": "high",
                        "llm_reason": "garbled punctuation cluster needs review",
                        "focus_spans": ["frontier--f)(')r"],
                        "excerpt": "The frontier--f)(')r pass looked suspicious.",
                    }
                ],
            },
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
    assert "Suspicious generated sections" in html
    assert "garbled punctuation cluster needs review" in html
    assert "frontier--f)(&#x27;)r" in html
    assert "selected_pdf_page=<code>12</code>" in html
    assert "Random page" in html
    assert "id='aligned-page-select'" in html
    assert "compare_assets/aligned_page_0007.png" in html
    assert "compare_assets/aligned_page_0012.png" in html
    assert sorted(rendered_pages) == [7, 12]
    assert (tmp_path / "compare_assets" / "compare_summary.json").exists()


def test_archive_compare_basic_helper_edges(monkeypatch, tmp_path) -> None:
    assert archive_compare._extract_first_string([" ", [" nested "], None]) == "nested"
    assert archive_compare._normalize_language("unknown") == "unknown"
    assert archive_compare._normalize_ocr_language(None) == "eng"
    assert archive_compare._normalized_files({"files": "not-a-list"}) == []
    assert archive_compare._select_archive_filename([], ".epub") is None
    assert archive_compare._select_archive_filename(
        [{"name": "book-long.epub"}, {"name": "a.epub"}],
        ".epub",
    ) == "a.epub"

    output_path = tmp_path / "downloaded.bin"

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return b"payload"

    monkeypatch.setattr(archive_compare, "urlopen", lambda url, timeout=60: _Response())
    assert archive_compare._download_archive_file("demo", "file.bin", output_path, 15) == output_path
    assert output_path.read_bytes() == b"payload"

    assert archive_compare._read_xhtml_text("<p>alpha</p><li>beta</li>") == ["alpha beta"]
    assert archive_compare._read_xhtml_text("<p>unterminated") == ["unterminated"]

    assert archive_compare._spine_xhtml_paths({"manifest_items": [], "spine_ids": []}) == []
    assert archive_compare._spine_xhtml_paths(
        {
            "manifest_items": {"chap-1": {"href": "chapter1.xhtml"}, "chap-2": "bad"},
            "spine_ids": ["chap-1", "chap-2"],
            "names": {"chapter1.xhtml"},
        }
    ) == ["chapter1.xhtml"]

    class _WeirdParagraphs(list):
        def __getitem__(self, item):  # noqa: ANN001
            if isinstance(item, slice):
                return []
            return super().__getitem__(item)

    assert archive_compare._paragraph_windows(_WeirdParagraphs(["alpha beta gamma delta epsilon zeta"])) == []
    assert archive_compare._paragraph_windows(["one two three"]) == []
    assert archive_compare._trim_words("one two three", max_words=10) == "one two three"
    assert archive_compare._trim_words("one two three four", max_words=3) == "one two three ..."
    assert archive_compare._overlap_score(set(), {"alpha"}) == 0.0
    assert archive_compare._best_window_match({"alpha"}, [{"tokens": "bad"}]) is None
    assert archive_compare._metric_value({"metrics": []}, "structure_score") == "n/a"
    assert archive_compare._render_preview_list([], "Nothing here.") == "<p>Nothing here.</p>"


def test_archive_compare_pdf_and_alignment_helper_edges(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\nfake\n")

    monkeypatch.setattr(
        archive_compare.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout="Title: Demo\n"),
    )
    with pytest.raises(ValueError, match="Unable to determine page count"):
        archive_compare._pdf_page_count(pdf_path)

    monkeypatch.setattr(
        archive_compare.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout="Pages: 7\n"),
    )
    assert archive_compare._pdf_page_count(pdf_path) == 7

    monkeypatch.setattr(archive_compare, "_pdf_page_count", lambda path: 2)

    def _fake_run(*args, **kwargs):  # noqa: ANN002,ANN003
        page_number = int(args[0][3])
        if page_number == 1:
            return SimpleNamespace(stdout="tiny")
        return SimpleNamespace(stdout="alpha beta gamma delta epsilon zeta eta theta")

    monkeypatch.setattr(archive_compare.subprocess, "run", _fake_run)
    pages = archive_compare._extract_pdf_page_texts(pdf_path, max_pages=1, include_page_numbers=(2,))
    assert pages == [{"page_number": 2, "text": "alpha beta gamma delta epsilon zeta eta theta"}]

    with pytest.raises(ValueError, match="out of range 1..2"):
        archive_compare._extract_pdf_page_texts(pdf_path, include_page_numbers=(3,))

    rendered_path = tmp_path / "page.png"
    monkeypatch.setattr(archive_compare.subprocess, "run", lambda *args, **kwargs: None)
    with pytest.raises(ValueError, match="Expected rendered page image"):
        archive_compare._render_pdf_page_image(pdf_path, 1, rendered_path)

    def _fake_render_run(*args, **kwargs):  # noqa: ANN002,ANN003
        rendered_path.with_name("page.png").write_bytes(b"png")
        return None

    monkeypatch.setattr(archive_compare.subprocess, "run", _fake_render_run)
    assert archive_compare._render_pdf_page_image(pdf_path, 1, rendered_path) == rendered_path

    monkeypatch.setattr(archive_compare, "_epub_paragraphs", lambda path: [])
    assert archive_compare._build_aligned_section(
        archive_pdf_path=pdf_path,
        archive_epub_path=tmp_path / "archive.epub",
        generated_epub_path=tmp_path / "generated.epub",
        image_output_dir=tmp_path / "images",
        href_base_dir=tmp_path,
    ) is None

    monkeypatch.setattr(
        archive_compare,
        "_epub_paragraphs",
        lambda path: ["alpha beta gamma delta epsilon zeta eta theta"],
    )
    monkeypatch.setattr(
        archive_compare,
        "_extract_pdf_page_texts",
        lambda *args, **kwargs: [{"page_number": 1, "text": "tiny"}],
    )
    assert archive_compare._build_aligned_section(
        archive_pdf_path=pdf_path,
        archive_epub_path=tmp_path / "archive.epub",
        generated_epub_path=tmp_path / "generated.epub",
        image_output_dir=tmp_path / "images",
        href_base_dir=tmp_path,
    ) is None

    monkeypatch.setattr(
        archive_compare,
        "_extract_pdf_page_texts",
        lambda *args, **kwargs: [{"page_number": 1, "text": "alpha beta gamma delta epsilon zeta eta theta"}],
    )
    monkeypatch.setattr(
        archive_compare,
        "_best_window_match",
        lambda page_tokens, windows: {"text": "match", "start_index": 0, "score": 1.0}
        if page_tokens
        else None,
    )
    monkeypatch.setattr(
        archive_compare,
        "_render_pdf_page_image",
        lambda pdf_path, page_number, output_path: output_path,
    )
    with pytest.raises(ValueError, match="could not be aligned"):
        archive_compare._build_aligned_section(
            archive_pdf_path=pdf_path,
            archive_epub_path=tmp_path / "archive.epub",
            generated_epub_path=tmp_path / "generated.epub",
            image_output_dir=tmp_path / "images",
            href_base_dir=tmp_path,
            selected_page_number=2,
        )

    monkeypatch.setattr(
        archive_compare,
        "_best_window_match",
        lambda page_tokens, windows: None if windows else {"text": "match", "start_index": 0, "score": 1.0},
    )
    assert archive_compare._build_aligned_section(
        archive_pdf_path=pdf_path,
        archive_epub_path=tmp_path / "archive.epub",
        generated_epub_path=tmp_path / "generated.epub",
        image_output_dir=tmp_path / "images",
        href_base_dir=tmp_path,
    ) is None


def test_archive_compare_render_helper_edges() -> None:
    assert archive_compare._render_generated_source_details({}) == ""
    assert "archive OCR source" in archive_compare._render_generated_source_details(
        {
            "generated_from": "archive djvu OCR text",
            "generated_source_details": {"type": "archive-ocr", "archive_source_mode": "djvu"},
        }
    )
    assert archive_compare._render_suspicious_sections({}) == ""
    assert archive_compare._render_suspicious_sections(
        {"generated_source_details": {"ocr_metrics": "bad"}}
    ) == ""
    assert archive_compare._render_suspicious_sections(
        {"generated_source_details": {"ocr_metrics": {"suspicious_sections": "bad"}}}
    ) == ""
    assert "flagged_sections=<code>0</code>" in archive_compare._render_suspicious_sections(
        {"generated_source_details": {"ocr_metrics": {"suspicious_sections": {"status": "applied"}}}}
    )
    rendered = archive_compare._render_suspicious_sections(
        {
            "generated_source_details": {
                "ocr_metrics": {
                    "suspicious_sections": {
                        "status": "applied",
                        "sections": [
                            "skip-me",
                            {"page_index": 3, "excerpt": "alpha", "focus_spans": ["beta"]},
                        ],
                    }
                }
            }
        }
    )
    assert "flagged_sections=<code>1</code>" in rendered
    assert "Page 3" in rendered
    assert "No aligned scanned-page section could be extracted automatically." in archive_compare._render_aligned_section(
        {}
    )
    assert "No aligned scanned-page section could be extracted automatically." in archive_compare._render_aligned_section(
        {"aligned_section": {"pages": []}}
    )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"generated_source": "bad"}, "generated_source must be one of"),
        ({"archive_source_mode": "bad"}, "archive_source_mode must be one of"),
        ({"selected_pdf_page": 0}, "selected_pdf_page must be greater than or equal to 1"),
    ],
)
def test_build_archive_compare_page_validates_inputs(kwargs, message, tmp_path) -> None:
    with pytest.raises(ValueError, match=message):
        build_archive_epub_compare_page(
            archive_identifier="demo-book",
            output_html_path=tmp_path / "compare.html",
            **kwargs,
        )


def test_build_archive_compare_page_requires_epub_and_pdf_inputs(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        archive_compare,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {"metadata": {}, "files": [{"name": "demo-book.pdf"}]},
    )
    with pytest.raises(ValueError, match="does not provide an EPUB download"):
        build_archive_epub_compare_page(
            archive_identifier="demo-book",
            output_html_path=tmp_path / "compare.html",
        )

    monkeypatch.setattr(
        archive_compare,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {"metadata": {}, "files": [{"name": "demo-book.epub"}]},
    )

    def _fake_download_file(identifier, filename, output_path, timeout_seconds):  # noqa: ANN001
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"fake")
        return output_path

    monkeypatch.setattr(archive_compare, "_download_archive_file", _fake_download_file)
    with pytest.raises(ValueError, match="does not provide a PDF needed for local OCR generation"):
        build_archive_epub_compare_page(
            archive_identifier="demo-book",
            output_html_path=tmp_path / "compare.html",
        )


def test_build_archive_compare_page_archive_ocr_edges(monkeypatch, tmp_path) -> None:
    source_epub = tmp_path / "source.epub"
    build_epub_from_ocr_text(
        ocr_text="Archive paragraph with several matching words.\n\nAnother matching paragraph.",
        output_path=source_epub,
        title="Archive Example",
    )

    monkeypatch.setattr(
        archive_compare,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {
            "metadata": {"title": "Archive Example", "language": "english"},
            "files": [{"name": "demo-book.epub"}],
        },
    )

    def _fake_download(identifier, filename, output_path, timeout_seconds):  # noqa: ANN001
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_epub, output_path)
        return output_path

    monkeypatch.setattr(archive_compare, "_download_archive_file", _fake_download)
    monkeypatch.setattr(archive_compare, "fetch_archive_ocr_text", lambda *args, **kwargs: "OCR text")
    monkeypatch.setattr(archive_compare, "fetch_archive_abbyy_text", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        archive_compare,
        "build_epub_from_ocr_text",
        lambda **kwargs: {"chapter_count": 1, "paragraph_count": 1, "word_count": 2},
    )
    monkeypatch.setattr(
        archive_compare,
        "evaluate_epub_structure",
        lambda epub_path, run_epubcheck=False: {"metrics": {"structure_score": 1.0}},
    )
    monkeypatch.setattr(
        archive_compare,
        "_epub_preview",
        lambda epub_path: {"paragraphs": [], "word_count": 0, "headings": []},
    )
    monkeypatch.setattr(archive_compare, "_build_aligned_section", lambda **kwargs: None)

    with pytest.raises(ValueError, match="does not provide ABBYY OCR text"):
        build_archive_epub_compare_page(
            archive_identifier="demo-book",
            output_html_path=tmp_path / "abbyy.html",
            generated_source="archive-ocr",
            archive_source_mode="abbyy",
        )

    events: list[dict[str, object]] = []
    summary = build_archive_epub_compare_page(
        archive_identifier="demo-book",
        output_html_path=tmp_path / "djvu.html",
        generated_source="archive-ocr",
        archive_source_mode="djvu",
        progress_callback=events.append,
    )
    assert summary["generated_source"] == "archive-ocr"
    assert summary["selected_pdf_page"] is None
    assert events[0]["message"] == "Fetching archive metadata"
    assert events[-1]["message"] == "Archive compare page ready"


def test_build_archive_compare_page_emits_pdf_download_progress(monkeypatch, tmp_path) -> None:
    source_epub = tmp_path / "source.epub"
    build_epub_from_ocr_text(
        ocr_text="Archive paragraph with enough matching words for preview extraction.",
        output_path=source_epub,
        title="Archive Example",
    )

    monkeypatch.setattr(
        archive_compare,
        "fetch_metadata",
        lambda identifier, timeout_seconds=60: {
            "metadata": {"title": "Archive Example", "language": "eng"},
            "files": [{"name": "demo-book.epub"}, {"name": "demo-book.pdf"}],
        },
    )

    def _fake_download(identifier, filename, output_path, timeout_seconds):  # noqa: ANN001
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if filename.endswith(".epub"):
            shutil.copy2(source_epub, output_path)
        else:
            output_path.write_bytes(b"%PDF-1.4\nfake\n")
        return output_path

    monkeypatch.setattr(archive_compare, "_download_archive_file", _fake_download)
    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        kwargs["output_text_path"].parent.mkdir(parents=True, exist_ok=True)
        kwargs["output_text_path"].write_text("OCR text", encoding="utf-8")
        return {}

    monkeypatch.setattr(archive_compare, "ocr_pdf_with_tesseract", _fake_ocr_pdf_with_tesseract)
    monkeypatch.setattr(
        archive_compare,
        "build_epub_from_ocr_text",
        lambda **kwargs: {"chapter_count": 1, "paragraph_count": 1, "word_count": 2},
    )
    monkeypatch.setattr(
        archive_compare,
        "evaluate_epub_structure",
        lambda epub_path, run_epubcheck=False: {"metrics": {"structure_score": 1.0}},
    )
    monkeypatch.setattr(
        archive_compare,
        "_epub_preview",
        lambda epub_path: {"paragraphs": [], "word_count": 0, "headings": []},
    )
    monkeypatch.setattr(archive_compare, "_build_aligned_section", lambda **kwargs: None)

    events: list[dict[str, object]] = []
    build_archive_epub_compare_page(
        archive_identifier="demo-book",
        output_html_path=tmp_path / "compare.html",
        generated_source="local-ocr",
        progress_callback=events.append,
    )
    assert any(event["message"] == "Downloading archive scan PDF" for event in events)
