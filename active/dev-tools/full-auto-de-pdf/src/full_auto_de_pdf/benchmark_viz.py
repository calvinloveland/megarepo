from __future__ import annotations

from collections import Counter, defaultdict
import html
import json
from pathlib import Path
import re
from typing import Any

from .ocr_cleanup import cleanup_ocr_text

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9']+")


def _tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)]


def _resolve_path(path_value: str, report_dir: Path) -> Path:
    candidate = Path(path_value)
    if candidate.is_absolute():
        return candidate
    report_relative = report_dir / candidate
    if report_relative.exists():
        return report_relative
    cwd_relative = Path.cwd() / candidate
    if cwd_relative.exists():
        return cwd_relative
    return report_relative


def _to_href(path: Path, output_dir: Path) -> str:
    try:
        return path.relative_to(output_dir).as_posix()
    except ValueError:
        return path.resolve().as_uri()


def _summarize_token_failures(
    reference_text: str,
    hypothesis_text: str,
    max_failures: int,
) -> dict[str, list[tuple[str, int]]]:
    reference_counts = Counter(_tokenize(reference_text))
    hypothesis_counts = Counter(_tokenize(hypothesis_text))
    missing: list[tuple[str, int]] = []
    unexpected: list[tuple[str, int]] = []
    for token, reference_count in reference_counts.items():
        hypothesis_count = hypothesis_counts.get(token, 0)
        if reference_count > hypothesis_count:
            missing.append((token, reference_count - hypothesis_count))
    for token, hypothesis_count in hypothesis_counts.items():
        reference_count = reference_counts.get(token, 0)
        if hypothesis_count > reference_count:
            unexpected.append((token, hypothesis_count - reference_count))
    missing.sort(key=lambda item: (-item[1], item[0]))
    unexpected.sort(key=lambda item: (-item[1], item[0]))
    return {
        "missing": missing[:max_failures],
        "unexpected": unexpected[:max_failures],
    }


def _load_page_manifest(
    mode_payload: dict[str, Any],
    report_dir: Path,
) -> list[dict[str, Any]]:
    manifest_value = mode_payload.get("page_artifacts_manifest")
    if not isinstance(manifest_value, str):
        return []
    manifest_path = _resolve_path(manifest_value, report_dir)
    if not manifest_path.exists():
        return []
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    pages = payload.get("pages")
    if not isinstance(pages, list):
        return []
    normalized_pages: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        normalized_pages.append(page)
    normalized_pages.sort(key=lambda item: int(item.get("page_index", 0)))
    return normalized_pages


def _load_mode_hypothesis_text(
    mode_payload: dict[str, Any],
    report_dir: Path,
) -> str:
    output_text_value = mode_payload.get("output_text_path")
    if isinstance(output_text_value, str):
        output_text_path = _resolve_path(output_text_value, report_dir)
        if output_text_path.exists():
            return output_text_path.read_text(encoding="utf-8")

    pages = _load_page_manifest(mode_payload, report_dir)
    page_texts: list[str] = []
    for page in pages:
        text_path_value = page.get("text_path")
        if not isinstance(text_path_value, str):
            continue
        text_path = _resolve_path(text_path_value, report_dir)
        if not text_path.exists():
            continue
        page_texts.append(text_path.read_text(encoding="utf-8"))
    combined = "\n\n".join(page_texts)
    return cleanup_ocr_text(combined)


def _build_page_token_index(
    pages: list[dict[str, Any]],
    report_dir: Path,
) -> dict[str, list[dict[str, Any]]]:
    token_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for page in pages:
        text_path_value = page.get("text_path")
        if not isinstance(text_path_value, str):
            continue
        text_path = _resolve_path(text_path_value, report_dir)
        if not text_path.exists():
            continue
        page_text = text_path.read_text(encoding="utf-8")
        tokens = set(_tokenize(page_text))
        for token in tokens:
            token_index[token].append(page)
    return token_index


