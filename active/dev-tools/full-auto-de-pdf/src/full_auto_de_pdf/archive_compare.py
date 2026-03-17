"""HTML comparison page builder for Internet Archive EPUBs vs generated EPUBs."""

from __future__ import annotations

from html import escape
import json
from pathlib import Path
import re
from typing import Any
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

from .archive_org import ARCHIVE_DETAILS_URL, fetch_metadata
from .benchmark import ARCHIVE_DOWNLOAD_URL, fetch_archive_abbyy_text, fetch_archive_ocr_text
from .epub import build_epub_from_ocr_text
from .epub_eval import _read_epub_contents, evaluate_epub_structure

_TAG_RE = re.compile(r"<[^>]+>")


def _extract_first_string(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, list):
        for item in value:
            candidate = _extract_first_string(item)
            if candidate is not None:
                return candidate
    return None


def _normalize_language(value: Any) -> str:
    raw = (_extract_first_string(value) or "").strip().lower()
    if raw in {"eng", "en", "english"}:
        return "en"
    return raw or "en"


def _normalized_files(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    files = metadata.get("files")
    if not isinstance(files, list):
        return []
    return [item for item in files if isinstance(item, dict)]


def _select_archive_filename(files: list[dict[str, Any]], suffix: str) -> str | None:
    suffix_lower = suffix.lower()
    candidates = []
    for file_entry in files:
        name = file_entry.get("name")
        if isinstance(name, str) and name.lower().endswith(suffix_lower):
            candidates.append(name)
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: (len(item), item))[0]


def _download_archive_file(identifier: str, filename: str, output_path: Path, timeout_seconds: int) -> Path:
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        output_path.write_bytes(response.read())
    return output_path


def _read_xhtml_text(xhtml_text: str) -> list[str]:
    try:
        root = ET.fromstring(xhtml_text)
    except ET.ParseError:
        stripped = " ".join(_TAG_RE.sub(" ", xhtml_text).split())
        return [stripped] if stripped else []
    paragraphs: list[str] = []
    for element in root.iter():
        local_name = element.tag.split("}", maxsplit=1)[-1].lower()
        if local_name not in {"p", "li"}:
            continue
        text = " ".join(" ".join(element.itertext()).split())
        if text:
            paragraphs.append(text)
    return paragraphs


def _spine_xhtml_paths(contents: dict[str, Any]) -> list[str]:
    manifest_items = contents.get("manifest_items", {})
    spine_ids = contents.get("spine_ids", [])
    names = contents.get("names", set())
    if not isinstance(manifest_items, dict) or not isinstance(spine_ids, list):
        return []
    paths = []
    for spine_id in spine_ids:
        item = manifest_items.get(spine_id)
        if not isinstance(item, dict):
            continue
        href = item.get("href")
        if isinstance(href, str) and href in names:
            paths.append(href)
    return paths


def _epub_preview(epub_path: Path, max_paragraphs: int = 4) -> dict[str, Any]:
    contents = _read_epub_contents(epub_path)
    preview_paragraphs: list[str] = []
    total_word_count = 0
    with zipfile.ZipFile(epub_path) as epub_zip:
        for xhtml_path in _spine_xhtml_paths(contents):
            paragraphs = _read_xhtml_text(epub_zip.read(xhtml_path).decode("utf-8", errors="replace"))
            total_word_count += sum(len(paragraph.split()) for paragraph in paragraphs)
            if len(preview_paragraphs) < max_paragraphs:
                remaining = max_paragraphs - len(preview_paragraphs)
                preview_paragraphs.extend(paragraphs[:remaining])
    headings = contents.get("extracted_headings", [])
    return {
        "paragraphs": preview_paragraphs,
        "word_count": total_word_count,
        "headings": headings[:8] if isinstance(headings, list) else [],
    }


def _metric_value(report: dict[str, Any], metric_name: str) -> str:
    metrics = report.get("metrics", {})
    if not isinstance(metrics, dict):
        return "n/a"
    value = metrics.get(metric_name)
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value) if value is not None else "n/a"


def _to_rel_href(path: Path, output_dir: Path) -> str:
    return path.resolve().relative_to(output_dir.resolve()).as_posix()


