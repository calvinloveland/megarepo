"""HTML comparison page builder for Internet Archive EPUBs vs generated EPUBs."""

from __future__ import annotations

from html import escape
import json
from pathlib import Path
import re
import subprocess
from typing import Any, Callable
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

from .archive_org import ARCHIVE_DETAILS_URL, fetch_metadata
from .benchmark import ARCHIVE_DOWNLOAD_URL, fetch_archive_abbyy_text, fetch_archive_ocr_text
from .epub import build_epub_from_ocr_text
from .epub_eval import _read_epub_contents, evaluate_epub_structure
from .ocr_pipeline import ocr_pdf_with_tesseract

_TAG_RE = re.compile(r"<[^>]+>")
_TOKEN_RE = re.compile(r"[a-z0-9']+")
_MIN_WINDOW_TOKEN_COUNT = 6
_MIN_PAGE_TOKEN_COUNT = 8
_DEFAULT_MAX_ALIGNED_PAGES = 40


def _emit_archive_progress(
    progress_callback: Callable[[dict[str, object]], None] | None,
    *,
    status: str,
    message: str,
) -> None:
    if progress_callback is not None:
        progress_callback({"stage": "archive-compare", "status": status, "message": message})


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


def _normalize_ocr_language(value: Any) -> str:
    raw = (_extract_first_string(value) or "").strip().lower()
    if raw in {"eng", "en", "english"}:
        return "eng"
    return raw or "eng"


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


def _epub_paragraphs(epub_path: Path) -> list[str]:
    contents = _read_epub_contents(epub_path)
    paragraphs: list[str] = []
    with zipfile.ZipFile(epub_path) as epub_zip:
        for xhtml_path in _spine_xhtml_paths(contents):
            paragraphs.extend(
                _read_xhtml_text(epub_zip.read(xhtml_path).decode("utf-8", errors="replace"))
            )
    return paragraphs


def _tokenize_match_text(text: str) -> set[str]:
    return {token for token in _TOKEN_RE.findall(text.lower()) if token}


def _paragraph_windows(paragraphs: list[str], window_size: int = 2) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    for start_index in range(len(paragraphs)):
        section = paragraphs[start_index : start_index + window_size]
        if not section:
            continue
        text = "\n\n".join(section).strip()
        tokens = _tokenize_match_text(text)
        if len(tokens) < _MIN_WINDOW_TOKEN_COUNT:
            continue
        windows.append(
            {
                "start_index": start_index,
                "text": text,
                "tokens": tokens,
            }
        )
    return windows


