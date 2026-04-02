"""EPUB generation helpers for OCR text."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
import json
from pathlib import Path
import re
from typing import Any
import uuid
import zipfile

from .ocr_cleanup import cleanup_ocr_text

_CHAPTER_HEADING = re.compile(
    r"^(chapter|part|book|section)\s+([0-9]+|[ivxlcdm]+|[A-Za-z]+)\b.*$",
    flags=re.IGNORECASE,
)
_FRONT_MATTER_HEADING = re.compile(
    r"^(contents?|table\s+of\s+contents|dedication|preface|foreword|introduction|prologue|acknowledg(?:e)?ments?)$",
    flags=re.IGNORECASE,
)
_BULLET_ITEM = re.compile("^(?:[-*]|\\u2022)\\s+(.+)$")
_ORDERED_ITEM = re.compile(r"^\d+[\.\)]\s+(.+)$")


@dataclass(frozen=True)
class ContentBlock:
    """A rendered content block inside one EPUB chapter."""

    kind: str
    text: str = ""
    level: int = 0
    items: tuple[str, ...] = ()


@dataclass(frozen=True)
class Chapter:
    """Structured chapter content for the generated EPUB."""

    title: str
    file_name: str
    blocks: tuple[ContentBlock, ...]
    epub_type: str = "bodymatter chapter"


def _paragraphs(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    parts = [paragraph.strip() for paragraph in normalized.split("\n\n")]
    return [paragraph for paragraph in parts if paragraph]


def _heading_word_count(text: str) -> int:
    return len([token for token in text.split() if token])


def _is_mostly_uppercase(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return False
    uppercase_count = sum(1 for char in letters if char.isupper())
    return uppercase_count / len(letters) >= 0.8


def _looks_like_short_heading(text: str) -> bool:
    stripped = " ".join(text.split())
    if not stripped or len(stripped) > 90:
        return False
    if stripped[-1:] in {".", "!", "?"}:
        return False
    word_count = _heading_word_count(stripped)
    if word_count == 0 or word_count > 10:
        return False
    return stripped.istitle() or _is_mostly_uppercase(stripped)


def _is_chapter_heading(text: str) -> bool:
    stripped = " ".join(text.split())
    if _is_front_matter_heading(stripped):
        return False
    if _CHAPTER_HEADING.match(stripped):
        return True
    if _is_mostly_uppercase(stripped) and _heading_word_count(stripped) <= 6:
        return True
    return False


def _is_section_heading(text: str) -> bool:
    return _looks_like_short_heading(text) and not _is_chapter_heading(text)


def _list_item_text(paragraph: str) -> tuple[str, str] | None:
    bullet_match = _BULLET_ITEM.match(paragraph)
    if bullet_match:
        return "unordered_list", bullet_match.group(1).strip()
    ordered_match = _ORDERED_ITEM.match(paragraph)
    if ordered_match:
        return "ordered_list", ordered_match.group(1).strip()
    return None


def _normalize_heading_text(text: str) -> str:
    return " ".join(text.split())


def _is_front_matter_heading(text: str) -> bool:
    return bool(_FRONT_MATTER_HEADING.match(_normalize_heading_text(text)))


def _is_title_page_paragraph(text: str, title: str) -> bool:
    normalized_text = _normalize_heading_text(text)
    normalized_title = _normalize_heading_text(title)
    if not normalized_text:
        return False
    if normalized_text.casefold() == normalized_title.casefold():
        return True
    return _is_mostly_uppercase(normalized_text) and _heading_word_count(normalized_text) <= 8


def _front_matter_epub_type(section_title: str) -> str:
    normalized = _normalize_heading_text(section_title).casefold()
    if "contents" in normalized or normalized == "content":
        return "frontmatter toc"
    if normalized == "title page":
        return "frontmatter titlepage"
    return "frontmatter"


def _build_front_matter_chapters(paragraphs: list[str], title: str) -> list[Chapter]:
    chapters: list[Chapter] = []
    index = 0
    if paragraphs and _is_title_page_paragraph(paragraphs[0], title):
        chapters.append(
            Chapter(
                title="Title Page",
                file_name="",
                blocks=tuple(_build_blocks([paragraphs[0]])),
                epub_type=_front_matter_epub_type("Title Page"),
            )
        )
        index = 1

    while index < len(paragraphs):
        paragraph = paragraphs[index]
        section_title = "Front Matter"
        if _is_front_matter_heading(paragraph):
            section_title = _normalize_heading_text(paragraph)
            index += 1
        section_paragraphs: list[str] = []
        while index < len(paragraphs) and not _is_front_matter_heading(paragraphs[index]):
            section_paragraphs.append(paragraphs[index])
            index += 1
        if not section_paragraphs and section_title == "Front Matter":
            section_paragraphs.append(paragraph)
            index += 1
        chapters.append(
            Chapter(
                title=section_title,
                file_name="",
                blocks=tuple(_build_blocks(section_paragraphs)),
                epub_type=_front_matter_epub_type(section_title),
            )
        )
    return chapters


def _build_chapters(paragraphs: list[str], title: str) -> list[Chapter]:
    chapters: list[tuple[str, list[str]]] = []
    intro_content: list[str] = []
    current_title: str | None = None
    current_content: list[str] = []
    for paragraph in paragraphs:
        if _is_chapter_heading(paragraph):
            if current_title is not None:
                chapters.append((current_title, current_content))
            else:
                intro_content = current_content
            current_title = _normalize_heading_text(paragraph)
            current_content = []
            continue
        current_content.append(paragraph)

    if current_title is not None:
        chapters.append((current_title, current_content))
    else:
        intro_content = current_content

    structured_chapters: list[Chapter] = []
    if intro_content:
        structured_chapters.extend(_build_front_matter_chapters(intro_content, title))

    for index, (chapter_title, chapter_paragraphs) in enumerate(
        chapters,
        start=len(structured_chapters) + 1,
    ):
        structured_chapters.append(
            Chapter(
                title=chapter_title,
                file_name=f"chapter{index}.xhtml",
                blocks=tuple(_build_blocks(chapter_paragraphs)),
            )
        )

    if structured_chapters:
        _assign_generated_file_names(structured_chapters)

    if structured_chapters:
        return structured_chapters

    return [
        Chapter(
            title=title,
            file_name="chapter1.xhtml",
            blocks=tuple(_build_blocks(paragraphs)),
        )
    ]


def _assign_generated_file_names(chapters: list[Chapter]) -> None:
    for index, chapter in enumerate(chapters, start=1):
        if chapter.file_name:
            continue
        chapters[index - 1] = Chapter(
            title=chapter.title,
            file_name=f"chapter{index}.xhtml",
            blocks=chapter.blocks,
            epub_type=chapter.epub_type,
        )


def _build_blocks(paragraphs: list[str]) -> list[ContentBlock]:
    blocks: list[ContentBlock] = []
    index = 0
    while index < len(paragraphs):
        paragraph = paragraphs[index]
        list_item = _list_item_text(paragraph)
        if list_item is not None:
            list_kind, items, next_index = _consume_list(paragraphs, index, list_item[0])
            blocks.append(ContentBlock(kind=list_kind, items=tuple(items)))
            index = next_index
            continue
        if _is_section_heading(paragraph):
            blocks.append(
                ContentBlock(
                    kind="heading",
                    text=_normalize_heading_text(paragraph),
                    level=2,
                )
            )
        else:
            blocks.append(ContentBlock(kind="paragraph", text=paragraph))
        index += 1
    return blocks


def _consume_list(
    paragraphs: list[str],
    start_index: int,
    list_kind: str,
) -> tuple[str, list[str], int]:
    items: list[str] = []
    index = start_index
    while index < len(paragraphs):
        list_item = _list_item_text(paragraphs[index])
        if list_item is None or list_item[0] != list_kind:
            break
        items.append(list_item[1])
        index += 1
    return list_kind, items, index


def _render_block(block: ContentBlock) -> str:
    if block.kind == "heading":
        level = max(2, min(block.level, 6))
        return f"    <h{level}>{escape(block.text)}</h{level}>"
    if block.kind == "ordered_list":
        items = "\n".join(f"      <li>{escape(item)}</li>" for item in block.items)
        return "    <ol>\n" + items + "\n    </ol>"
    if block.kind == "unordered_list":
        items = "\n".join(f"      <li>{escape(item)}</li>" for item in block.items)
        return "    <ul>\n" + items + "\n    </ul>"
    return f"    <p>{escape(block.text)}</p>"


def _chapter_xhtml(chapter: Chapter, book_title: str, language: str) -> str:
    escaped_book_title = escape(book_title)
    escaped_chapter_title = escape(chapter.title)
    body = "\n".join(_render_block(block) for block in chapter.blocks)
    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        f"<html xmlns='http://www.w3.org/1999/xhtml' lang='{escape(language)}'>\n"
        "  <head>\n"
        f"    <title>{escaped_book_title} - {escaped_chapter_title}</title>\n"
        "    <link rel='stylesheet' type='text/css' href='styles.css'/>\n"
        "  </head>\n"
        "  <body>\n"
        f"    <section epub:type='{escape(chapter.epub_type)}' xmlns:epub='http://www.idpf.org/2007/ops'>\n"
        f"      <h1>{escaped_chapter_title}</h1>\n"
        f"{body}\n"
        "    </section>\n"
        "  </body>\n"
        "</html>\n"
    )


def _content_opf(title: str, language: str, identifier: str, chapters: list[Chapter]) -> str:
    escaped_title = escape(title)
    escaped_language = escape(language)
    escaped_identifier = escape(identifier)
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest_items = [
        "    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>",
        "    <item id='styles' href='styles.css' media-type='text/css'/>",
    ]
    spine_items: list[str] = []
    for index, chapter in enumerate(chapters, start=1):
        manifest_items.append(
            "    <item "
            f"id='chapter{index}' href='{escape(chapter.file_name)}' "
            "media-type='application/xhtml+xml'/>"
        )
        spine_items.append(f"    <itemref idref='chapter{index}'/>")
    manifest_xml = "\n".join(manifest_items)
    spine_xml = "\n".join(spine_items)
    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<package xmlns='http://www.idpf.org/2007/opf' version='3.0' "
        "unique-identifier='bookid'>\n"
        "  <metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>\n"
        f"    <dc:identifier id='bookid'>{escaped_identifier}</dc:identifier>\n"
        f"    <dc:title>{escaped_title}</dc:title>\n"
        f"    <dc:language>{escaped_language}</dc:language>\n"
        f"    <meta property='dcterms:modified'>{modified}</meta>\n"
        "  </metadata>\n"
        "  <manifest>\n"
        f"{manifest_xml}\n"
        "  </manifest>\n"
        "  <spine>\n"
        f"{spine_xml}\n"
        "  </spine>\n"
        "</package>\n"
    )


def _nav_xhtml(title: str, language: str, chapters: list[Chapter]) -> str:
    escaped_title = escape(title)
    chapter_items = "\n".join(
        f"        <li><a href='{escape(chapter.file_name)}'>{escape(chapter.title)}</a></li>"
        for chapter in chapters
    )
    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        f"<html xmlns='http://www.w3.org/1999/xhtml' lang='{escape(language)}'>\n"
        "  <head>\n"
        f"    <title>{escaped_title}</title>\n"
        "    <link rel='stylesheet' type='text/css' href='styles.css'/>\n"
        "  </head>\n"
        "  <body>\n"
        "    <nav epub:type='toc' xmlns:epub='http://www.idpf.org/2007/ops'>\n"
        f"      <h2>{escaped_title}</h2>\n"
        "      <ol>\n"
        f"{chapter_items}\n"
        "      </ol>\n"
        "    </nav>\n"
        "  </body>\n"
        "</html>\n"
    )


def _stylesheet() -> str:
    return (
        "body { font-family: serif; line-height: 1.4; }\n"
        "h1, h2, h3 { margin-top: 1.4em; }\n"
        "p { margin: 0 0 1em 0; }\n"
        "ol, ul { margin: 0 0 1em 1.4em; }\n"
        "li { margin-bottom: 0.35em; }\n"
    )


def _chapter_metrics(chapters: list[Chapter]) -> tuple[int, int]:
    heading_count = len(chapters)
    list_count = 0
    for chapter in chapters:
        for block in chapter.blocks:
            if block.kind == "heading":
                heading_count += 1
            elif block.kind in {"ordered_list", "unordered_list"}:
                list_count += 1
    return heading_count, list_count


def build_epub_from_ocr_text(
    ocr_text: str,
    output_path: Path,
    title: str,
    language: str = "en",
    apply_cleanup: bool = True,
) -> dict[str, int]:
    """Build a structured EPUB from OCR text and return text metrics."""

    prepared_text = cleanup_ocr_text(ocr_text) if apply_cleanup else ocr_text
    paragraphs = _paragraphs(prepared_text)
    words = [token for token in prepared_text.split() if token]
    chapters = _build_chapters(paragraphs, title)
    identifier = f"urn:uuid:{uuid.uuid4()}"
    heading_count, list_count = _chapter_metrics(chapters)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w") as epub_file:
        epub_file.writestr(
            "mimetype",
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        epub_file.writestr(
            "META-INF/container.xml",
            (
                "<?xml version='1.0' encoding='utf-8'?>\n"
                "<container version='1.0' "
                "xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>\n"
                "  <rootfiles>\n"
                "    <rootfile full-path='OEBPS/content.opf' "
                "media-type='application/oebps-package+xml'/>\n"
                "  </rootfiles>\n"
                "</container>\n"
            ),
        )
        epub_file.writestr(
            "OEBPS/content.opf",
            _content_opf(title, language, identifier, chapters),
        )
        epub_file.writestr("OEBPS/nav.xhtml", _nav_xhtml(title, language, chapters))
        epub_file.writestr("OEBPS/styles.css", _stylesheet())
        for chapter in chapters:
            epub_file.writestr(
                f"OEBPS/{chapter.file_name}",
                _chapter_xhtml(chapter, title, language),
            )

    return {
        "chapter_count": len(chapters),
        "heading_count": heading_count,
        "list_count": list_count,
        "paragraph_count": len(paragraphs),
        "word_count": len(words),
        "character_count": len(prepared_text),
    }


def _parse_build_epub_file_args(
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> tuple[Path | None, str, str, bool]:
    metrics_output_path = kwargs.pop("metrics_output_path", None)
    title = kwargs.pop("title", None)
    language = kwargs.pop("language", "en")
    apply_cleanup = kwargs.pop("apply_cleanup", True)
    if args:
        metrics_output_path = args[0]
    if len(args) >= 2:
        title = args[1]
    if len(args) >= 3:
        language = args[2]
    if len(args) >= 4:
        apply_cleanup = args[3]
    if len(args) > 4:
        raise TypeError("build_epub_from_ocr_file accepts at most 4 positional extras")
    if kwargs:
        unknown = ", ".join(sorted(kwargs))
        raise TypeError(f"Unexpected keyword arguments: {unknown}")
    if title is None:
        raise TypeError("build_epub_from_ocr_file missing required argument: 'title'")
    normalized_metrics_path: Path | None = None
    if metrics_output_path is not None:
        normalized_metrics_path = (
            metrics_output_path
            if isinstance(metrics_output_path, Path)
            else Path(str(metrics_output_path))
        )
    return normalized_metrics_path, str(title), str(language), bool(apply_cleanup)


def build_epub_from_ocr_file(
    ocr_text_path: Path,
    output_epub_path: Path,
    *args: Any,
    **kwargs: Any,
) -> dict[str, int]:
    """Build an EPUB from an OCR text file with backward-compatible arguments."""

    metrics_output_path, title, language, apply_cleanup = _parse_build_epub_file_args(
        args,
        kwargs,
    )
    ocr_text = ocr_text_path.read_text(encoding="utf-8")
    metrics = build_epub_from_ocr_text(
        ocr_text,
        output_epub_path,
        title,
        language=language,
        apply_cleanup=apply_cleanup,
    )
    if metrics_output_path is not None:
        metrics_output_path.parent.mkdir(parents=True, exist_ok=True)
        metrics_output_path.write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return metrics