def _render_metric_rows(archive_report: dict[str, Any], generated_report: dict[str, Any], generated_metrics: dict[str, Any]) -> str:
    rows = [
        ("structure score", _metric_value(archive_report, "structure_score"), _metric_value(generated_report, "structure_score")),
        ("manifest items", _metric_value(archive_report, "manifest_item_count"), _metric_value(generated_report, "manifest_item_count")),
        ("spine items", _metric_value(archive_report, "spine_item_count"), _metric_value(generated_report, "spine_item_count")),
        ("xhtml items", _metric_value(archive_report, "xhtml_item_count"), _metric_value(generated_report, "xhtml_item_count")),
        ("TOC entries", _metric_value(archive_report, "toc_entry_count"), _metric_value(generated_report, "toc_entry_count")),
        ("headings", _metric_value(archive_report, "heading_count"), _metric_value(generated_report, "heading_count")),
        ("generated chapters", "n/a", str(generated_metrics["chapter_count"])),
        ("generated paragraphs", "n/a", str(generated_metrics["paragraph_count"])),
        ("generated words", "n/a", str(generated_metrics["word_count"])),
    ]
    return "".join(
        "<tr>"
        f"<th>{escape(label)}</th>"
        f"<td>{escape(archive_value)}</td>"
        f"<td>{escape(generated_value)}</td>"
        "</tr>"
        for label, archive_value, generated_value in rows
    )


def _render_preview_list(items: list[str], empty_message: str) -> str:
    if not items:
        return f"<p>{escape(empty_message)}</p>"
    return "<ol>" + "".join(f"<li>{escape(item)}</li>" for item in items) + "</ol>"


def _render_compare_page(summary: dict[str, Any]) -> str:
    archive_preview = summary["archive_preview"]
    generated_preview = summary["generated_preview"]
    archive_eval = summary["archive_eval"]
    generated_eval = summary["generated_eval"]
    generated_metrics = summary["generated_metrics"]
    archive_pdf_url = summary.get("archive_pdf_url")
    archive_pdf_html = (
        f"<li><a href='{escape(str(archive_pdf_url))}'>Archive scan PDF</a></li>"
        if archive_pdf_url
        else ""
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8' />"
        f"<title>{escape(summary['title'])} EPUB comparison</title>"
        "<style>"
        "body{font-family:system-ui,Arial,sans-serif;margin:1rem 2rem;line-height:1.45}"
        "table{border-collapse:collapse;width:100%;max-width:70rem}"
        "th,td{border:1px solid #ccc;padding:.45rem .6rem;text-align:left;vertical-align:top}"
        "th{background:#f5f5f5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}"
        ".card{border:1px solid #ddd;border-radius:.4rem;padding:.85rem;background:#fafafa}"
        "code{background:#f3f3f3;padding:0 .2rem;border-radius:.2rem}"
        "ul{margin-top:.4rem}ol{padding-left:1.3rem}"
        "</style></head><body>"
        f"<h1>{escape(summary['title'])}: Internet Archive EPUB vs generated EPUB</h1>"
        "<p>"
        f"identifier=<code>{escape(summary['identifier'])}</code>, "
        f"generated_from=<code>archive {escape(summary['archive_source'])} OCR text</code>"
        "</p>"
        "<ul>"
        f"<li><a href='{escape(summary['details_url'])}'>Internet Archive details page</a></li>"
        f"<li><a href='{escape(summary['archive_epub_href'])}'>Downloaded Internet Archive EPUB</a></li>"
        f"<li><a href='{escape(summary['generated_epub_href'])}'>Generated EPUB</a></li>"
        f"<li><a href='{escape(summary['ocr_text_href'])}'>Source OCR text used for generation</a></li>"
        f"{archive_pdf_html}"
        "</ul>"
        "<h2>Structure and generation stats</h2>"
        "<table><thead><tr><th>metric</th><th>Internet Archive EPUB</th><th>Generated EPUB</th></tr></thead><tbody>"
        f"{_render_metric_rows(archive_eval, generated_eval, generated_metrics)}"
        "</tbody></table>"
        "<div class='grid'>"
        "<section class='card'>"
        "<h2>Internet Archive EPUB preview</h2>"
        f"<p>extracted_words={archive_preview['word_count']}</p>"
        "<h3>Headings</h3>"
        f"{_render_preview_list(archive_preview['headings'], 'No headings extracted.')}"
        "<h3>Paragraph preview</h3>"
        f"{_render_preview_list(archive_preview['paragraphs'], 'No paragraph preview available.')}"
        "</section>"
        "<section class='card'>"
        "<h2>Generated EPUB preview</h2>"
        f"<p>extracted_words={generated_preview['word_count']}</p>"
        "<h3>Headings</h3>"
        f"{_render_preview_list(generated_preview['headings'], 'No headings extracted.')}"
        "<h3>Paragraph preview</h3>"
        f"{_render_preview_list(generated_preview['paragraphs'], 'No paragraph preview available.')}"
        "</section>"
        "</div>"
        "</body></html>\n"
    )


