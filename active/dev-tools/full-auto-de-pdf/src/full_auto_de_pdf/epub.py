from __future__ import annotations

from datetime import datetime, timezone
from html import escape
import json
from pathlib import Path
import uuid
import zipfile


def _paragraphs(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    parts = [paragraph.strip() for paragraph in normalized.split("\n\n")]
    return [paragraph for paragraph in parts if paragraph]


def _paragraphs_to_xhtml(paragraphs: list[str], title: str) -> str:
    body = "\n".join(f"    <p>{escape(paragraph)}</p>" for paragraph in paragraphs)
    escaped_title = escape(title)
    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        "<html xmlns='http://www.w3.org/1999/xhtml' lang='en'>\n"
        "  <head>\n"
        f"    <title>{escaped_title}</title>\n"
        "  </head>\n"
        "  <body>\n"
        f"    <h1>{escaped_title}</h1>\n"
        f"{body}\n"
        "  </body>\n"
        "</html>\n"
    )


def _content_opf(title: str, language: str, identifier: str) -> str:
    escaped_title = escape(title)
    escaped_language = escape(language)
    escaped_identifier = escape(identifier)
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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
        "    <item id='chapter1' href='chapter1.xhtml' "
        "media-type='application/xhtml+xml'/>\n"
        "    <item id='nav' href='nav.xhtml' "
        "media-type='application/xhtml+xml' properties='nav'/>\n"
        "  </manifest>\n"
        "  <spine>\n"
        "    <itemref idref='chapter1'/>\n"
        "  </spine>\n"
        "</package>\n"
    )


def _nav_xhtml(title: str) -> str:
    escaped_title = escape(title)
    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        "<html xmlns='http://www.w3.org/1999/xhtml' lang='en'>\n"
        "  <head>\n"
        f"    <title>{escaped_title}</title>\n"
        "  </head>\n"
        "  <body>\n"
        "    <nav epub:type='toc' xmlns:epub='http://www.idpf.org/2007/ops'>\n"
        f"      <h2>{escaped_title}</h2>\n"
        "      <ol>\n"
        "        <li><a href='chapter1.xhtml'>Chapter 1</a></li>\n"
        "      </ol>\n"
        "    </nav>\n"
        "  </body>\n"
        "</html>\n"
    )


def build_epub_from_ocr_text(
    ocr_text: str,
    output_path: Path,
    title: str,
    language: str = "en",
) -> dict[str, int]:
    paragraphs = _paragraphs(ocr_text)
    words = [token for token in ocr_text.split() if token]
    identifier = f"urn:uuid:{uuid.uuid4()}"
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
        epub_file.writestr("OEBPS/content.opf", _content_opf(title, language, identifier))
        epub_file.writestr("OEBPS/nav.xhtml", _nav_xhtml(title))
        epub_file.writestr(
            "OEBPS/chapter1.xhtml",
            _paragraphs_to_xhtml(paragraphs, title),
        )

    return {
        "paragraph_count": len(paragraphs),
        "word_count": len(words),
        "character_count": len(ocr_text),
    }


def build_epub_from_ocr_file(
    ocr_text_path: Path,
    output_epub_path: Path,
    metrics_output_path: Path | None,
    title: str,
    language: str = "en",
) -> dict[str, int]:
    ocr_text = ocr_text_path.read_text(encoding="utf-8")
    metrics = build_epub_from_ocr_text(ocr_text, output_epub_path, title, language=language)
    if metrics_output_path is not None:
        metrics_output_path.parent.mkdir(parents=True, exist_ok=True)
        metrics_output_path.write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return metrics
