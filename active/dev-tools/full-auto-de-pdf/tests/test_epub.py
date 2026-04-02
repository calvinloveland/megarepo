import json
import zipfile

import pytest

import full_auto_de_pdf.epub as epub_module
from full_auto_de_pdf.epub import build_epub_from_ocr_file, build_epub_from_ocr_text


def test_build_epub_from_ocr_text_creates_required_epub_entries(tmp_path) -> None:
    output_epub = tmp_path / "book.epub"
    metrics = build_epub_from_ocr_text(
        "First paragraph.\n\nSecond paragraph.",
        output_path=output_epub,
        title="Example Title",
    )

    assert metrics["chapter_count"] == 1
    assert metrics["paragraph_count"] == 2
    assert metrics["word_count"] == 4
    with zipfile.ZipFile(output_epub) as epub_file:
        names = epub_file.namelist()
        assert names[0] == "mimetype"
        assert "META-INF/container.xml" in names
        assert "OEBPS/content.opf" in names
        assert "OEBPS/nav.xhtml" in names
        assert "OEBPS/styles.css" in names
        assert "OEBPS/chapter1.xhtml" in names


def test_build_epub_from_ocr_text_splits_chapters_and_preserves_lists(tmp_path) -> None:
    output_epub = tmp_path / "structured.epub"
    metrics = build_epub_from_ocr_text(
        (
            "CHAPTER I\n\n"
            "The Beginning\n\n"
            "- First item\n\n"
            "- Second item\n\n"
            "CHAPTER II\n\n"
            "Another Section\n\n"
            "1. Step one\n\n"
            "2. Step two"
        ),
        output_path=output_epub,
        title="Structured Book",
        apply_cleanup=False,
    )

    assert metrics["chapter_count"] == 2
    assert metrics["heading_count"] >= 4
    assert metrics["list_count"] == 2
    with zipfile.ZipFile(output_epub) as epub_file:
        nav_text = epub_file.read("OEBPS/nav.xhtml").decode("utf-8")
        chapter1_text = epub_file.read("OEBPS/chapter1.xhtml").decode("utf-8")
        chapter2_text = epub_file.read("OEBPS/chapter2.xhtml").decode("utf-8")
        assert "CHAPTER I" in nav_text
        assert "CHAPTER II" in nav_text
        assert "<ul>" in chapter1_text
        assert "<ol>" in chapter2_text
        assert "<h2>The Beginning</h2>" in chapter1_text
        assert "<h2>Another Section</h2>" in chapter2_text


def test_build_epub_from_ocr_text_splits_front_matter_sections(tmp_path) -> None:
    output_epub = tmp_path / "frontmatter.epub"
    metrics = build_epub_from_ocr_text(
        (
            "Dracula\n\n"
            "CONTENTS\n\n"
            "Letter from Jonathan Harker\n\n"
            "DEDICATION\n\n"
            "For my dear friend.\n\n"
            "CHAPTER I\n\n"
            "Jonathan Harker's Journal"
        ),
        output_path=output_epub,
        title="Dracula",
        apply_cleanup=False,
    )

    assert metrics["chapter_count"] == 4
    with zipfile.ZipFile(output_epub) as epub_file:
        nav_text = epub_file.read("OEBPS/nav.xhtml").decode("utf-8")
        title_page_text = epub_file.read("OEBPS/chapter1.xhtml").decode("utf-8")
        contents_text = epub_file.read("OEBPS/chapter2.xhtml").decode("utf-8")
        dedication_text = epub_file.read("OEBPS/chapter3.xhtml").decode("utf-8")
        chapter_text = epub_file.read("OEBPS/chapter4.xhtml").decode("utf-8")
        assert "Title Page" in nav_text
        assert "CONTENTS" in nav_text
        assert "DEDICATION" in nav_text
        assert "CHAPTER I" in nav_text
        assert "epub:type='frontmatter titlepage'" in title_page_text
        assert "<h2>Dracula</h2>" in title_page_text
        assert "epub:type='frontmatter toc'" in contents_text
        assert "Letter from Jonathan Harker" in contents_text
        assert "epub:type='frontmatter'" in dedication_text
        assert "<p>For my dear friend.</p>" in dedication_text
        assert "epub:type='bodymatter chapter'" in chapter_text


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


def test_epub_helper_edge_cases(monkeypatch) -> None:
    assert epub_module._is_mostly_uppercase("12345") is False
    assert epub_module._looks_like_short_heading("A" * 91) is False
    assert epub_module._looks_like_short_heading("one two three four five six seven eight nine ten eleven") is False
    assert epub_module._is_chapter_heading("LOUD TITLE") is True
    assert epub_module._is_title_page_paragraph("", "Book") is False
    assert epub_module._build_front_matter_chapters(["A plain opening"], "Book") == [
        epub_module.Chapter(
            title="Front Matter",
            file_name="",
            blocks=(epub_module.ContentBlock(kind="paragraph", text="A plain opening"),),
            epub_type="frontmatter",
        )
    ]
    calls = iter([False, True])
    monkeypatch.setattr(epub_module, "_is_front_matter_heading", lambda text: next(calls))
    assert epub_module._build_front_matter_chapters(["Edge paragraph"], "Book") == [
        epub_module.Chapter(
            title="Front Matter",
            file_name="",
            blocks=(epub_module.ContentBlock(kind="paragraph", text="Edge paragraph"),),
            epub_type="frontmatter",
        )
    ]
    assert epub_module._build_chapters([], "Book") == [
        epub_module.Chapter(
            title="Book",
            file_name="chapter1.xhtml",
            blocks=(),
        )
    ]
    assert epub_module._consume_list(["- First item", "Paragraph"], 0, "unordered_list") == (
        "unordered_list",
        ["First item"],
        1,
    )


def test_epub_parse_build_file_args_edge_cases(tmp_path) -> None:
    metrics_path, title, language, apply_cleanup = epub_module._parse_build_epub_file_args(
        ("metrics.json", "Demo", "fr", False),
        {},
    )
    assert metrics_path == epub_module.Path("metrics.json")
    assert title == "Demo"
    assert language == "fr"
    assert apply_cleanup is False

    with pytest.raises(TypeError, match="at most 4 positional extras"):
        epub_module._parse_build_epub_file_args((1, 2, 3, 4, 5), {})
    with pytest.raises(TypeError, match="Unexpected keyword arguments: extra"):
        epub_module._parse_build_epub_file_args((), {"title": "Demo", "extra": True})
    with pytest.raises(TypeError, match="missing required argument: 'title'"):
        epub_module._parse_build_epub_file_args((), {})

    ocr_text = tmp_path / "ocr.txt"
    output_epub = tmp_path / "book.epub"
    ocr_text.write_text("One line only.", encoding="utf-8")
    metrics = build_epub_from_ocr_file(
        ocr_text,
        output_epub,
        "Positional Demo",
        "de",
        False,
    )
    assert metrics["word_count"] == 3