def build_local_benchmark_failure_page(
    report_path: Path,
    output_html_path: Path,
    max_failures: int = 50,
    max_pages_per_token: int = 3,
) -> dict[str, Any]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report_dir = report_path.parent
    reference_path_value = report.get("reference_text_path")
    if not isinstance(reference_path_value, str):
        raise ValueError("Report must contain reference_text_path")
    reference_path = _resolve_path(reference_path_value, report_dir)
    if not reference_path.exists():
        raise FileNotFoundError(f"Reference text not found: {reference_path}")
    reference_text = reference_path.read_text(encoding="utf-8")

    modes_payload = report.get("modes")
    if not isinstance(modes_payload, dict):
        raise ValueError("Report must contain modes")
    mode_ranking = report.get("mode_ranking")
    ranked_modes: list[str] = []
    if isinstance(mode_ranking, list):
        for item in mode_ranking:
            if isinstance(item, dict) and isinstance(item.get("mode"), str):
                ranked_modes.append(str(item["mode"]))
    for mode_name in modes_payload.keys():
        if isinstance(mode_name, str) and mode_name not in ranked_modes:
            ranked_modes.append(mode_name)

    output_dir = output_html_path.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    mode_sections: list[str] = []
    for mode_name in ranked_modes:
        raw_mode_payload = modes_payload.get(mode_name)
        if not isinstance(raw_mode_payload, dict):
            continue
        mode_payload = raw_mode_payload
        hypothesis_text = _load_mode_hypothesis_text(mode_payload, report_dir)
        failures = _summarize_token_failures(reference_text, hypothesis_text, max_failures=max_failures)
        pages = _load_page_manifest(mode_payload, report_dir)
        page_token_index = _build_page_token_index(pages, report_dir)

        missing_rows = "\n".join(
            f"<tr><td>{html.escape(token)}</td><td>{count}</td></tr>"
            for token, count in failures["missing"]
        ) or "<tr><td colspan='2'>No missing tokens detected.</td></tr>"

        unexpected_parts: list[str] = []
        for token, count in failures["unexpected"]:
            page_cards: list[str] = []
            for page in page_token_index.get(token, [])[:max_pages_per_token]:
                image_value = page.get("ocr_input_path") or page.get("image_path")
                page_index = page.get("page_index", "?")
                snippet = ""
                text_path_value = page.get("text_path")
                if isinstance(text_path_value, str):
                    text_path = _resolve_path(text_path_value, report_dir)
                    if text_path.exists():
                        snippet = text_path.read_text(encoding="utf-8").strip().replace("\n", " ")[:240]
                image_html = ""
                if isinstance(image_value, str):
                    image_path = _resolve_path(image_value, report_dir)
                    if image_path.exists():
                        image_html = (
                            f"<div><img loading='lazy' src='{html.escape(_to_href(image_path, output_dir))}' "
                            "alt='OCR page image' /></div>"
                        )
                page_cards.append(
                    "<div class='page-card'>"
                    f"<div><strong>page {html.escape(str(page_index))}</strong></div>"
                    f"{image_html}"
                    f"<div class='snippet'>{html.escape(snippet or '[no page text snippet]')}</div>"
                    "</div>"
                )
            pages_html = "".join(page_cards) or "<div class='snippet'>No matching page artifacts found.</div>"
            unexpected_parts.append(
                "<details>"
                f"<summary><code>{html.escape(token)}</code> (+{count})</summary>"
                f"<div class='page-grid'>{pages_html}</div>"
                "</details>"
            )
        unexpected_html = "\n".join(unexpected_parts) or "<p>No unexpected tokens detected.</p>"

        accuracy_payload = mode_payload.get("accuracy", {})
        if not isinstance(accuracy_payload, dict):
            accuracy_payload = {}
        char_accuracy = float(accuracy_payload.get("char_accuracy", 0.0))
        word_accuracy = float(accuracy_payload.get("word_accuracy", 0.0))
        wer = float(accuracy_payload.get("wer", 0.0))
        cer = float(accuracy_payload.get("cer", 0.0))
        mode_sections.append(
            "<section class='mode'>"
            f"<h2>Mode: {html.escape(mode_name)}</h2>"
            f"<p>char_accuracy={char_accuracy:.4f}, word_accuracy={word_accuracy:.4f}, wer={wer:.4f}, cer={cer:.4f}</p>"
            "<h3>Missing reference tokens</h3>"
            "<table><thead><tr><th>token</th><th>missing_count</th></tr></thead>"
            f"<tbody>{missing_rows}</tbody></table>"
            "<h3>Unexpected OCR tokens (click to inspect page images)</h3>"
            f"{unexpected_html}"
            "</section>"
        )

    archive_identifier = str(report.get("archive_identifier", "n/a"))
    selected_source = str(report.get("selected_archive_source", "n/a"))
    best_mode = str(report.get("best_mode", "n/a"))
    html_output = (
        "<!doctype html><html><head><meta charset='utf-8' />"
        "<title>OCR Benchmark Failures</title>"
        "<style>"
        "body{font-family:system-ui,Arial,sans-serif;margin:1rem 2rem;line-height:1.4}"
        "h1,h2,h3{margin:.6rem 0}.mode{border-top:1px solid #ddd;padding-top:1rem;margin-top:1rem}"
        "table{border-collapse:collapse;width:100%;max-width:44rem}"
        "th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}"
        ".page-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem;margin:.5rem 0}"
        ".page-card{border:1px solid #ddd;padding:.5rem;border-radius:.3rem;background:#fafafa}"
        ".page-card img{max-width:100%;height:auto;border:1px solid #ccc;background:#fff}"
        ".snippet{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;white-space:pre-wrap}"
        "code{background:#f3f3f3;padding:0 .2rem;border-radius:.2rem}"
        "</style></head><body>"
        "<h1>Local OCR Benchmark Failure Explorer</h1>"
        f"<p>archive_identifier={html.escape(archive_identifier)}, selected_source={html.escape(selected_source)}, best_mode={html.escape(best_mode)}</p>"
        f"<p>report={html.escape(str(report_path))}</p>"
        + "".join(mode_sections)
        + "</body></html>\n"
    )
    output_html_path.write_text(html_output, encoding="utf-8")
    return {
        "report_path": str(report_path),
        "output_html_path": str(output_html_path),
        "mode_count": len(mode_sections),
        "best_mode": best_mode,
    }
