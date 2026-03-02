"""HTML visualization helpers for local OCR benchmark failures."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import html
import json
from pathlib import Path
import re
from typing import Any

from .ocr_cleanup import cleanup_ocr_text

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9']+")


@dataclass(frozen=True)
class _ModeSectionInputs:
    mode_name: str
    mode_payload: dict[str, Any]
    report_dir: Path
    output_dir: Path
    reference_text: str
    max_failures: int
    max_pages_per_token: int


@dataclass(frozen=True)
class _UnexpectedTokenInputs:
    token: str
    count: int
    pages: list[dict[str, Any]]
    report_dir: Path
    output_dir: Path
    max_pages_per_token: int


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
    missing = _token_delta(reference_counts, hypothesis_counts, positive_only=True)
    unexpected = _token_delta(hypothesis_counts, reference_counts, positive_only=True)
    return {
        "missing": missing[:max_failures],
        "unexpected": unexpected[:max_failures],
    }


def _token_delta(
    left_counts: Counter[str],
    right_counts: Counter[str],
    *,
    positive_only: bool,
) -> list[tuple[str, int]]:
    results: list[tuple[str, int]] = []
    for token, left_count in left_counts.items():
        delta = left_count - right_counts.get(token, 0)
        if not positive_only or delta > 0:
            results.append((token, delta))
    results.sort(key=lambda item: (-item[1], item[0]))
    return results


def _load_page_manifest(mode_payload: dict[str, Any], report_dir: Path) -> list[dict[str, Any]]:
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
    normalized_pages = [page for page in pages if isinstance(page, dict)]
    normalized_pages.sort(key=lambda item: int(item.get("page_index", 0)))
    return normalized_pages


def _load_mode_hypothesis_text(mode_payload: dict[str, Any], report_dir: Path) -> str:
    output_text = _read_mode_output_text(mode_payload, report_dir)
    if output_text is not None:
        return output_text
    page_texts = _read_page_manifest_texts(mode_payload, report_dir)
    return cleanup_ocr_text("\n\n".join(page_texts))


def _read_mode_output_text(mode_payload: dict[str, Any], report_dir: Path) -> str | None:
    output_text_value = mode_payload.get("output_text_path")
    if not isinstance(output_text_value, str):
        return None
    output_text_path = _resolve_path(output_text_value, report_dir)
    if not output_text_path.exists():
        return None
    return output_text_path.read_text(encoding="utf-8")


def _read_page_manifest_texts(mode_payload: dict[str, Any], report_dir: Path) -> list[str]:
    pages = _load_page_manifest(mode_payload, report_dir)
    texts: list[str] = []
    for page in pages:
        text_path_value = page.get("text_path")
        if not isinstance(text_path_value, str):
            continue
        text_path = _resolve_path(text_path_value, report_dir)
        if text_path.exists():
            texts.append(text_path.read_text(encoding="utf-8"))
    return texts


def _build_page_token_index(
    pages: list[dict[str, Any]],
    report_dir: Path,
) -> dict[str, list[dict[str, Any]]]:
    token_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for page in pages:
        page_text = _read_page_text(page, report_dir)
        if page_text is None:
            continue
        for token in set(_tokenize(page_text)):
            token_index[token].append(page)
    return token_index


def _read_page_text(page: dict[str, Any], report_dir: Path) -> str | None:
    text_path_value = page.get("text_path")
    if not isinstance(text_path_value, str):
        return None
    text_path = _resolve_path(text_path_value, report_dir)
    if not text_path.exists():
        return None
    return text_path.read_text(encoding="utf-8")


def _ranked_mode_names(report: dict[str, Any], modes_payload: dict[str, Any]) -> list[str]:
    ranked_modes = _modes_from_ranking_payload(report.get("mode_ranking"))
    for mode_name in modes_payload.keys():
        if isinstance(mode_name, str) and mode_name not in ranked_modes:
            ranked_modes.append(mode_name)
    return ranked_modes


def _modes_from_ranking_payload(mode_ranking: Any) -> list[str]:
    ranked_modes: list[str] = []
    if not isinstance(mode_ranking, list):
        return ranked_modes
    for item in mode_ranking:
        if isinstance(item, dict) and isinstance(item.get("mode"), str):
            ranked_modes.append(str(item["mode"]))
    return ranked_modes


def _render_missing_rows(missing: list[tuple[str, int]]) -> str:
    rows = [
        f"<tr><td>{html.escape(token)}</td><td>{count}</td></tr>"
        for token, count in missing
    ]
    return "\n".join(rows) or "<tr><td colspan='2'>No missing tokens detected.</td></tr>"


def _render_unexpected_html(
    unexpected: list[tuple[str, int]],
    page_token_index: dict[str, list[dict[str, Any]]],
    report_dir: Path,
    output_dir: Path,
    max_pages_per_token: int,
) -> str:
    parts = [
        _render_unexpected_token(
            _UnexpectedTokenInputs(
                token=token,
                count=count,
                pages=page_token_index.get(token, []),
                report_dir=report_dir,
                output_dir=output_dir,
                max_pages_per_token=max_pages_per_token,
            )
        )
        for token, count in unexpected
    ]
    return "\n".join(parts) or "<p>No unexpected tokens detected.</p>"


def _render_unexpected_token(inputs: _UnexpectedTokenInputs) -> str:
    page_cards = [
        _render_page_card(page, inputs.report_dir, inputs.output_dir)
        for page in inputs.pages[: inputs.max_pages_per_token]
    ]
    pages_html = (
        "".join(page_cards)
        or "<div class='snippet'>No matching page artifacts found.</div>"
    )
    return (
        "<details>"
        f"<summary><code>{html.escape(inputs.token)}</code> (+{inputs.count})</summary>"
        f"<div class='page-grid'>{pages_html}</div>"
        "</details>"
    )


def _render_page_card(page: dict[str, Any], report_dir: Path, output_dir: Path) -> str:
    page_index = html.escape(str(page.get("page_index", "?")))
    snippet = html.escape(_page_snippet(page, report_dir) or "[no page text snippet]")
    image_html = _render_page_image(page, report_dir, output_dir)
    return (
        "<div class='page-card'>"
        f"<div><strong>page {page_index}</strong></div>"
        f"{image_html}"
        f"<div class='snippet'>{snippet}</div>"
        "</div>"
    )


def _page_snippet(page: dict[str, Any], report_dir: Path) -> str:
    text_path_value = page.get("text_path")
    if not isinstance(text_path_value, str):
        return ""
    text_path = _resolve_path(text_path_value, report_dir)
    if not text_path.exists():
        return ""
    return text_path.read_text(encoding="utf-8").strip().replace("\n", " ")[:240]


def _render_page_image(page: dict[str, Any], report_dir: Path, output_dir: Path) -> str:
    image_value = page.get("ocr_input_path") or page.get("image_path")
    if not isinstance(image_value, str):
        return ""
    image_path = _resolve_path(image_value, report_dir)
    if not image_path.exists():
        return ""
    image_href = html.escape(_to_href(image_path, output_dir))
    return (
        f"<div><img loading='lazy' src='{image_href}' "
        "alt='OCR page image' /></div>"
    )


def _accuracy_tuple(mode_payload: dict[str, Any]) -> tuple[float, float, float, float]:
    accuracy = mode_payload.get("accuracy", {})
    if not isinstance(accuracy, dict):
        return 0.0, 0.0, 0.0, 0.0
    return (
        float(accuracy.get("char_accuracy", 0.0)),
        float(accuracy.get("word_accuracy", 0.0)),
        float(accuracy.get("wer", 0.0)),
        float(accuracy.get("cer", 0.0)),
    )


def _render_mode_section(inputs: _ModeSectionInputs) -> str:
    hypothesis_text = _load_mode_hypothesis_text(inputs.mode_payload, inputs.report_dir)
    failures = _summarize_token_failures(
        inputs.reference_text,
        hypothesis_text,
        max_failures=inputs.max_failures,
    )
    pages = _load_page_manifest(inputs.mode_payload, inputs.report_dir)
    page_token_index = _build_page_token_index(pages, inputs.report_dir)
    missing_rows = _render_missing_rows(failures["missing"])
    unexpected_html = _render_unexpected_html(
        failures["unexpected"],
        page_token_index,
        inputs.report_dir,
        inputs.output_dir,
        inputs.max_pages_per_token,
    )
    char_accuracy, word_accuracy, wer, cer = _accuracy_tuple(inputs.mode_payload)
    return (
        "<section class='mode'>"
        f"<h2>Mode: {html.escape(inputs.mode_name)}</h2>"
        "<p>"
        f"char_accuracy={char_accuracy:.4f}, "
        f"word_accuracy={word_accuracy:.4f}, "
        f"wer={wer:.4f}, "
        f"cer={cer:.4f}"
        "</p>"
        "<h3>Missing reference tokens</h3>"
        "<table><thead><tr><th>token</th><th>missing_count</th></tr></thead>"
        f"<tbody>{missing_rows}</tbody></table>"
        "<h3>Unexpected OCR tokens (click to inspect page images)</h3>"
        f"{unexpected_html}"
        "</section>"
    )


def _render_html_document(
    report_path: Path,
    report: dict[str, Any],
    mode_sections: list[str],
) -> str:
    archive_identifier = html.escape(str(report.get("archive_identifier", "n/a")))
    selected_source = html.escape(str(report.get("selected_archive_source", "n/a")))
    best_mode = html.escape(str(report.get("best_mode", "n/a")))
    escaped_report_path = html.escape(str(report_path))
    return (
        "<!doctype html><html><head><meta charset='utf-8' />"
        "<title>OCR Benchmark Failures</title>"
        "<style>"
        "body{font-family:system-ui,Arial,sans-serif;margin:1rem 2rem;line-height:1.4}"
        "h1,h2,h3{margin:.6rem 0}.mode{border-top:1px solid #ddd;padding-top:1rem;margin-top:1rem}"
        "table{border-collapse:collapse;width:100%;max-width:44rem}"
        "th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}"
        ".page-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));"
        "gap:.7rem;margin:.5rem 0}"
        ".page-card{border:1px solid #ddd;padding:.5rem;border-radius:.3rem;background:#fafafa}"
        ".page-card img{max-width:100%;height:auto;border:1px solid #ccc;background:#fff}"
        ".snippet{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;"
        "white-space:pre-wrap}"
        "code{background:#f3f3f3;padding:0 .2rem;border-radius:.2rem}"
        "</style></head><body>"
        "<h1>Local OCR Benchmark Failure Explorer</h1>"
        "<p>"
        f"archive_identifier={archive_identifier}, "
        f"selected_source={selected_source}, "
        f"best_mode={best_mode}"
        "</p>"
        f"<p>report={escaped_report_path}</p>"
        + "".join(mode_sections)
        + "</body></html>\n"
    )


def build_local_benchmark_failure_page(
    report_path: Path,
    output_html_path: Path,
    max_failures: int = 50,
    max_pages_per_token: int = 3,
) -> dict[str, Any]:
    """Render an HTML report that highlights token-level OCR failures by mode."""

    report = json.loads(report_path.read_text(encoding="utf-8"))
    report_dir = report_path.parent
    reference_text = _load_reference_text(report, report_dir)
    modes_payload = _validated_modes_payload(report)
    ranked_modes = _ranked_mode_names(report, modes_payload)
    output_dir = output_html_path.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    mode_sections: list[str] = []
    for mode_name in ranked_modes:
        mode_payload = modes_payload.get(mode_name)
        if not isinstance(mode_payload, dict):
            continue
        inputs = _ModeSectionInputs(
            mode_name=mode_name,
            mode_payload=mode_payload,
            report_dir=report_dir,
            output_dir=output_dir,
            reference_text=reference_text,
            max_failures=max_failures,
            max_pages_per_token=max_pages_per_token,
        )
        mode_sections.append(_render_mode_section(inputs))

    html_output = _render_html_document(report_path, report, mode_sections)
    output_html_path.write_text(html_output, encoding="utf-8")
    return {
        "report_path": str(report_path),
        "output_html_path": str(output_html_path),
        "mode_count": len(mode_sections),
        "best_mode": str(report.get("best_mode", "n/a")),
    }


def _load_reference_text(report: dict[str, Any], report_dir: Path) -> str:
    reference_path_value = report.get("reference_text_path")
    if not isinstance(reference_path_value, str):
        raise ValueError("Report must contain reference_text_path")
    reference_path = _resolve_path(reference_path_value, report_dir)
    if not reference_path.exists():
        raise FileNotFoundError(f"Reference text not found: {reference_path}")
    return reference_path.read_text(encoding="utf-8")


def _validated_modes_payload(report: dict[str, Any]) -> dict[str, Any]:
    modes_payload = report.get("modes")
    if not isinstance(modes_payload, dict):
        raise ValueError("Report must contain modes")
    return modes_payload