def _pdf_page_count(pdf_path: Path) -> int:
    completed = subprocess.run(
        ["pdfinfo", str(pdf_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    for line in completed.stdout.splitlines():
        if not line.startswith("Pages:"):
            continue
        return int(line.split(":", maxsplit=1)[1].strip())
    raise ValueError(f"Unable to determine page count for {pdf_path}")


def _extract_pdf_page_texts(
    pdf_path: Path,
    max_pages: int = _DEFAULT_MAX_ALIGNED_PAGES,
    include_page_numbers: tuple[int, ...] = (),
) -> list[dict[str, Any]]:
    pdf_page_count = _pdf_page_count(pdf_path)
    page_numbers = list(range(1, min(pdf_page_count, max_pages) + 1))
    for page_number in include_page_numbers:
        if page_number < 1 or page_number > pdf_page_count:
            raise ValueError(f"Requested PDF page {page_number} is out of range 1..{pdf_page_count}")
        if page_number not in page_numbers:
            page_numbers.append(page_number)
    pages: list[dict[str, Any]] = []
    for page_number in sorted(page_numbers):
        completed = subprocess.run(
            [
                "pdftotext",
                "-layout",
                "-f",
                str(page_number),
                "-l",
                str(page_number),
                str(pdf_path),
                "-",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        text = " ".join(completed.stdout.split())
        if len(_tokenize_match_text(text)) < _MIN_PAGE_TOKEN_COUNT:
            continue
        pages.append({"page_number": page_number, "text": text})
    return pages


def _render_pdf_page_image(pdf_path: Path, page_number: int, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_prefix = output_path.with_suffix("")
    subprocess.run(
        [
            "pdftoppm",
            "-png",
            "-singlefile",
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            str(pdf_path),
            str(output_prefix),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    rendered_path = output_prefix.with_suffix(".png")
    if not rendered_path.exists():
        raise ValueError(f"Expected rendered page image at {rendered_path}")
    return rendered_path


def _overlap_score(left_tokens: set[str], right_tokens: set[str]) -> float:
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / min(len(left_tokens), len(right_tokens))


def _best_window_match(page_tokens: set[str], windows: list[dict[str, Any]]) -> dict[str, Any] | None:
    best_window: dict[str, Any] | None = None
    best_score = -1.0
    for window in windows:
        window_tokens = window.get("tokens")
        if not isinstance(window_tokens, set):
            continue
        score = _overlap_score(page_tokens, window_tokens)
        if score <= best_score:
            continue
        best_window = window
        best_score = score
    if best_window is None:
        return None
    return {
        "text": best_window["text"],
        "start_index": best_window["start_index"],
        "score": best_score,
    }


def _trim_words(text: str, max_words: int = 120) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + " ..."


def _build_aligned_section(
    *,
    archive_pdf_path: Path,
    archive_epub_path: Path,
    generated_epub_path: Path,
    image_output_dir: Path,
    href_base_dir: Path,
    selected_page_number: int | None = None,
    max_pages: int = _DEFAULT_MAX_ALIGNED_PAGES,
) -> dict[str, Any] | None:
    archive_windows = _paragraph_windows(_epub_paragraphs(archive_epub_path))
    generated_windows = _paragraph_windows(_epub_paragraphs(generated_epub_path))
    if not archive_windows or not generated_windows:
        return None
    pages = _extract_pdf_page_texts(
        archive_pdf_path,
        max_pages=max_pages,
        include_page_numbers=((selected_page_number,) if selected_page_number is not None else ()),
    )
    page_matches: list[dict[str, Any]] = []
    for page in pages:
        page_match = _aligned_page_match(
            page,
            archive_windows=archive_windows,
            generated_windows=generated_windows,
            archive_pdf_path=archive_pdf_path,
            image_output_dir=image_output_dir,
            href_base_dir=href_base_dir,
        )
        if page_match is not None:
            page_matches.append(page_match)
    if not page_matches:
        return None
    page_matches.sort(key=lambda item: int(item["page_number"]))
    auto_selected_page = max(page_matches, key=lambda item: float(item["combined_score"]))
    selected_page = _selected_aligned_page(
        page_matches,
        auto_selected_page=auto_selected_page,
        selected_page_number=selected_page_number,
    )
    return {
        **selected_page,
        "page_count": len(page_matches),
        "pages": page_matches,
        "auto_selected_page_number": int(auto_selected_page["page_number"]),
    }


def _aligned_page_match(
    page: dict[str, Any],
    *,
    archive_windows: list[dict[str, Any]],
    generated_windows: list[dict[str, Any]],
    archive_pdf_path: Path,
    image_output_dir: Path,
    href_base_dir: Path,
) -> dict[str, Any] | None:
    page_tokens = _tokenize_match_text(str(page.get("text", "")))
    if len(page_tokens) < _MIN_PAGE_TOKEN_COUNT:
        return None
    archive_match = _best_window_match(page_tokens, archive_windows)
    generated_match = _best_window_match(page_tokens, generated_windows)
    if archive_match is None or generated_match is None:
        return None
    page_number = int(page["page_number"])
    page_image_path = _render_pdf_page_image(
        archive_pdf_path,
        page_number,
        image_output_dir / f"aligned_page_{page_number:04d}.png",
    )
    return {
        "page_number": page_number,
        "page_image_path": str(page_image_path),
        "page_image_href": _to_rel_href(page_image_path, href_base_dir),
        "page_text_excerpt": _trim_words(str(page["text"])),
        "archive_excerpt": str(archive_match["text"]),
        "generated_excerpt": str(generated_match["text"]),
        "archive_score": float(archive_match["score"]),
        "generated_score": float(generated_match["score"]),
        "combined_score": min(float(archive_match["score"]), float(generated_match["score"])),
    }


def _selected_aligned_page(
    page_matches: list[dict[str, Any]],
    *,
    auto_selected_page: dict[str, Any],
    selected_page_number: int | None,
) -> dict[str, Any]:
    if selected_page_number is None:
        return auto_selected_page
    selected_page = next(
        (page for page in page_matches if int(page["page_number"]) == selected_page_number),
        None,
    )
    if selected_page is None:
        raise ValueError(
            f"Requested PDF page {selected_page_number} could not be aligned with EPUB excerpts"
        )
    return selected_page


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


def _detail_toggle(enabled: Any) -> str:
    return "enabled" if enabled else "disabled"


def _usage_detail_item(
    metrics: dict[str, Any],
    *,
    key: str,
    label: str,
) -> tuple[str, str] | None:
    usage = metrics.get(key)
    if not isinstance(usage, dict) or not usage:
        return None
    return (
        label,
        ", ".join(f"{str(name)}: {int(count)}" for name, count in sorted(usage.items())),
    )


def _local_ocr_detail_items(details: dict[str, Any]) -> list[tuple[str, str]]:
    detail_items = [
        ("OCR engine", str(details.get("ocr_engine", "n/a"))),
        ("OCR language", str(details.get("ocr_language", "n/a"))),
        ("preprocess mode", str(details.get("preprocess_mode", "n/a"))),
        ("Tesseract PSM", str(details.get("tesseract_psm", "n/a"))),
        ("cleanup", _detail_toggle(details.get("apply_cleanup"))),
        ("inverse-render rerank", _detail_toggle(details.get("inverse_render_rerank"))),
        ("cleanup span verification", _detail_toggle(details.get("verify_cleanup_spans"))),
        ("LLM suspicious section scan", _detail_toggle(details.get("llm_suspicious_sections"))),
    ]
    ocr_metrics = details.get("ocr_metrics")
    if not isinstance(ocr_metrics, dict):
        return detail_items
    detail_items.extend(
        [
            ("OCR pages", str(ocr_metrics.get("page_count", "n/a"))),
            ("OCR words", str(ocr_metrics.get("word_count", "n/a"))),
        ]
    )
    for key, label in (
        ("mode_usage", "selected preprocess usage"),
        ("tesseract_psm_usage", "selected Tesseract PSM usage"),
    ):
        usage_item = _usage_detail_item(ocr_metrics, key=key, label=label)
        if usage_item is not None:
            detail_items.append(usage_item)
    page_artifacts_manifest_href = details.get("page_artifacts_manifest_href")
    if page_artifacts_manifest_href is not None:
        detail_items.append(
            (
                "local OCR page artifacts manifest",
                f"<a href='{escape(str(page_artifacts_manifest_href))}'>page_ocr/manifest.json</a>",
            )
        )
    return detail_items


def _generated_source_detail_items(summary: dict[str, Any]) -> list[tuple[str, str]]:
    details = summary.get("generated_source_details")
    if not isinstance(details, dict):
        return []
    detail_items = [("generated source", str(summary.get("generated_from", "n/a")))]
    detail_type = details.get("type")
    if detail_type == "local-ocr":
        detail_items.extend(_local_ocr_detail_items(details))
    elif detail_type == "archive-ocr":
        detail_items.append(("archive OCR source", str(details.get("archive_source_mode", "n/a"))))
    return detail_items


def _render_detail_row(label: str, value: str) -> str:
    rendered_value = value if value.startswith("<a ") else escape(value)
    return "<tr>" f"<th>{escape(label)}</th>" f"<td>{rendered_value}</td>" "</tr>"


def _render_generated_source_details(summary: dict[str, Any]) -> str:
    detail_items = _generated_source_detail_items(summary)
    if not detail_items:
        return ""
    return (
        "<h2>Generated EPUB input</h2>"
        "<table><tbody>"
        + "".join(_render_detail_row(label, value) for label, value in detail_items)
        + "</tbody></table>"
    )


def _suspicious_sections_payload(summary: dict[str, Any]) -> tuple[str, list[dict[str, Any]]] | None:
    details = summary.get("generated_source_details")
    if not isinstance(details, dict):
        return None
    ocr_metrics = details.get("ocr_metrics")
    if not isinstance(ocr_metrics, dict):
        return None
    suspicious_sections = ocr_metrics.get("suspicious_sections")
    if not isinstance(suspicious_sections, dict):
        return None
    sections = suspicious_sections.get("sections")
    normalized_sections = [section for section in sections if isinstance(section, dict)] if isinstance(sections, list) else []
    return str(suspicious_sections.get("status", "unknown")), normalized_sections


def _render_focus_spans(section: dict[str, Any]) -> str:
    focus_spans = section.get("focus_spans")
    if not isinstance(focus_spans, list) or not focus_spans:
        return ""
    return (
        "<p><strong>focus spans:</strong> "
        + ", ".join(f"<code>{escape(str(span))}</code>" for span in focus_spans[:3])
        + "</p>"
    )


def _render_suspicious_card(section: dict[str, Any]) -> str:
    page_index = section.get("page_index", "n/a")
    llm_confidence = str(section.get("llm_confidence", "medium"))
    reason = str(section.get("llm_reason", ""))
    excerpt = str(section.get("excerpt", ""))
    return (
        "<section class='card'>"
        f"<h3>Page {escape(str(page_index))}</h3>"
        f"<p><strong>confidence:</strong> {escape(llm_confidence)}</p>"
        f"<p><strong>reason:</strong> {escape(reason)}</p>"
        f"{_render_focus_spans(section)}"
        f"<div class='excerpt'>{escape(excerpt)}</div>"
        "</section>"
    )


def _render_suspicious_sections(summary: dict[str, Any]) -> str:
    payload = _suspicious_sections_payload(summary)
    if payload is None:
        return ""
    status, sections = payload
    if not sections:
        return (
            "<h2>Suspicious generated sections</h2>"
            f"<p>status=<code>{escape(status)}</code>, flagged_sections=<code>0</code></p>"
        )
    cards = [_render_suspicious_card(section) for section in sections]
    return (
        "<h2>Suspicious generated sections</h2>"
        f"<p>status=<code>{escape(status)}</code>, flagged_sections=<code>{len(cards)}</code></p>"
        "<div class='grid'>"
        + "".join(cards)
        + "</div>"
    )


def _render_aligned_section(summary: dict[str, Any]) -> str:
    aligned_section = summary.get("aligned_section")
    if not isinstance(aligned_section, dict):
        return "<p>No aligned scanned-page section could be extracted automatically.</p>"
    pages = aligned_section.get("pages", [])
    if not isinstance(pages, list) or not pages:
        return "<p>No aligned scanned-page section could be extracted automatically.</p>"
    pages_json = json.dumps(pages, ensure_ascii=False).replace("</", "<\\/")
    selected_page_number = int(aligned_section["page_number"])
    auto_selected_page_number = int(aligned_section["auto_selected_page_number"])
    page_options = "".join(
        (
            f"<option value='{int(page['page_number'])}'"
            f"{' selected' if int(page['page_number']) == selected_page_number else ''}>"
            f"Page {int(page['page_number'])}</option>"
        )
        for page in pages
    )
    return (
        "<h2>Aligned scanned page and EPUB excerpts</h2>"
        "<div class='aligned-controls'>"
        "<label for='aligned-page-select'>Compared page</label> "
        f"<select id='aligned-page-select'>{page_options}</select> "
        "<button type='button' id='aligned-page-random'>Random page</button>"
        "</div>"
        "<p>"
        f"selected_pdf_page=<code>{selected_page_number}</code>, "
        f"auto_selected_pdf_page=<code>{auto_selected_page_number}</code>, "
        f"archive_match_score={float(aligned_section['archive_score']):.3f}, "
        f"generated_match_score={float(aligned_section['generated_score']):.3f}"
        "</p>"
        "<div class='tri-grid'>"
        "<section class='card'>"
        f"<h3 id='aligned-page-heading'>Archive scan page {selected_page_number}</h3>"
        f"<img id='aligned-page-image' class='page-image' src='{escape(str(aligned_section['page_image_href']))}' alt='Archive scan page' />"
        f"<p id='aligned-page-text' class='excerpt'>{escape(str(aligned_section['page_text_excerpt']))}</p>"
        "</section>"
        "<section class='card'>"
        "<h3 id='aligned-archive-heading'>Internet Archive EPUB excerpt</h3>"
        f"<div id='aligned-archive-excerpt' class='excerpt'>{escape(str(aligned_section['archive_excerpt']))}</div>"
        "</section>"
        "<section class='card'>"
        "<h3 id='aligned-generated-heading'>Generated EPUB excerpt</h3>"
        f"<div id='aligned-generated-excerpt' class='excerpt'>{escape(str(aligned_section['generated_excerpt']))}</div>"
        "</section>"
        "</div>"
        f"<script id='aligned-pages-data' type='application/json'>{pages_json}</script>"
        "<script>"
        "(() => {"
        "const pages = JSON.parse(document.getElementById('aligned-pages-data').textContent);"
        "if (!Array.isArray(pages) || pages.length === 0) return;"
        "const pageByNumber = new Map(pages.map((page) => [String(page.page_number), page]));"
        "const select = document.getElementById('aligned-page-select');"
        "const randomButton = document.getElementById('aligned-page-random');"
        "const heading = document.getElementById('aligned-page-heading');"
        "const image = document.getElementById('aligned-page-image');"
        "const pageText = document.getElementById('aligned-page-text');"
        "const archiveExcerpt = document.getElementById('aligned-archive-excerpt');"
        "const generatedExcerpt = document.getElementById('aligned-generated-excerpt');"
        "const scoreText = select.parentElement.nextElementSibling;"
        f"const autoSelectedPageNumber = '{auto_selected_page_number}';"
        "const render = (pageNumber, syncUrl = true) => {"
        "  const page = pageByNumber.get(String(pageNumber));"
        "  if (!page) return;"
        "  select.value = String(page.page_number);"
        "  heading.textContent = `Archive scan page ${page.page_number}`;"
        "  image.src = page.page_image_href;"
        "  pageText.textContent = page.page_text_excerpt;"
        "  archiveExcerpt.textContent = page.archive_excerpt;"
        "  generatedExcerpt.textContent = page.generated_excerpt;"
        "  scoreText.innerHTML = "
        "    `selected_pdf_page=<code>${page.page_number}</code>, "
        "auto_selected_pdf_page=<code>${autoSelectedPageNumber}</code>, "
        "archive_match_score=${Number(page.archive_score).toFixed(3)}, "
        "generated_match_score=${Number(page.generated_score).toFixed(3)}`;"
        "  if (syncUrl) {"
        "    const url = new URL(window.location.href);"
        "    url.searchParams.set('page', String(page.page_number));"
        "    window.history.replaceState(null, '', url);"
        "  }"
        "};"
        "select.addEventListener('change', () => render(select.value));"
        "randomButton.addEventListener('click', () => {"
        "  if (pages.length === 1) { render(select.value); return; }"
        "  let nextPage = String(select.value);"
        "  while (nextPage === String(select.value)) {"
        "    nextPage = String(pages[Math.floor(Math.random() * pages.length)].page_number);"
        "  }"
        "  render(nextPage);"
        "});"
        "const requestedPage = new URLSearchParams(window.location.search).get('page');"
        "render(pageByNumber.has(String(requestedPage)) ? requestedPage : select.value, Boolean(requestedPage));"
        "})();"
        "</script>"
    )


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
        ".tri-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1rem 0}"
        ".card{border:1px solid #ddd;border-radius:.4rem;padding:.85rem;background:#fafafa}"
        ".aligned-controls{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:.75rem 0}"
        ".page-image{width:100%;height:auto;border:1px solid #ccc;background:#fff}"
        ".excerpt{white-space:pre-wrap}"
        "code{background:#f3f3f3;padding:0 .2rem;border-radius:.2rem}"
        "ul{margin-top:.4rem}ol{padding-left:1.3rem}"
        "@media (max-width: 1100px){.tri-grid{grid-template-columns:1fr}}"
        "</style></head><body>"
        f"<h1>{escape(summary['title'])}: Internet Archive EPUB vs generated EPUB</h1>"
        "<p>"
        f"identifier=<code>{escape(summary['identifier'])}</code>, "
        f"generated_from=<code>{escape(str(summary['generated_from']))}</code>"
        "</p>"
        "<ul>"
        f"<li><a href='{escape(summary['details_url'])}'>Internet Archive details page</a></li>"
        f"<li><a href='{escape(summary['archive_epub_href'])}'>Downloaded Internet Archive EPUB</a></li>"
        f"<li><a href='{escape(summary['generated_epub_href'])}'>Generated EPUB</a></li>"
        f"<li><a href='{escape(summary['ocr_text_href'])}'>{escape(str(summary['ocr_text_label']))}</a></li>"
        f"{archive_pdf_html}"
        "</ul>"
        f"{_render_generated_source_details(summary)}"
        f"{_render_suspicious_sections(summary)}"
        "<h2>Structure and generation stats</h2>"
        "<table><thead><tr><th>metric</th><th>Internet Archive EPUB</th><th>Generated EPUB</th></tr></thead><tbody>"
        f"{_render_metric_rows(archive_eval, generated_eval, generated_metrics)}"
        "</tbody></table>"
        f"{_render_aligned_section(summary)}"
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


def _validate_compare_page_inputs(
    *,
    generated_source: str,
    archive_source_mode: str,
    selected_pdf_page: int | None,
) -> None:
    if generated_source not in {"local-ocr", "archive-ocr"}:
        raise ValueError("generated_source must be one of: local-ocr, archive-ocr")
    if archive_source_mode not in {"djvu", "abbyy"}:
        raise ValueError("archive_source_mode must be one of: djvu, abbyy")
    if selected_pdf_page is not None and selected_pdf_page < 1:
        raise ValueError("selected_pdf_page must be greater than or equal to 1")


def _prepare_compare_output_dirs(output_html_path: Path) -> tuple[Path, Path, Path]:
    output_dir = output_html_path.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / f"{output_html_path.stem}_assets"
    downloads_dir = assets_dir / "downloads"
    generated_dir = assets_dir / "generated"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    generated_dir.mkdir(parents=True, exist_ok=True)
    return output_dir, assets_dir, downloads_dir


def _archive_download_context(
    metadata: dict[str, Any],
    *,
    archive_identifier: str,
) -> dict[str, Any]:
    files = _normalized_files(metadata)
    archive_epub_filename = _select_archive_filename(files, ".epub")
    if archive_epub_filename is None:
        raise ValueError(f"archive item {archive_identifier!r} does not provide an EPUB download")
    archive_pdf_filename = _select_archive_filename(files, ".pdf")
    metadata_obj = metadata.get("metadata")
    metadata_dict = metadata_obj if isinstance(metadata_obj, dict) else {}
    return {
        "archive_epub_filename": archive_epub_filename,
        "archive_pdf_filename": archive_pdf_filename,
        "metadata_dict": metadata_dict,
    }


def _download_archive_assets(
    *,
    archive_identifier: str,
    archive_epub_filename: str,
    archive_pdf_filename: str | None,
    downloads_dir: Path,
    timeout_seconds: int,
    progress_callback: Callable[[dict[str, object]], None] | None,
) -> tuple[Path, Path | None, str | None]:
    archive_epub_path = downloads_dir / archive_epub_filename
    _emit_archive_progress(progress_callback, status="running", message="Downloading Internet Archive EPUB")
    _download_archive_file(archive_identifier, archive_epub_filename, archive_epub_path, timeout_seconds)
    archive_pdf_path: Path | None = None
    if archive_pdf_filename is not None:
        archive_pdf_path = downloads_dir / archive_pdf_filename
        _emit_archive_progress(progress_callback, status="running", message="Downloading archive scan PDF")
        _download_archive_file(archive_identifier, archive_pdf_filename, archive_pdf_path, timeout_seconds)
    archive_pdf_url = (
        ARCHIVE_DOWNLOAD_URL.format(identifier=archive_identifier, filename=archive_pdf_filename)
        if archive_pdf_filename is not None
        else None
    )
    return archive_epub_path, archive_pdf_path, archive_pdf_url


def _page_artifacts_manifest_href(
    ocr_metrics: dict[str, Any],
    *,
    output_dir: Path,
) -> str | None:
    page_artifacts_manifest = ocr_metrics.get("page_artifacts_manifest")
    if not isinstance(page_artifacts_manifest, str):
        return None
    page_artifacts_manifest_path = Path(page_artifacts_manifest).resolve()
    if not page_artifacts_manifest_path.is_relative_to(output_dir):
        return None
    return _to_rel_href(page_artifacts_manifest_path, output_dir)


def _build_local_ocr_source_payload(
    *,
    archive_identifier: str,
    archive_pdf_path: Path | None,
    assets_dir: Path,
    generated_dir: Path,
    output_dir: Path,
    page_artifacts_dir: Path | None,
    progress_callback: Callable[[dict[str, object]], None] | None,
    resolved_ocr_language: str,
    dpi: int,
    apply_cleanup: bool,
    preprocess_mode: str,
    binarize_threshold: int,
    deskew_max_angle: float,
    deskew_angle_step: float,
    tesseract_psm: str,
    ocr_engine: str,
    emit_page_artifacts: bool,
    inverse_render_rerank: bool,
    inverse_render_top_k: int,
    inverse_render_workers: int,
    verify_cleanup_spans: bool,
    llm_suspicious_sections: bool,
    llm_suspicious_max_candidates: int,
    llm_suspicious_max_sections: int,
) -> dict[str, Any]:
    if archive_pdf_path is None:
        raise ValueError(
            f"archive item {archive_identifier!r} does not provide a PDF needed for local OCR generation"
        )
    generated_source_slug = "local_ocr"
    ocr_text_path = assets_dir / f"{archive_identifier}_{generated_source_slug}.txt"
    resolved_page_artifacts_dir = page_artifacts_dir or (assets_dir / "page_ocr")
    ocr_metrics = ocr_pdf_with_tesseract(
        pdf_path=archive_pdf_path,
        output_text_path=ocr_text_path,
        work_dir=generated_dir / "local_ocr_work",
        language=resolved_ocr_language,
        dpi=dpi,
        apply_cleanup=apply_cleanup,
        preprocess_mode=preprocess_mode,
        binarize_threshold=binarize_threshold,
        deskew_max_angle=deskew_max_angle,
        deskew_angle_step=deskew_angle_step,
        tesseract_psm=tesseract_psm,
        ocr_engine=ocr_engine,
        emit_page_artifacts=emit_page_artifacts,
        page_artifacts_dir=resolved_page_artifacts_dir,
        inverse_render_rerank=inverse_render_rerank,
        inverse_render_top_k=inverse_render_top_k,
        inverse_render_workers=inverse_render_workers,
        verify_cleanup_spans=verify_cleanup_spans,
        llm_suspicious_sections=llm_suspicious_sections,
        llm_suspicious_max_candidates=llm_suspicious_max_candidates,
        llm_suspicious_max_sections=llm_suspicious_max_sections,
        progress_callback=progress_callback,
    )
    return {
        "generated_source_slug": generated_source_slug,
        "generated_from": "local OCR on archive PDF",
        "ocr_text_label": "Local OCR text used for generation",
        "ocr_text_path": ocr_text_path,
        "ocr_text": ocr_text_path.read_text(encoding="utf-8"),
        "generated_source_details": {
            "type": "local-ocr",
            "ocr_language": resolved_ocr_language,
            "ocr_engine": ocr_engine,
            "preprocess_mode": preprocess_mode,
            "tesseract_psm": tesseract_psm,
            "apply_cleanup": apply_cleanup,
            "inverse_render_rerank": inverse_render_rerank,
            "inverse_render_top_k": inverse_render_top_k,
            "inverse_render_workers": inverse_render_workers,
            "verify_cleanup_spans": verify_cleanup_spans,
            "llm_suspicious_sections": llm_suspicious_sections,
            "llm_suspicious_max_candidates": llm_suspicious_max_candidates,
            "llm_suspicious_max_sections": llm_suspicious_max_sections,
            "ocr_metrics": ocr_metrics,
            "page_artifacts_manifest_href": _page_artifacts_manifest_href(
                ocr_metrics,
                output_dir=output_dir,
            ),
        },
    }


def _build_archive_ocr_source_payload(
    *,
    archive_identifier: str,
    archive_source_mode: str,
    assets_dir: Path,
    timeout_seconds: int,
) -> dict[str, Any]:
    if archive_source_mode == "djvu":
        ocr_text = fetch_archive_ocr_text(archive_identifier, timeout_seconds=timeout_seconds)
    else:
        ocr_text = fetch_archive_abbyy_text(archive_identifier, timeout_seconds=timeout_seconds)
        if ocr_text is None:
            raise ValueError(f"archive item {archive_identifier!r} does not provide ABBYY OCR text")
    generated_source_slug = archive_source_mode
    ocr_text_path = assets_dir / f"{archive_identifier}_{generated_source_slug}.txt"
    ocr_text_path.write_text(ocr_text, encoding="utf-8")
    return {
        "generated_source_slug": generated_source_slug,
        "generated_from": f"archive {archive_source_mode} OCR text",
        "ocr_text_label": "Archive OCR text used for generation",
        "ocr_text_path": ocr_text_path,
        "ocr_text": ocr_text,
        "generated_source_details": {
            "type": "archive-ocr",
            "archive_source_mode": archive_source_mode,
        },
    }


def _compare_summary(
    *,
    archive_identifier: str,
    title: str,
    generated_source: str,
    generated_from: str,
    archive_source_mode: str,
    generated_source_details: dict[str, Any],
    ocr_text_label: str,
    archive_pdf_url: str | None,
    archive_epub_path: Path,
    generated_epub_path: Path,
    ocr_text_path: Path,
    output_dir: Path,
    archive_eval: dict[str, Any],
    generated_eval: dict[str, Any],
    generated_metrics: dict[str, Any],
    archive_preview: dict[str, Any],
    generated_preview: dict[str, Any],
    aligned_section: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "identifier": archive_identifier,
        "title": title,
        "generated_source": generated_source,
        "generated_from": generated_from,
        "archive_source": archive_source_mode,
        "generated_source_details": generated_source_details,
        "ocr_text_label": ocr_text_label,
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
        "aligned_section": aligned_section,
    }


def build_archive_epub_compare_page(
    *,
    archive_identifier: str,
    output_html_path: Path,
    generated_source: str = "local-ocr",
    archive_source_mode: str = "djvu",
    timeout_seconds: int = 60,
    run_epubcheck: bool = False,
    selected_pdf_page: int | None = None,
    ocr_language: str | None = None,
    dpi: int = 300,
    ocr_engine: str = "tesseract",
    preprocess_mode: str = "auto",
    binarize_threshold: int = 190,
    deskew_max_angle: float = 3.0,
    deskew_angle_step: float = 0.5,
    tesseract_psm: str = "auto",
    apply_cleanup: bool = True,
    emit_page_artifacts: bool = True,
    page_artifacts_dir: Path | None = None,
    inverse_render_rerank: bool = False,
    inverse_render_top_k: int = 3,
    inverse_render_workers: int = 1,
    verify_cleanup_spans: bool = False,
    llm_suspicious_sections: bool = False,
    llm_suspicious_max_candidates: int = 12,
    llm_suspicious_max_sections: int = 6,
    progress_callback: Callable[[dict[str, object]], None] | None = None,
) -> dict[str, Any]:
    """Build a local HTML page comparing an archive.org EPUB with a generated EPUB."""

    _validate_compare_page_inputs(
        generated_source=generated_source,
        archive_source_mode=archive_source_mode,
        selected_pdf_page=selected_pdf_page,
    )
    _emit_archive_progress(progress_callback, status="running", message="Fetching archive metadata")
    metadata = fetch_metadata(archive_identifier, timeout_seconds=timeout_seconds)
    archive_context = _archive_download_context(metadata, archive_identifier=archive_identifier)
    metadata_dict = archive_context["metadata_dict"]
    title = _extract_first_string(metadata_dict.get("title")) or archive_identifier
    language = _normalize_language(metadata_dict.get("language"))
    resolved_ocr_language = ocr_language or _normalize_ocr_language(metadata_dict.get("language"))

    output_dir, assets_dir, downloads_dir = _prepare_compare_output_dirs(output_html_path)
    generated_dir = assets_dir / "generated"
    archive_epub_path, archive_pdf_path, archive_pdf_url = _download_archive_assets(
        archive_identifier=archive_identifier,
        archive_epub_filename=archive_context["archive_epub_filename"],
        archive_pdf_filename=archive_context["archive_pdf_filename"],
        downloads_dir=downloads_dir,
        timeout_seconds=timeout_seconds,
        progress_callback=progress_callback,
    )

    if generated_source == "local-ocr":
        source_payload = _build_local_ocr_source_payload(
            archive_identifier=archive_identifier,
            archive_pdf_path=archive_pdf_path,
            assets_dir=assets_dir,
            generated_dir=generated_dir,
            output_dir=output_dir,
            page_artifacts_dir=page_artifacts_dir,
            progress_callback=progress_callback,
            resolved_ocr_language=resolved_ocr_language,
            dpi=dpi,
            apply_cleanup=apply_cleanup,
            preprocess_mode=preprocess_mode,
            binarize_threshold=binarize_threshold,
            deskew_max_angle=deskew_max_angle,
            deskew_angle_step=deskew_angle_step,
            tesseract_psm=tesseract_psm,
            ocr_engine=ocr_engine,
            emit_page_artifacts=emit_page_artifacts,
            inverse_render_rerank=inverse_render_rerank,
            inverse_render_top_k=inverse_render_top_k,
            inverse_render_workers=inverse_render_workers,
            verify_cleanup_spans=verify_cleanup_spans,
            llm_suspicious_sections=llm_suspicious_sections,
            llm_suspicious_max_candidates=llm_suspicious_max_candidates,
            llm_suspicious_max_sections=llm_suspicious_max_sections,
        )
    else:
        source_payload = _build_archive_ocr_source_payload(
            archive_identifier=archive_identifier,
            archive_source_mode=archive_source_mode,
            assets_dir=assets_dir,
            timeout_seconds=timeout_seconds,
        )

    generated_epub_path = generated_dir / f"{archive_identifier}_{source_payload['generated_source_slug']}_generated.epub"
    _emit_archive_progress(progress_callback, status="running", message="Building generated EPUB")
    generated_metrics = build_epub_from_ocr_text(
        ocr_text=source_payload["ocr_text"],
        output_path=generated_epub_path,
        title=title,
        language=language,
        apply_cleanup=True,
    )

    _emit_archive_progress(progress_callback, status="running", message="Evaluating EPUB structure")
    archive_eval = evaluate_epub_structure(archive_epub_path, run_epubcheck=run_epubcheck)
    generated_eval = evaluate_epub_structure(generated_epub_path, run_epubcheck=run_epubcheck)
    archive_preview = _epub_preview(archive_epub_path)
    generated_preview = _epub_preview(generated_epub_path)
    aligned_section = (
        _build_aligned_section(
            archive_pdf_path=archive_pdf_path,
            archive_epub_path=archive_epub_path,
            generated_epub_path=generated_epub_path,
            image_output_dir=assets_dir,
            href_base_dir=output_dir,
            selected_page_number=selected_pdf_page,
        )
        if archive_pdf_path is not None
        else None
    )

    summary = _compare_summary(
        archive_identifier=archive_identifier,
        title=title,
        generated_source=generated_source,
        generated_from=source_payload["generated_from"],
        archive_source_mode=archive_source_mode,
        generated_source_details=source_payload["generated_source_details"],
        ocr_text_label=source_payload["ocr_text_label"],
        archive_pdf_url=archive_pdf_url,
        archive_epub_path=archive_epub_path,
        generated_epub_path=generated_epub_path,
        ocr_text_path=source_payload["ocr_text_path"],
        output_dir=output_dir,
        archive_eval=archive_eval,
        generated_eval=generated_eval,
        generated_metrics=generated_metrics,
        archive_preview=archive_preview,
        generated_preview=generated_preview,
        aligned_section=aligned_section,
    )
    (assets_dir / "compare_summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    output_html_path.write_text(_render_compare_page(summary), encoding="utf-8")
    _emit_archive_progress(progress_callback, status="complete", message="Archive compare page ready")
    return {
        "archive_identifier": archive_identifier,
        "title": title,
        "output_html_path": str(output_html_path),
        "archive_epub_path": str(archive_epub_path),
        "generated_epub_path": str(generated_epub_path),
        "generated_source": generated_source,
        "archive_source": archive_source_mode,
        "selected_pdf_page": selected_pdf_page,
    }
