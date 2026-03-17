"""HTML visualization helpers for local OCR benchmark inspection pages."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
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
    max_example_pages: int


@dataclass(frozen=True)
class _UnexpectedTokenInputs:
    token: str
    count: int
    pages: list[dict[str, Any]]
    report_dir: Path
    output_dir: Path
    max_pages_per_token: int


@dataclass(frozen=True)
class _ProcessingModeInputs:
    mode_name: str
    mode_payload: dict[str, Any]
    report_dir: Path
    output_dir: Path
    max_example_pages: int


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
    resolved_output_dir = output_dir.resolve()
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(resolved_output_dir).as_posix()
    except ValueError:
        copied_asset_path = _copy_asset_into_output_dir(resolved_path, resolved_output_dir)
        return copied_asset_path.relative_to(resolved_output_dir).as_posix()


def _copy_asset_into_output_dir(path: Path, output_dir: Path) -> Path:
    digest = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:12]
    asset_dir = output_dir / "_assets" / digest
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_path = asset_dir / path.name
    if not asset_path.exists():
        shutil.copy2(path, asset_path)
        return asset_path
    source_stat = path.stat()
    asset_stat = asset_path.stat()
    if source_stat.st_size != asset_stat.st_size or source_stat.st_mtime_ns != asset_stat.st_mtime_ns:
        shutil.copy2(path, asset_path)
    return asset_path


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
    normalized_pages = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        normalized_page = dict(page)
        normalized_page["_artifacts_dir"] = str(manifest_path.parent)
        normalized_page["_work_dir"] = str(manifest_path.parent.parent)
        normalized_pages.append(normalized_page)
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
    return _render_page_example_card(
        page,
        report_dir,
        output_dir,
        include_candidate_runs=False,
        include_processing_gallery=False,
    )


def _render_page_example_card(
    page: dict[str, Any],
    report_dir: Path,
    output_dir: Path,
    *,
    include_candidate_runs: bool,
    include_processing_gallery: bool,
) -> str:
    page_index = html.escape(str(page.get("page_index", "?")))
    snippet = html.escape(_page_snippet(page, report_dir) or "[no page text snippet]")
    image_html = _render_page_image_gallery(
        page,
        report_dir,
        output_dir,
        include_processing_gallery=include_processing_gallery,
    )
    metadata_html = _render_page_metadata(page)
    candidate_html = (
        _render_candidate_runs_table(page)
        if include_candidate_runs
        else ""
    )
    return (
        "<article class='page-card'>"
        f"<div><strong>page {page_index}</strong></div>"
        f"{image_html}"
        f"{metadata_html}"
        f"<div class='snippet'>{snippet}</div>"
        f"{candidate_html}"
        "</article>"
    )


def _page_snippet(page: dict[str, Any], report_dir: Path) -> str:
    text_path_value = page.get("text_path")
    if not isinstance(text_path_value, str):
        return ""
    text_path = _resolve_path(text_path_value, report_dir)
    if not text_path.exists():
        return ""
    return text_path.read_text(encoding="utf-8").strip().replace("\n", " ")[:240]


def _render_page_image_gallery(
    page: dict[str, Any],
    report_dir: Path,
    output_dir: Path,
    *,
    include_processing_gallery: bool,
) -> str:
    image_specs = (
        _processing_image_specs(page, report_dir)
        if include_processing_gallery
        else _page_image_specs(page, report_dir)
    )
    if not image_specs:
        return ""
    panels = [
        _render_image_panel(label, image_path, output_dir, selected=selected)
        for label, image_path, selected in image_specs
    ]
    return "<div class='image-grid'>" + "".join(panels) + "</div>"


def _page_image_specs(page: dict[str, Any], report_dir: Path) -> list[tuple[str, Path, bool]]:
    source_image = _source_page_image(page, report_dir)
    selected_image = _selected_page_image(page, report_dir)
    selected_mode = str(page.get("selected_preprocess_mode", page.get("preprocess_mode", "unknown")))
    image_specs: list[tuple[str, Path, bool]] = []
    if source_image is not None:
        source_label = "source page / OCR input" if selected_image == source_image else "source page"
        image_specs.append((source_label, source_image, selected_image == source_image))
    if selected_image is not None and selected_image != source_image:
        image_specs.append((f"OCR input ({selected_mode})", selected_image, True))
    return image_specs


def _processing_image_specs(page: dict[str, Any], report_dir: Path) -> list[tuple[str, Path, bool]]:
    source_image = _source_page_image(page, report_dir)
    selected_mode = str(page.get("selected_preprocess_mode", page.get("preprocess_mode", "unknown")))
    seen: set[Path] = set()
    image_specs: list[tuple[str, Path, bool]] = []
    if source_image is not None:
        seen.add(source_image)
        image_specs.append(("source page", source_image, selected_mode == "none"))
    for preprocess_mode in _candidate_preprocess_modes(page):
        candidate_image = _candidate_image_path(page, report_dir, preprocess_mode)
        if candidate_image is None or candidate_image in seen:
            continue
        seen.add(candidate_image)
        label = "OCR input (none)" if preprocess_mode == "none" else f"OCR input ({preprocess_mode})"
        image_specs.append((label, candidate_image, preprocess_mode == selected_mode))
    return image_specs


def _candidate_preprocess_modes(page: dict[str, Any]) -> list[str]:
    modes: list[str] = []
    candidate_runs = page.get("candidate_runs")
    if isinstance(candidate_runs, list):
        for run in candidate_runs:
            if not isinstance(run, dict):
                continue
            preprocess_mode = run.get("preprocess_mode")
            if isinstance(preprocess_mode, str) and preprocess_mode not in modes:
                modes.append(preprocess_mode)
    selected_mode = page.get("selected_preprocess_mode") or page.get("preprocess_mode")
    if isinstance(selected_mode, str) and selected_mode not in modes:
        modes.append(selected_mode)
    return modes


def _source_page_image(page: dict[str, Any], report_dir: Path) -> Path | None:
    image_value = page.get("image_path")
    if not isinstance(image_value, str):
        return None
    image_path = _resolve_path(image_value, report_dir)
    return image_path if image_path.exists() else None


def _selected_page_image(page: dict[str, Any], report_dir: Path) -> Path | None:
    image_value = page.get("ocr_input_path") or page.get("image_path")
    if not isinstance(image_value, str):
        return None
    image_path = _resolve_path(image_value, report_dir)
    return image_path if image_path.exists() else None


def _candidate_image_path(
    page: dict[str, Any],
    report_dir: Path,
    preprocess_mode: str,
) -> Path | None:
    if preprocess_mode == "none":
        return _source_page_image(page, report_dir)
    work_dir_value = page.get("_work_dir")
    source_image = _source_page_image(page, report_dir)
    if not isinstance(work_dir_value, str) or source_image is None:
        return None
    work_dir = _resolve_path(work_dir_value, report_dir)
    candidate_path = work_dir / "preprocessed" / preprocess_mode / source_image.name
    if candidate_path.exists():
        return candidate_path
    selected_mode = page.get("selected_preprocess_mode") or page.get("preprocess_mode")
    if preprocess_mode == selected_mode:
        return _selected_page_image(page, report_dir)
    return None


def _render_image_panel(
    label: str,
    image_path: Path,
    output_dir: Path,
    *,
    selected: bool,
) -> str:
    image_href = html.escape(_to_href(image_path, output_dir))
    selected_class = " image-panel-selected" if selected else ""
    selected_badge = "<div class='panel-badge'>selected</div>" if selected else ""
    return (
        f"<figure class='image-panel{selected_class}'>"
        f"{selected_badge}"
        f"<figcaption>{html.escape(label)}</figcaption>"
        f"<img loading='lazy' src='{image_href}' alt='{html.escape(label)}' />"
        "</figure>"
    )


def _render_page_metadata(page: dict[str, Any]) -> str:
    items: list[tuple[str, str]] = []
    selected_mode = page.get("selected_preprocess_mode") or page.get("preprocess_mode")
    if isinstance(selected_mode, str):
        items.append(("selected preprocess", selected_mode))
    selection_strategy = page.get("selection_strategy")
    if isinstance(selection_strategy, str):
        items.append(("selection strategy", selection_strategy))
    tesseract_psm = page.get("tesseract_psm")
    if isinstance(tesseract_psm, int):
        items.append(("tesseract psm", str(tesseract_psm)))
    selection_score = _format_optional_float(page.get("selection_score"))
    if selection_score is not None:
        items.append(("text score", selection_score))
    inverse_render_score = _format_optional_float(page.get("inverse_render_score"))
    if inverse_render_score is not None:
        items.append(("inverse-render score", inverse_render_score))
    items.append(("word count", str(page.get("word_count", "?"))))
    items.append(("character count", str(page.get("character_count", "?"))))
    rows = "".join(
        f"<div class='meta-key'>{html.escape(label)}</div><div>{html.escape(value)}</div>"
        for label, value in items
    )
    return f"<dl class='meta-grid'>{rows}</dl>"


def _format_optional_float(value: Any) -> str | None:
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return None


def _render_candidate_runs_table(page: dict[str, Any]) -> str:
    candidate_runs = page.get("candidate_runs")
    if not isinstance(candidate_runs, list) or not candidate_runs:
        return "<p class='candidate-note'>No per-page candidate breakdown was recorded for this page.</p>"
    selected_mode = page.get("selected_preprocess_mode")
    selected_psm = page.get("tesseract_psm")
    rows = []
    for run in sorted(candidate_runs, key=_candidate_sort_key):
        if not isinstance(run, dict):
            continue
        preprocess_mode = str(run.get("preprocess_mode", "?"))
        psm = run.get("tesseract_psm")
        score = _format_optional_float(run.get("score")) or "n/a"
        inverse_score = _format_optional_float(run.get("inverse_render_score")) or "n/a"
        variant = str(run.get("inverse_render_text_variant", "raw"))
        is_selected = preprocess_mode == selected_mode and psm == selected_psm
        row_class = " class='selected-row'" if is_selected else ""
        rows.append(
            "<tr"
            + row_class
            + ">"
            + f"<td>{html.escape(preprocess_mode)}</td>"
            + f"<td>{html.escape(str(psm) if psm is not None else '—')}</td>"
            + f"<td>{html.escape(score)}</td>"
            + f"<td>{html.escape(inverse_score)}</td>"
            + f"<td>{html.escape(variant)}</td>"
            + f"<td>{html.escape(str(run.get('word_count', '?')))}</td>"
            + "</tr>"
        )
    if not rows:
        return "<p class='candidate-note'>No per-page candidate breakdown was recorded for this page.</p>"
    return (
        "<details class='candidate-details'><summary>Candidate scoring</summary>"
        "<table class='candidate-table'><thead><tr>"
        "<th>preprocess</th><th>psm</th><th>text score</th><th>inverse-render</th>"
        "<th>variant</th><th>words</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></details>"
    )


def _candidate_sort_key(run: dict[str, Any]) -> tuple[float, str, int]:
    score = float(run.get("score", -1_000_000.0))
    preprocess_mode = str(run.get("preprocess_mode", ""))
    psm = int(run.get("tesseract_psm", -1)) if run.get("tesseract_psm") is not None else -1
    return (-score, preprocess_mode, psm)


def _render_page_examples_section(
    pages: list[dict[str, Any]],
    report_dir: Path,
    output_dir: Path,
    *,
    title: str,
    max_example_pages: int,
    include_candidate_runs: bool,
    include_processing_gallery: bool,
) -> str:
    example_cards = [
        _render_page_example_card(
            page,
            report_dir,
            output_dir,
            include_candidate_runs=include_candidate_runs,
            include_processing_gallery=include_processing_gallery,
        )
        for page in pages[:max_example_pages]
    ]
    if not example_cards:
        return f"<h3>{html.escape(title)}</h3><p>No page artifact examples were available.</p>"
    return (
        f"<h3>{html.escape(title)}</h3>"
        "<div class='page-grid'>"
        + "".join(example_cards)
        + "</div>"
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
    example_pages_html = _render_page_examples_section(
        pages,
        inputs.report_dir,
        inputs.output_dir,
        title="Representative PDF page examples",
        max_example_pages=inputs.max_example_pages,
        include_candidate_runs=True,
        include_processing_gallery=False,
    )
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
        f"{example_pages_html}"
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
        ".page-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));"
        "gap:.7rem;margin:.5rem 0}"
        ".page-card{border:1px solid #ddd;padding:.5rem;border-radius:.3rem;background:#fafafa}"
        ".image-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.5rem;"
        "margin:.5rem 0}"
        ".image-panel{margin:0;border:1px solid #ccc;border-radius:.3rem;padding:.35rem;background:#fff;position:relative}"
        ".image-panel-selected{border-color:#2957d4;box-shadow:0 0 0 2px rgba(41,87,212,.12)}"
        ".panel-badge{position:absolute;top:.3rem;right:.3rem;background:#2957d4;color:#fff;"
        "font-size:.75rem;padding:.1rem .35rem;border-radius:999px}"
        ".image-panel figcaption{font-size:.8rem;font-weight:600;margin-bottom:.35rem}"
        ".page-card img{max-width:100%;height:auto;border:1px solid #ccc;background:#fff}"
        ".meta-grid{display:grid;grid-template-columns:max-content 1fr;gap:.2rem .6rem;font-size:.85rem;"
        "margin:.5rem 0}.meta-key{font-weight:600}"
        ".snippet{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;"
        "white-space:pre-wrap}"
        ".candidate-table{max-width:none;width:100%;margin-top:.5rem}"
        ".candidate-details{margin-top:.5rem}.selected-row{background:#eef4ff}"
        ".candidate-note{font-size:.9rem;color:#555}"
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
    max_example_pages: int = 6,
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
            max_example_pages=max_example_pages,
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


def _render_processing_overview(
    report_path: Path,
    report: dict[str, Any],
    ranked_modes: list[str],
    modes_payload: dict[str, Any],
    report_dir: Path,
) -> str:
    summary_rows = []
    for mode_name in ranked_modes:
        mode_payload = modes_payload.get(mode_name)
        if not isinstance(mode_payload, dict):
            continue
        char_accuracy, word_accuracy, wer, cer = _accuracy_tuple(mode_payload)
        page_count = len(_load_page_manifest(mode_payload, report_dir))
        summary_rows.append(
            "<tr>"
            f"<td>{html.escape(mode_name)}</td>"
            f"<td>{page_count}</td>"
            f"<td>{char_accuracy:.4f}</td>"
            f"<td>{word_accuracy:.4f}</td>"
            f"<td>{wer:.4f}</td>"
            f"<td>{cer:.4f}</td>"
            "</tr>"
        )
    summary_html = (
        "<table><thead><tr><th>mode</th><th>pages</th><th>char_accuracy</th>"
        "<th>word_accuracy</th><th>wer</th><th>cer</th></tr></thead><tbody>"
        + "".join(summary_rows)
        + "</tbody></table>"
    )
    best_mode = html.escape(str(report.get("best_mode", "n/a")))
    escaped_report_path = html.escape(str(report_path))
    return (
        "<section class='overview'>"
        "<h2>What this page shows</h2>"
        "<ol>"
        "<li>Each PDF page starts from the source raster image.</li>"
        "<li>The OCR pipeline may create preprocess variants such as scan, scan-local-threshold, basic, deskew, or dewarp.</li>"
        "<li>Tesseract candidates are text-scored; auto mode may also use inverse-render evidence to break close ties.</li>"
        "<li>The selected page text is then combined and passed through OCR cleanup before the final document is written.</li>"
        "</ol>"
        f"<p>best_mode={best_mode}, report={escaped_report_path}</p>"
        "<h2>Mode summary</h2>"
        f"{summary_html}"
        "</section>"
    )


def _render_processing_mode_section(inputs: _ProcessingModeInputs) -> str:
    pages = _load_page_manifest(inputs.mode_payload, inputs.report_dir)
    char_accuracy, word_accuracy, wer, cer = _accuracy_tuple(inputs.mode_payload)
    examples_html = _render_page_examples_section(
        pages,
        inputs.report_dir,
        inputs.output_dir,
        title="Processing examples",
        max_example_pages=inputs.max_example_pages,
        include_candidate_runs=True,
        include_processing_gallery=True,
    )
    return (
        "<section class='mode'>"
        f"<h2>Mode: {html.escape(inputs.mode_name)}</h2>"
        "<p>"
        f"char_accuracy={char_accuracy:.4f}, "
        f"word_accuracy={word_accuracy:.4f}, "
        f"wer={wer:.4f}, "
        f"cer={cer:.4f}"
        "</p>"
        f"{examples_html}"
        "</section>"
    )


def _render_processing_html_document(
    report_path: Path,
    report: dict[str, Any],
    overview_html: str,
    mode_sections: list[str],
) -> str:
    best_mode = html.escape(str(report.get("best_mode", "n/a")))
    escaped_report_path = html.escape(str(report_path))
    return (
        "<!doctype html><html><head><meta charset='utf-8' />"
        "<title>OCR Processing Explorer</title>"
        "<style>"
        "body{font-family:system-ui,Arial,sans-serif;margin:1rem 2rem;line-height:1.45}"
        "h1,h2,h3{margin:.6rem 0}.overview,.mode{border-top:1px solid #ddd;padding-top:1rem;margin-top:1rem}"
        "table{border-collapse:collapse;width:100%;max-width:60rem}"
        "th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}"
        ".page-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:.9rem;margin:.8rem 0}"
        ".page-card{border:1px solid #ddd;padding:.75rem;border-radius:.35rem;background:#fafafa}"
        ".image-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.5rem;margin:.5rem 0}"
        ".image-panel{margin:0;border:1px solid #ccc;border-radius:.3rem;padding:.35rem;background:#fff;position:relative}"
        ".image-panel-selected{border-color:#2957d4;box-shadow:0 0 0 2px rgba(41,87,212,.12)}"
        ".panel-badge{position:absolute;top:.3rem;right:.3rem;background:#2957d4;color:#fff;font-size:.75rem;padding:.1rem .35rem;border-radius:999px}"
        ".image-panel figcaption{font-size:.8rem;font-weight:600;margin-bottom:.35rem}"
        ".page-card img{max-width:100%;height:auto;border:1px solid #ccc;background:#fff}"
        ".meta-grid{display:grid;grid-template-columns:max-content 1fr;gap:.2rem .6rem;font-size:.85rem;margin:.5rem 0}.meta-key{font-weight:600}"
        ".snippet{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;white-space:pre-wrap}"
        ".candidate-table{max-width:none;width:100%;margin-top:.5rem}.selected-row{background:#eef4ff}"
        ".candidate-details{margin-top:.5rem}.candidate-note{font-size:.9rem;color:#555}"
        "code{background:#f3f3f3;padding:0 .2rem;border-radius:.2rem}"
        "</style></head><body>"
        "<h1>Local OCR Processing Explorer</h1>"
        f"<p>best_mode={best_mode}, report={escaped_report_path}</p>"
        f"{overview_html}"
        + "".join(mode_sections)
        + "</body></html>\n"
    )


def build_local_benchmark_processing_page(
    report_path: Path,
    output_html_path: Path,
    max_example_pages: int = 4,
) -> dict[str, Any]:
    """Render an HTML report that explains OCR processing with page examples."""

    report = json.loads(report_path.read_text(encoding="utf-8"))
    report_dir = report_path.parent
    modes_payload = _validated_modes_payload(report)
    ranked_modes = _ranked_mode_names(report, modes_payload)
    output_dir = output_html_path.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    overview_html = _render_processing_overview(
        report_path,
        report,
        ranked_modes,
        modes_payload,
        report_dir,
    )
    mode_sections: list[str] = []
    for mode_name in ranked_modes:
        mode_payload = modes_payload.get(mode_name)
        if not isinstance(mode_payload, dict):
            continue
        mode_sections.append(
            _render_processing_mode_section(
                _ProcessingModeInputs(
                    mode_name=mode_name,
                    mode_payload=mode_payload,
                    report_dir=report_dir,
                    output_dir=output_dir,
                    max_example_pages=max_example_pages,
                )
            )
        )
    html_output = _render_processing_html_document(
        report_path,
        report,
        overview_html,
        mode_sections,
    )
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