def build_archive_epub_compare_page(
    *,
    archive_identifier: str,
    output_html_path: Path,
    archive_source_mode: str = "djvu",
    timeout_seconds: int = 60,
    run_epubcheck: bool = False,
) -> dict[str, Any]:
    """Build a local HTML page comparing an archive.org EPUB with a generated EPUB."""

    if archive_source_mode not in {"djvu", "abbyy"}:
        raise ValueError("archive_source_mode must be one of: djvu, abbyy")
    metadata = fetch_metadata(archive_identifier, timeout_seconds=timeout_seconds)
    files = _normalized_files(metadata)
    archive_epub_filename = _select_archive_filename(files, ".epub")
    if archive_epub_filename is None:
        raise ValueError(f"archive item {archive_identifier!r} does not provide an EPUB download")
    archive_pdf_filename = _select_archive_filename(files, ".pdf")
    metadata_obj = metadata.get("metadata")
    metadata_dict = metadata_obj if isinstance(metadata_obj, dict) else {}
    title = _extract_first_string(metadata_dict.get("title")) or archive_identifier
    language = _normalize_language(metadata_dict.get("language"))

    output_dir = output_html_path.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / f"{output_html_path.stem}_assets"
    downloads_dir = assets_dir / "downloads"
    generated_dir = assets_dir / "generated"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    generated_dir.mkdir(parents=True, exist_ok=True)

    archive_epub_path = downloads_dir / archive_epub_filename
    _download_archive_file(archive_identifier, archive_epub_filename, archive_epub_path, timeout_seconds)
    archive_pdf_url = (
        ARCHIVE_DOWNLOAD_URL.format(identifier=archive_identifier, filename=archive_pdf_filename)
        if archive_pdf_filename is not None
        else None
    )

    if archive_source_mode == "djvu":
        ocr_text = fetch_archive_ocr_text(archive_identifier, timeout_seconds=timeout_seconds)
    else:
        ocr_text = fetch_archive_abbyy_text(archive_identifier, timeout_seconds=timeout_seconds)
        if ocr_text is None:
            raise ValueError(f"archive item {archive_identifier!r} does not provide ABBYY OCR text")

    ocr_text_path = assets_dir / f"{archive_identifier}_{archive_source_mode}.txt"
    ocr_text_path.write_text(ocr_text, encoding="utf-8")
    generated_epub_path = generated_dir / f"{archive_identifier}_{archive_source_mode}_generated.epub"
    generated_metrics = build_epub_from_ocr_text(
        ocr_text=ocr_text,
        output_path=generated_epub_path,
        title=title,
        language=language,
        apply_cleanup=True,
    )

    archive_eval = evaluate_epub_structure(archive_epub_path, run_epubcheck=run_epubcheck)
    generated_eval = evaluate_epub_structure(generated_epub_path, run_epubcheck=run_epubcheck)
    archive_preview = _epub_preview(archive_epub_path)
    generated_preview = _epub_preview(generated_epub_path)

    summary = {
        "identifier": archive_identifier,
        "title": title,
        "archive_source": archive_source_mode,
        "details_url": ARCHIVE_DETAILS_URL.format(identifier=archive_identifier),
        "archive_pdf_url": archive_pdf_url,
        "archive_epub_path": str(archive_epub_path),
        "generated_epub_path": str(generated_epub_path),
        "ocr_text_path": str(ocr_text_path),
        "archive_epub_href": _to_rel_href(archive_epub_path, output_dir),
        "generated_epub_href": _to_rel_href(generated_epub_path, output_dir),
        "ocr_text_href": _to_rel_href(ocr_text_path, output_dir),
        "archive_eval": archive_eval,
        "generated_eval": generated_eval,
        "generated_metrics": generated_metrics,
        "archive_preview": archive_preview,
        "generated_preview": generated_preview,
    }
    (assets_dir / "compare_summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    output_html_path.write_text(_render_compare_page(summary), encoding="utf-8")
    return {
        "archive_identifier": archive_identifier,
        "title": title,
        "output_html_path": str(output_html_path),
        "archive_epub_path": str(archive_epub_path),
        "generated_epub_path": str(generated_epub_path),
        "archive_source": archive_source_mode,
    }
