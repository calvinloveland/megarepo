from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

DEFAULT_MANIFEST_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "pokemon_binder" / "manifest.json"
DEFAULT_RENDER_DIR = DEFAULT_MANIFEST_PATH.parent / "rendered"
DEFAULT_DEMO_PAGE_PATH = DEFAULT_MANIFEST_PATH.parent / "index.html"
DEFAULT_TEST_COMMAND = [sys.executable, "-m", "unittest", "tests/test_binder_fixtures.py"]
DEFAULT_PAGE_WIDTH = 1600
DEFAULT_PAGE_HEIGHT = 1600
FORBIDDEN_SCANNER_PATTERNS = [
    "ElementTree",
    "data-slot-id",
    "data-card-name",
    "scan_fixture_svg",
    ".svg",
]


def load_manifest(path: str | Path = DEFAULT_MANIFEST_PATH) -> dict[str, Any]:
    manifest_path = Path(path)
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    pages = manifest.get("pages")
    if not isinstance(pages, list) or not pages:
        return ["manifest.pages must be a non-empty list"]

    seen_page_ids: set[str] = set()
    seen_slot_ids: set[str] = set()
    card_counts: dict[str, int] = {}
    card_totals: dict[str, float] = {}
    binder_total = 0.0
    priced_card_count = 0

    for page in pages:
        page_id = str(page.get("page_id", "")).strip()
        if not page_id:
            errors.append("page is missing page_id")
            continue
        if page_id in seen_page_ids:
            errors.append(f"duplicate page_id: {page_id}")
        seen_page_ids.add(page_id)

        slots = page.get("slots")
        if not isinstance(slots, list) or not slots:
            errors.append(f"page {page_id} must define a non-empty slots list")
            continue

        page_total = 0.0
        page_boxes: list[tuple[str, tuple[float, float, float, float]]] = []

        for slot in slots:
            slot_id = str(slot.get("slot_id", "")).strip()
            if not slot_id:
                errors.append(f"page {page_id} has a slot without slot_id")
                continue
            if slot_id in seen_slot_ids:
                errors.append(f"duplicate slot_id: {slot_id}")
            seen_slot_ids.add(slot_id)

            bbox = slot.get("bbox_norm")
            parsed_bbox = _parse_bbox(page_id, slot_id, bbox, errors)
            if parsed_bbox is not None:
                page_boxes.append((slot_id, parsed_bbox))

            visibility = str(slot.get("visibility", "clear")).strip() or "clear"
            if visibility not in {"clear", "glare", "sleeve_glare", "soft_focus", "tilted"}:
                errors.append(f"page {page_id} slot {slot_id} has unknown visibility {visibility}")

            tilt = slot.get("tilt_degrees", 0.0)
            if not isinstance(tilt, (int, float)):
                errors.append(f"page {page_id} slot {slot_id} tilt_degrees must be numeric")

            card = slot.get("card")
            if not isinstance(card, dict):
                errors.append(f"page {page_id} slot {slot_id} must contain a card object")
                continue

            canonical_card_id = str(card.get("canonical_card_id", "")).strip()
            if not canonical_card_id:
                errors.append(f"page {page_id} slot {slot_id} is missing card.canonical_card_id")
                continue

            name = str(card.get("name", "")).strip()
            if not name:
                errors.append(f"page {page_id} slot {slot_id} is missing card.name")

            collector_number = str(card.get("collector_number", "")).strip()
            if not collector_number:
                errors.append(f"page {page_id} slot {slot_id} is missing card.collector_number")

            reference_image_path = str(card.get("reference_image_path", "")).strip()
            if not reference_image_path:
                errors.append(f"page {page_id} slot {slot_id} is missing card.reference_image_path")
            elif Path(reference_image_path).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                errors.append(f"page {page_id} slot {slot_id} reference image must be raster, got {reference_image_path}")

            price = card.get("fixture_price_usd")
            if not isinstance(price, (int, float)):
                errors.append(f"page {page_id} slot {slot_id} has non-numeric card.fixture_price_usd")
                continue
            if price < 0:
                errors.append(f"page {page_id} slot {slot_id} has negative card.fixture_price_usd")
                continue

            price_value = round(float(price), 2)
            page_total += price_value
            binder_total += price_value
            priced_card_count += 1
            card_counts[canonical_card_id] = card_counts.get(canonical_card_id, 0) + 1
            card_totals[canonical_card_id] = round(card_totals.get(canonical_card_id, 0.0) + price_value, 2)

        for left_slot_id, left_bbox in page_boxes:
            for right_slot_id, right_bbox in page_boxes:
                if left_slot_id >= right_slot_id:
                    continue
                if _boxes_overlap(left_bbox, right_bbox):
                    errors.append(f"page {page_id} has overlapping slots: {left_slot_id} overlaps {right_slot_id}")

        expected_total = page.get("expected_total_usd")
        if not isinstance(expected_total, (int, float)):
            errors.append(f"page {page_id} is missing numeric expected_total_usd")
        elif round(float(expected_total), 2) != round(page_total, 2):
            errors.append(
                f"page {page_id} expected_total_usd={float(expected_total):.2f} does not match slot sum {page_total:.2f}"
            )

    expected_page_count = manifest.get("expected_page_count")
    if isinstance(expected_page_count, int) and expected_page_count != len(pages):
        errors.append(f"expected_page_count={expected_page_count} does not match actual page count {len(pages)}")

    expected_priced_card_count = manifest.get("expected_priced_card_count")
    if isinstance(expected_priced_card_count, int) and expected_priced_card_count != priced_card_count:
        errors.append(
            "expected_priced_card_count="
            f"{expected_priced_card_count} does not match actual priced card count {priced_card_count}"
        )

    expected_binder_total = manifest.get("expected_binder_total_usd")
    if isinstance(expected_binder_total, (int, float)) and round(float(expected_binder_total), 2) != round(binder_total, 2):
        errors.append(
            f"expected_binder_total_usd={float(expected_binder_total):.2f} does not match slot sum {binder_total:.2f}"
        )

    expected_duplicate_groups = manifest.get("expected_duplicate_groups", [])
    if not isinstance(expected_duplicate_groups, list):
        errors.append("expected_duplicate_groups must be a list when provided")
    else:
        expected_duplicates = {
            str(item.get("canonical_card_id", "")).strip(): item
            for item in expected_duplicate_groups
            if str(item.get("canonical_card_id", "")).strip()
        }
        actual_duplicates = {card_id for card_id, count in card_counts.items() if count > 1}
        if set(expected_duplicates) != actual_duplicates:
            errors.append(
                "expected_duplicate_groups does not match actual duplicate card ids: "
                f"expected {sorted(expected_duplicates)}, actual {sorted(actual_duplicates)}"
            )
        for card_id, entry in expected_duplicates.items():
            actual_count = card_counts.get(card_id)
            if entry.get("count") != actual_count:
                errors.append(
                    f"duplicate group {card_id} expected count {entry.get('count')} does not match actual count {actual_count}"
                )
            actual_total = round(card_totals.get(card_id, 0.0), 2)
            expected_total = entry.get("total_price_usd")
            if not isinstance(expected_total, (int, float)):
                errors.append(f"duplicate group {card_id} is missing numeric total_price_usd")
            elif round(float(expected_total), 2) != actual_total:
                errors.append(
                    f"duplicate group {card_id} expected total {float(expected_total):.2f} does not match actual total {actual_total:.2f}"
                )

    return errors


def summarize_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    pages = manifest.get("pages", [])
    visibility_counter: Counter[str] = Counter()
    variant_counter: Counter[str] = Counter()
    condition_counter: Counter[str] = Counter()
    set_counter: Counter[str] = Counter()
    unique_card_ids: set[str] = set()
    slot_count = 0
    image_backed_card_count = 0
    max_card: dict[str, Any] | None = None
    page_summaries: list[dict[str, Any]] = []

    for page in pages:
        slots = page.get("slots", [])
        page_priced_cards = 0
        page_max_card: dict[str, Any] | None = None
        for slot in slots:
            slot_count += 1
            visibility = str(slot.get("visibility", "unknown")).strip() or "unknown"
            visibility_counter[visibility] += 1
            card = slot.get("card")
            if not isinstance(card, dict):
                continue
            page_priced_cards += 1
            card_id = str(card.get("canonical_card_id", "")).strip()
            if card_id:
                unique_card_ids.add(card_id)
            variant = str(card.get("variant", "unknown")).strip() or "unknown"
            condition = str(card.get("condition", "unknown")).strip() or "unknown"
            set_code = str(card.get("set_code", "unknown")).strip() or "unknown"
            price = round(float(card.get("fixture_price_usd", 0.0)), 2)
            if str(card.get("reference_image_path", "")).strip():
                image_backed_card_count += 1
            variant_counter[variant] += 1
            condition_counter[condition] += 1
            set_counter[set_code] += 1
            card_summary = {
                "name": str(card.get("name", "Unknown")),
                "canonical_card_id": card_id,
                "price_usd": price,
                "page_id": page.get("page_id"),
                "slot_id": slot.get("slot_id"),
                "variant": variant,
                "condition": condition,
            }
            if max_card is None or price > max_card["price_usd"]:
                max_card = card_summary
            if page_max_card is None or price > page_max_card["price_usd"]:
                page_max_card = card_summary
        page_summaries.append(
            {
                "page_id": page.get("page_id"),
                "label": page.get("label"),
                "expected_total_usd": round(float(page.get("expected_total_usd", 0.0)), 2),
                "slot_count": len(slots),
                "priced_card_count": page_priced_cards,
                "empty_slot_count": 0,
                "top_card": page_max_card,
            }
        )

    page_summaries.sort(key=lambda item: item["page_id"])
    highest_value_page = max(page_summaries, key=lambda item: item["expected_total_usd"], default=None)
    lowest_value_page = min(page_summaries, key=lambda item: item["expected_total_usd"], default=None)

    return {
        "fixture_name": manifest.get("fixture_name", "unknown-fixture"),
        "version": manifest.get("version"),
        "page_count": len(pages),
        "slot_count": slot_count,
        "priced_card_count": manifest.get("expected_priced_card_count", 0),
        "empty_slot_count": 0,
        "image_backed_card_count": image_backed_card_count,
        "binder_total_usd": round(float(manifest.get("expected_binder_total_usd", 0.0)), 2),
        "unique_card_count": len(unique_card_ids),
        "duplicate_group_count": len(manifest.get("expected_duplicate_groups", [])),
        "highest_value_page": highest_value_page,
        "lowest_value_page": lowest_value_page,
        "highest_value_card": max_card,
        "visibility_distribution": _counter_to_sorted_items(visibility_counter),
        "variant_distribution": _counter_to_sorted_items(variant_counter),
        "condition_distribution": _counter_to_sorted_items(condition_counter),
        "set_distribution": _counter_to_sorted_items(set_counter),
        "page_summaries": page_summaries,
        "duplicate_groups": [
            {
                "canonical_card_id": str(entry.get("canonical_card_id", "")),
                "count": int(entry.get("count", 0)),
                "total_price_usd": round(float(entry.get("total_price_usd", 0.0)), 2),
            }
            for entry in manifest.get("expected_duplicate_groups", [])
        ],
    }


def build_reference_catalog(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}
    for page in manifest.get("pages", []):
        for slot in page.get("slots", []):
            card = slot.get("card")
            if not isinstance(card, dict):
                continue
            card_id = str(card.get("canonical_card_id", "")).strip()
            if card_id and card_id not in catalog:
                catalog[card_id] = dict(card)
    return catalog


def render_fixture_pages(
    manifest: dict[str, Any],
    output_dir: str | Path,
    *,
    width: int = DEFAULT_PAGE_WIDTH,
    height: int = DEFAULT_PAGE_HEIGHT,
) -> list[Path]:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    rendered_paths: list[Path] = []
    manifest_root = DEFAULT_MANIFEST_PATH.parent
    for page in manifest["pages"]:
        page_path = output_path / f"{page['page_id']}.jpg"
        page_image = _render_page_photo(page, manifest_root=manifest_root, width=width, height=height)
        page_image.save(page_path, format="JPEG", quality=92, optimize=True, progressive=True, exif=b"")
        rendered_paths.append(page_path)
    return rendered_paths


def audit_picture_only_pipeline(
    manifest: dict[str, Any],
    render_dir: str | Path = DEFAULT_RENDER_DIR,
    *,
    scanner_source_path: str | Path | None = None,
) -> dict[str, Any]:
    render_path = Path(render_dir)
    issues: list[str] = []
    checked_files: list[str] = []

    jpg_paths = sorted(render_path.glob("*.jpg"))
    checked_files.extend(str(path.name) for path in jpg_paths)
    if len(jpg_paths) != int(manifest.get("expected_page_count", 0)):
        issues.append(
            f"expected {manifest.get('expected_page_count', 0)} rendered jpg pages but found {len(jpg_paths)} in {render_path}"
        )

    svg_paths = sorted(render_path.glob("*.svg"))
    if svg_paths:
        issues.append(f"render directory still contains svg files: {', '.join(path.name for path in svg_paths[:5])}")

    for path in jpg_paths:
        try:
            with Image.open(path) as image:
                exif = image.getexif()
                if len(exif):
                    issues.append(f"{path.name} still contains EXIF metadata")
                for key in ("comment", "xml", "photoshop", "icc_profile"):
                    if image.info.get(key):
                        issues.append(f"{path.name} still contains image metadata key: {key}")
        except OSError as exc:
            issues.append(f"failed to inspect {path.name}: {exc}")

    scanner_path = Path(scanner_source_path) if scanner_source_path else Path(__file__).resolve().with_name("scanner.py")
    scanner_source = scanner_path.read_text(encoding="utf-8")
    forbidden_hits = [pattern for pattern in FORBIDDEN_SCANNER_PATTERNS if pattern in scanner_source]
    if forbidden_hits:
        issues.append(f"scanner source still references forbidden metadata paths: {', '.join(forbidden_hits)}")

    for page in manifest.get("pages", []):
        for slot in page.get("slots", []):
            card = slot.get("card") or {}
            reference_image_path = str(card.get("reference_image_path", "")).strip()
            if reference_image_path.endswith(".svg"):
                issues.append(f"slot {slot.get('slot_id')} still points at an svg reference image")

    return {
        "passed": not issues,
        "issues": issues,
        "checked_render_count": len(jpg_paths),
        "checked_files": checked_files,
        "scanner_source_path": str(scanner_path),
    }


def build_demo_page(
    manifest: dict[str, Any],
    output_path: str | Path,
    *,
    render_dir: str | Path = DEFAULT_RENDER_DIR,
    test_report: dict[str, Any] | None = None,
    scanner_report: dict[str, Any] | None = None,
    audit_report: dict[str, Any] | None = None,
) -> Path:
    summary = summarize_manifest(manifest)
    output_file = Path(output_path)
    render_path = Path(render_dir)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")

    report_by_page_id = {
        str(page_report.get("page_id")): page_report for page_report in (scanner_report or {}).get("page_reports", [])
    }
    page_cards = []
    for page in manifest["pages"]:
        relative_preview = render_path.name + f"/{page['page_id']}.jpg"
        page_report = report_by_page_id.get(page["page_id"], {})
        identified_slot_markup = _render_identified_slots(page_report.get("identified_slots", []))
        page_cards.append(
            "".join(
                [
                    "<article class='page-card'>",
                    f"<img src='{_escape(relative_preview)}' alt='{_escape(page['label'])} preview' loading='lazy' />",
                    "<div class='page-card-body'>",
                    f"<h3>{_escape(page['label'])}</h3>",
                    f"<p class='muted'>Expected total: ${float(page['expected_total_usd']):.2f}</p>",
                    f"<p>{_escape(' · '.join(page.get('notes', [])))}</p>",
                    "<h4>Scanner-identified cards</h4>",
                    identified_slot_markup,
                    "</div>",
                    "</article>",
                ]
            )
        )

    metric_cards = [
        _metric_card("Pages", str(summary["page_count"])),
        _metric_card("Slots", str(summary["slot_count"])),
        _metric_card("Priced cards", str(summary["priced_card_count"])),
        _metric_card("Real-image cards", str(summary["image_backed_card_count"])),
        _metric_card("Empty slots", str(summary["empty_slot_count"])),
        _metric_card("Unique cards", str(summary["unique_card_count"])),
        _metric_card("Duplicate groups", str(summary["duplicate_group_count"])),
        _metric_card("Binder total", f"${summary['binder_total_usd']:.2f}"),
    ]

    duplicate_rows = "".join(
        f"<tr><td>{_escape(entry['canonical_card_id'])}</td><td>{entry['count']}</td><td>${entry['total_price_usd']:.2f}</td></tr>"
        for entry in summary["duplicate_groups"]
    )
    page_rows = "".join(
        "".join(
            [
                "<tr>",
                f"<td>{_escape(page['page_id'])}</td>",
                f"<td>{_escape(str(page['label']))}</td>",
                f"<td>{page['slot_count']}</td>",
                f"<td>{page['priced_card_count']}</td>",
                f"<td>${page['expected_total_usd']:.2f}</td>",
                "</tr>",
            ]
        )
        for page in summary["page_summaries"]
    )

    top_card_markup = "n/a"
    if summary["highest_value_card"]:
        top_card = summary["highest_value_card"]
        top_card_markup = (
            f"{_escape(top_card['name'])} · ${top_card['price_usd']:.2f} "
            f"<span class='muted'>({_escape(str(top_card['page_id']))} / {_escape(str(top_card['slot_id']))})</span>"
        )

    test_panel = _render_test_panel(test_report)
    scanner_panel = _render_scanner_panel(scanner_report)
    audit_panel = _render_audit_panel(audit_report)

    html = f"""<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>Pokémon Binder Fixture Demo</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #020617;
        --panel: #0f172a;
        --panel-2: #111827;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --line: #334155;
        --accent: #60a5fa;
        --good: #34d399;
        --bad: #f87171;
      }}
      * {{ box-sizing: border-box; }}
      body {{ margin: 0; font-family: system-ui, sans-serif; background: linear-gradient(180deg, #020617 0%, #0f172a 100%); color: var(--text); }}
      main {{ max-width: 1380px; margin: 0 auto; padding: 32px 20px 64px; }}
      h1, h2, h3, h4 {{ margin: 0 0 12px; }}
      p {{ line-height: 1.5; }}
      .hero {{ display: grid; gap: 14px; margin-bottom: 28px; }}
      .eyebrow {{ color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.82rem; }}
      .hero-card, .panel {{ background: rgba(15, 23, 42, 0.9); border: 1px solid var(--line); border-radius: 18px; padding: 20px; box-shadow: 0 20px 50px rgba(2, 6, 23, 0.35); }}
      .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 24px 0; }}
      .metric-card {{ background: rgba(17, 24, 39, 0.95); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }}
      .metric-card .label {{ color: var(--muted); font-size: 0.9rem; margin-bottom: 6px; }}
      .metric-card .value {{ font-size: 1.2rem; font-weight: 700; }}
      .grid-2 {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; margin: 24px 0; }}
      .distribution-list {{ display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }}
      .distribution-list li {{ display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(51, 65, 85, 0.5); padding-bottom: 6px; }}
      .table-wrap {{ overflow-x: auto; }}
      table {{ width: 100%; border-collapse: collapse; }}
      th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(51, 65, 85, 0.5); vertical-align: top; }}
      th {{ color: var(--muted); font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.04em; }}
      .pages {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 18px; margin-top: 22px; }}
      .page-card {{ background: rgba(15, 23, 42, 0.92); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }}
      .page-card > img {{ display: block; width: 100%; height: auto; background: #0b1120; }}
      .page-card-body {{ padding: 16px; }}
      .identified-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }}
      .identified-slot {{ border: 1px solid rgba(51, 65, 85, 0.7); border-radius: 12px; padding: 8px; background: rgba(2, 6, 23, 0.6); }}
      .identified-slot img {{ width: 100%; height: 150px; object-fit: contain; background: #020617; border-radius: 8px; border: 1px solid rgba(51, 65, 85, 0.7); }}
      .identified-slot .name {{ font-size: 0.86rem; font-weight: 700; margin-top: 8px; }}
      .identified-slot .meta {{ color: var(--muted); font-size: 0.78rem; }}
      .muted {{ color: var(--muted); }}
      .good {{ color: var(--good); font-weight: 700; }}
      .bad {{ color: var(--bad); font-weight: 700; }}
      pre {{ white-space: pre-wrap; word-break: break-word; background: #020617; color: #cbd5e1; padding: 14px; border-radius: 12px; border: 1px solid var(--line); overflow-x: auto; }}
      code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
      .audit-list {{ margin: 0; padding-left: 18px; }}
    </style>
  </head>
  <body>
    <main>
      <section class='hero'>
        <div class='hero-card'>
          <div class='eyebrow'>Picture-only raster dataset demo</div>
          <h1>Pokémon binder fixture corpus</h1>
          <p>{_escape(str(manifest.get('description', '')))}</p>
          <p class='muted'>Version {manifest.get('version')} · Pricing snapshot {_escape(str(manifest.get('pricing_reference', {}).get('snapshot_date', 'unknown')))} · Highest-value card: {top_card_markup}</p>
          <p class='muted'>Demo generated at {generated_at}</p>
        </div>
      </section>

      <section class='metrics'>
        {''.join(metric_cards)}
      </section>

      <section class='grid-2'>
        <article class='panel'>
          <h2>Distributions</h2>
          <div class='grid-2'>
            {_distribution_panel('Visibility', summary['visibility_distribution'])}
            {_distribution_panel('Variants', summary['variant_distribution'])}
            {_distribution_panel('Conditions', summary['condition_distribution'])}
            {_distribution_panel('Sets', summary['set_distribution'])}
          </div>
        </article>
        <article class='panel'>
          <h2>What this dataset is testing</h2>
          <ul>
            <li>Picture-only 3×3 binder-page scans rendered as JPEGs from real card art</li>
            <li>Card identification from page pixels only, with no embedded SVG or per-slot metadata</li>
            <li>Mild-to-severe skew, sleeve glare, soft focus, motion blur, occlusion bands, and lighting changes</li>
            <li>First-edition versus unlimited recognition using side-by-side Jungle Pikachu scans</li>
            <li>Adversarial near-duplicate cards and page-level hard cases intended to break the current baseline scanner</li>
            <li>Binder-total and page-total pricing rollups</li>
            <li>Duplicate-card aggregation</li>
          </ul>
        </article>
      </section>

      <section class='grid-2'>
        <article class='panel'>
          <h2>Page summary</h2>
          <div class='table-wrap'>
            <table>
              <thead>
                <tr><th>Page</th><th>Label</th><th>Slots</th><th>Cards</th><th>Total</th></tr>
              </thead>
              <tbody>{page_rows}</tbody>
            </table>
          </div>
        </article>
        <article class='panel'>
          <h2>Duplicate groups</h2>
          <div class='table-wrap'>
            <table>
              <thead>
                <tr><th>Canonical card id</th><th>Count</th><th>Total price</th></tr>
              </thead>
              <tbody>{duplicate_rows}</tbody>
            </table>
          </div>
        </article>
      </section>

      {test_panel}
      {audit_panel}
      {scanner_panel}

      <section class='panel'>
        <h2>Rendered JPEG page photos</h2>
        <p class='muted'>These previews are generated JPEG binder-page images assembled from real card scans. No SVG overlays or per-slot metadata are used for scanner evaluation.</p>
        <div class='pages'>
          {''.join(page_cards)}
        </div>
      </section>
    </main>
  </body>
</html>
"""
    output_file.write_text(html, encoding="utf-8")
    return output_file


def run_fixture_test_command(
    command: list[str] | None = None,
    *,
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    test_command = command or DEFAULT_TEST_COMMAND
    result = subprocess.run(
        test_command,
        cwd=str(cwd) if cwd is not None else None,
        capture_output=True,
        text=True,
        check=False,
    )
    output = (result.stdout or "") + (result.stderr or "")
    display_command = "python -m unittest tests/test_binder_fixtures.py" if test_command == DEFAULT_TEST_COMMAND else " ".join(test_command)
    return {
        "command": " ".join(test_command),
        "display_command": display_command,
        "returncode": result.returncode,
        "passed": result.returncode == 0,
        "output": output.strip(),
    }


def _parse_bbox(
    page_id: str,
    slot_id: str,
    bbox: Any,
    errors: list[str],
) -> tuple[float, float, float, float] | None:
    if not isinstance(bbox, list) or len(bbox) != 4:
        errors.append(f"page {page_id} slot {slot_id} bbox_norm must be a 4-item list")
        return None
    try:
        x, y, w, h = [float(value) for value in bbox]
    except (TypeError, ValueError):
        errors.append(f"page {page_id} slot {slot_id} bbox_norm must contain numbers")
        return None
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
        errors.append(f"page {page_id} slot {slot_id} bbox_norm must stay within [0, 1]")
        return None
    return x, y, w, h


def _boxes_overlap(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    left_x, left_y, left_w, left_h = left
    right_x, right_y, right_w, right_h = right
    return not (
        left_x + left_w <= right_x
        or right_x + right_w <= left_x
        or left_y + left_h <= right_y
        or right_y + right_h <= left_y
    )


def _render_page_photo(
    page: dict[str, Any],
    *,
    manifest_root: Path,
    width: int,
    height: int,
) -> Image.Image:
    rng = random.Random(page["page_id"])
    base = Image.new("RGBA", (width, height), (8, 16, 30, 255))
    _draw_gradient_background(base)
    _draw_binder_texture(base, rng)

    for slot in page["slots"]:
        x, y, w, h = slot["bbox_norm"]
        pocket = (
            int(round(x * width)),
            int(round(y * height)),
            int(round((x + w) * width)),
            int(round((y + h) * height)),
        )
        _draw_pocket(base, pocket)
        _render_card_into_pocket(base, pocket, slot, manifest_root=manifest_root, rng=rng)

    _draw_page_highlights(base, rng)
    rgb = base.convert("RGB")
    rgb = rgb.filter(ImageFilter.GaussianBlur(radius=0.35))
    return _add_film_grain(rgb, rng)


def _draw_gradient_background(image: Image.Image) -> None:
    width, height = image.size
    draw = ImageDraw.Draw(image)
    top = np.array([12, 28, 50], dtype=np.float32)
    bottom = np.array([6, 12, 24], dtype=np.float32)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(int(round(value)) for value in (top * (1.0 - t) + bottom * t))
        draw.line([(0, y), (width, y)], fill=(*color, 255))


def _draw_binder_texture(image: Image.Image, rng: random.Random) -> None:
    width, height = image.size
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((36, 32, width - 36, height - 32), radius=42, fill=(17, 24, 39, 130), outline=(71, 85, 105, 180), width=3)
    seam_x = width // 2
    draw.rectangle((seam_x - 6, 80, seam_x + 6, height - 80), fill=(2, 6, 23, 110))
    for _ in range(120):
        radius = rng.randint(6, 22)
        x = rng.randint(40, width - 40)
        y = rng.randint(40, height - 40)
        alpha = rng.randint(8, 20)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(255, 255, 255, alpha))


def _draw_pocket(image: Image.Image, pocket: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = pocket
    draw = ImageDraw.Draw(image, "RGBA")
    shadow_box = (x1 + 12, y1 + 18, x2 + 18, y2 + 24)
    draw.rounded_rectangle(shadow_box, radius=28, fill=(2, 6, 23, 120))
    draw.rounded_rectangle((x1, y1, x2, y2), radius=28, fill=(8, 18, 32, 170), outline=(148, 163, 184, 120), width=2)
    draw.rounded_rectangle((x1 + 12, y1 + 12, x2 - 12, y2 - 12), radius=22, outline=(226, 232, 240, 60), width=2)


def _render_card_into_pocket(
    image: Image.Image,
    pocket: tuple[int, int, int, int],
    slot: dict[str, Any],
    *,
    manifest_root: Path,
    rng: random.Random,
) -> None:
    card = slot.get("card")
    if not isinstance(card, dict):
        return

    source_path = manifest_root / str(card["reference_image_path"])
    with Image.open(source_path) as source_image:
        source_rgba = ImageOps.exif_transpose(source_image).convert("RGBA")

    pocket_w = pocket[2] - pocket[0]
    pocket_h = pocket[3] - pocket[1]
    scale = float(slot.get("render_scale", 1.0) or 1.0)
    card_h = int(pocket_h * 0.9 * scale)
    card_w = int(card_h * 0.727)
    max_card_w = int(pocket_w * 0.9)
    if card_w > max_card_w:
        card_w = max_card_w
        card_h = int(card_w / 0.727)

    card_image = ImageOps.contain(source_rgba, (card_w, card_h), method=Image.Resampling.LANCZOS)
    card_image = _apply_card_transform(card_image, slot, rng)
    shadow = _make_shadow(card_image)

    offset_x_norm, offset_y_norm = slot.get("render_offset_norm", [0.0, 0.0])
    center_x = pocket[0] + pocket_w // 2 + int(pocket_w * float(offset_x_norm))
    center_y = pocket[1] + pocket_h // 2 + int(pocket_h * (0.01 + float(offset_y_norm)))
    shadow_pos = (center_x - shadow.width // 2 + 8, center_y - shadow.height // 2 + 12)
    card_pos = (center_x - card_image.width // 2, center_y - card_image.height // 2)
    image.alpha_composite(shadow, shadow_pos)
    image.alpha_composite(card_image, card_pos)


def _apply_card_transform(card_image: Image.Image, slot: dict[str, Any], rng: random.Random) -> Image.Image:
    tilt = float(slot.get("tilt_degrees", 0.0) or 0.0)
    visibility = str(slot.get("visibility", "clear")).strip() or "clear"
    effects = {str(effect).strip() for effect in slot.get("render_effects", [])}
    shear = 0.0
    if visibility == "tilted":
        shear = 0.055 if tilt >= 0 else -0.055
    elif visibility == "glare":
        shear = 0.025 if tilt >= 0 else -0.025
    elif visibility == "sleeve_glare":
        shear = 0.04 if tilt >= 0 else -0.04
    if "extreme_shear" in effects:
        shear += 0.09 if tilt >= 0 else -0.09

    transformed = _shear_x(card_image, shear) if shear else card_image
    if "zoom_crop" in effects:
        transformed = _zoom_crop(transformed, 1.18)
    if abs(tilt) > 0.01:
        transformed = transformed.rotate(tilt, resample=Image.Resampling.BICUBIC, expand=True)

    if visibility == "soft_focus":
        transformed = transformed.filter(ImageFilter.GaussianBlur(radius=1.0))
        transformed = ImageEnhance.Contrast(transformed).enhance(0.95)
    else:
        transformed = ImageEnhance.Contrast(transformed).enhance(1.03)

    if visibility in {"glare", "sleeve_glare"}:
        transformed = _add_glare_overlay(transformed, heavy=visibility == "sleeve_glare")
    if "heavy_glare" in effects:
        transformed = _add_glare_overlay(transformed, heavy=True)
    if "motion_blur" in effects:
        transformed = _apply_motion_blur(transformed, horizontal=tilt >= 0)
    if "low_light" in effects:
        transformed = ImageEnhance.Brightness(transformed).enhance(0.7)
        transformed = ImageEnhance.Color(transformed).enhance(0.86)
    if "desaturate" in effects:
        transformed = ImageEnhance.Color(transformed).enhance(0.45)
    if "blue_cast" in effects:
        transformed = _add_color_cast(transformed, (80, 120, 255, 34))
    if "corner_occlusion" in effects:
        transformed = _add_occlusion_patch(transformed, anchor="top_left", amount=0.28)
    if "bottom_occlusion" in effects:
        transformed = _add_occlusion_patch(transformed, anchor="bottom", amount=0.18)
    if "center_band" in effects:
        transformed = _add_center_band(transformed)

    if visibility == "tilted":
        transformed = ImageEnhance.Brightness(transformed).enhance(0.98)
    elif visibility == "soft_focus":
        transformed = ImageEnhance.Brightness(transformed).enhance(1.02)

    return transformed


def _shear_x(image: Image.Image, shear: float) -> Image.Image:
    if abs(shear) < 1e-6:
        return image
    width, height = image.size
    x_shift = abs(shear) * height
    new_width = int(math.ceil(width + x_shift))
    if shear > 0:
        matrix = (1, shear, -x_shift / 2, 0, 1, 0)
    else:
        matrix = (1, shear, x_shift / 2, 0, 1, 0)
    return image.transform(
        (new_width, height),
        Image.Transform.AFFINE,
        matrix,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def _zoom_crop(image: Image.Image, factor: float) -> Image.Image:
    width, height = image.size
    scaled = image.resize((int(width * factor), int(height * factor)), resample=Image.Resampling.LANCZOS)
    left = max(0, (scaled.width - width) // 2)
    top = max(0, (scaled.height - height) // 2)
    return scaled.crop((left, top, left + width, top + height))


def _apply_motion_blur(image: Image.Image, *, horizontal: bool) -> Image.Image:
    base = image.convert("RGBA")
    accum = Image.new("RGBA", base.size, (0, 0, 0, 0))
    offsets = [-12, -8, -4, 0, 4, 8, 12]
    for offset in offsets:
        shifted = ImageChops.offset(base, offset if horizontal else 0, 0 if horizontal else offset)
        accum = Image.blend(accum, shifted, alpha=1.0 / max(2, len(offsets)))
    return Image.blend(base, accum, alpha=0.55).filter(ImageFilter.GaussianBlur(radius=1.2))


def _add_color_cast(image: Image.Image, rgba: tuple[int, int, int, int]) -> Image.Image:
    overlay = Image.new("RGBA", image.size, rgba)
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def _add_occlusion_patch(image: Image.Image, *, anchor: str, amount: float) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    width, height = image.size
    if anchor == "top_left":
        draw.rounded_rectangle((0, 0, int(width * 0.38), int(height * amount)), radius=10, fill=(235, 237, 240, 255))
    elif anchor == "bottom":
        top = int(height * (1.0 - amount))
        draw.rounded_rectangle((int(width * 0.04), top, int(width * 0.96), height), radius=12, fill=(228, 231, 235, 245))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def _add_center_band(image: Image.Image) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    width, height = image.size
    draw.rounded_rectangle((int(width * 0.04), int(height * 0.43), int(width * 0.96), int(height * 0.60)), radius=18, fill=(35, 38, 48, 165))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def _make_shadow(card_image: Image.Image) -> Image.Image:
    alpha = card_image.getchannel("A")
    shadow = Image.new("RGBA", card_image.size, (0, 0, 0, 0))
    shadow.putalpha(alpha)
    shadow = ImageEnhance.Brightness(shadow).enhance(0.0)
    shadow.putalpha(alpha.point(lambda value: min(150, int(value * 0.55))))
    return shadow.filter(ImageFilter.GaussianBlur(radius=12))


def _add_glare_overlay(image: Image.Image, *, heavy: bool) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    width, height = image.size
    alpha = 95 if heavy else 62
    draw.polygon(
        [
            (int(width * 0.08), int(height * 0.10)),
            (int(width * 0.42), int(height * 0.02)),
            (int(width * 0.92), int(height * 0.78)),
            (int(width * 0.56), int(height * 0.94)),
        ],
        fill=(255, 255, 255, alpha),
    )
    if heavy:
        draw.polygon(
            [
                (int(width * 0.18), int(height * 0.18)),
                (int(width * 0.34), int(height * 0.14)),
                (int(width * 0.70), int(height * 0.70)),
                (int(width * 0.52), int(height * 0.74)),
            ],
            fill=(255, 255, 255, 54),
        )
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=6 if heavy else 4))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def _draw_page_highlights(image: Image.Image, rng: random.Random) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    width, height = image.size
    for _ in range(5):
        x1 = rng.randint(0, width // 2)
        y1 = rng.randint(0, height // 2)
        x2 = x1 + rng.randint(width // 3, width - x1)
        y2 = y1 + rng.randint(height // 5, height // 2)
        draw.ellipse((x1, y1, x2, y2), fill=(255, 255, 255, rng.randint(10, 24)))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=42))
    image.alpha_composite(overlay)


def _add_film_grain(image: Image.Image, rng: random.Random) -> Image.Image:
    arr = np.asarray(image).astype(np.int16)
    noise = np.random.default_rng(rng.randint(0, 2**32 - 1)).normal(0, 4.5, size=arr.shape).astype(np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def _counter_to_sorted_items(counter: Counter[str]) -> list[dict[str, Any]]:
    return [
        {"label": label, "count": count}
        for label, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    ]


def _metric_card(label: str, value: str) -> str:
    return (
        "<article class='metric-card'>"
        f"<div class='label'>{_escape(label)}</div>"
        f"<div class='value'>{value}</div>"
        "</article>"
    )


def _distribution_panel(title: str, items: list[dict[str, Any]]) -> str:
    rows = "".join(
        f"<li><span>{_escape(str(item['label']))}</span><strong>{item['count']}</strong></li>" for item in items
    )
    return "<div>" f"<h3>{_escape(title)}</h3>" f"<ul class='distribution-list'>{rows}</ul>" "</div>"


def _render_test_panel(test_report: dict[str, Any] | None) -> str:
    if not test_report:
        return (
            "<section class='panel'>"
            "<h2>Regression checks</h2>"
            "<p class='muted'>Generate this page with a captured test run to display command output here.</p>"
            "</section>"
        )
    status_text = "PASS" if test_report.get("passed") else "FAIL"
    status_class = "good" if test_report.get("passed") else "bad"
    return (
        "<section class='panel'>"
        "<h2>Regression checks</h2>"
        f"<p>Fixture validation + unit test command status: <span class='{status_class}'>{status_text}</span></p>"
        f"<p class='muted'><code>{_escape(str(test_report.get('display_command') or test_report.get('command', '')))}</code></p>"
        f"<pre>{_escape(str(test_report.get('output', '')))}</pre>"
        "</section>"
    )


def _render_audit_panel(audit_report: dict[str, Any] | None) -> str:
    if not audit_report:
        return (
            "<section class='panel'>"
            "<h2>Picture-only audit</h2>"
            "<p class='muted'>Generate this page after running the picture-only audit to display the results here.</p>"
            "</section>"
        )
    status_text = "PASS" if audit_report.get("passed") else "FAIL"
    status_class = "good" if audit_report.get("passed") else "bad"
    issues = audit_report.get("issues", [])
    issue_markup = "<li>No issues found.</li>" if not issues else "".join(f"<li>{_escape(issue)}</li>" for issue in issues)
    return (
        "<section class='panel'>"
        "<h2>Picture-only audit</h2>"
        f"<p>Audit status: <span class='{status_class}'>{status_text}</span> · checked {audit_report.get('checked_render_count', 0)} JPEG pages</p>"
        f"<p class='muted'><code>{_escape(str(audit_report.get('scanner_source_path', '')))}</code></p>"
        f"<ul class='audit-list'>{issue_markup}</ul>"
        "</section>"
    )


def _render_scanner_panel(scanner_report: dict[str, Any] | None) -> str:
    if not scanner_report:
        return (
            "<section class='panel'>"
            "<h2>Scanner evaluation</h2>"
            "<p class='muted'>Generate this page after running the raster fixture scanner to display accuracy metrics here.</p>"
            "</section>"
        )
    rows = "".join(
        "".join(
            [
                "<tr>",
                f"<td>{_escape(str(page['page_id']))}</td>",
                f"<td>{_escape(str(page['label']))}</td>",
                f"<td>{page['card_matches']} / {page['slot_count']}</td>",
                f"<td>${page['predicted_total_usd']:.2f}</td>",
                f"<td>{_escape('; '.join(page['mismatches']) if page['mismatches'] else 'none')}</td>",
                "</tr>",
            ]
        )
        for page in scanner_report.get('page_reports', [])
    )
    card_accuracy = float(scanner_report.get('card_accuracy', 0.0))
    total_expected = float(scanner_report.get('expected_binder_total_usd', 0.0))
    total_predicted = float(scanner_report.get('predicted_binder_total_usd', 0.0))
    accuracy_class = 'good' if card_accuracy >= 0.999 else 'bad'
    total_class = 'good' if round(total_expected, 2) == round(total_predicted, 2) else 'bad'
    verdict = 'Current baseline scanner passes all pages.' if accuracy_class == 'good' else 'Current baseline scanner fails on the adversarial hard cases.'
    return (
        "<section class='panel'>"
        "<h2>Scanner evaluation</h2>"
        f"<p>{_escape(verdict)}</p>"
        f"<p>Raster scanner card accuracy: <span class='{accuracy_class}'>{card_accuracy * 100:.1f}%</span> · "
        f"binder total: <span class='{total_class}'>${total_predicted:.2f}</span> <span class='muted'>(expected ${total_expected:.2f})</span></p>"
        "<div class='table-wrap'><table><thead><tr><th>Page</th><th>Label</th><th>Card matches</th><th>Predicted total</th><th>Mismatches</th></tr></thead>"
        f"<tbody>{rows}</tbody></table></div>"
        "</section>"
    )


def _render_identified_slots(identified_slots: list[dict[str, Any]]) -> str:
    if not identified_slots:
        return "<p class='muted'>No scanner-identification data available.</p>"
    cards = []
    for slot in identified_slots:
        predicted = slot.get('predicted_card') or {}
        image_path = str(slot.get('reference_image_path', '') or '').strip()
        image_markup = ""
        if image_path:
            image_markup = f"<img src='{_escape(image_path.replace('\\', '/'))}' alt='{_escape(str(predicted.get('name', 'card')))}' loading='lazy' />"
        cards.append(
            "".join(
                [
                    "<div class='identified-slot'>",
                    image_markup,
                    f"<div class='name'>{_escape(str(predicted.get('name', 'Unknown card')))}</div>",
                    f"<div class='meta'>{_escape(str(slot.get('slot_id', '')))} · {_escape(str(predicted.get('collector_number', '')))}</div>",
                    f"<div class='meta'>{_escape(str(predicted.get('variant', '')))} · ${float(predicted.get('fixture_price_usd', 0.0)):.2f}</div>",
                    "</div>",
                ]
            )
        )
    return f"<div class='identified-grid'>{''.join(cards)}</div>"


def _escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate and render the raster Pokémon binder fixture set.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH, help="Path to the binder fixture manifest JSON")
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR, help="Directory where page JPEG previews should be written")
    parser.add_argument("--demo-page", type=Path, default=DEFAULT_DEMO_PAGE_PATH, help="Path where the dataset demo HTML page should be written")
    parser.add_argument("--validate-only", action="store_true", help="Validate the manifest without writing previews or the demo page")
    parser.add_argument("--skip-demo-page", action="store_true", help="Render previews but skip writing the HTML dataset demo page")
    parser.add_argument("--run-tests", action="store_true", help="Run the fixture unit test command and include its output in the generated demo page")
    return parser


def main() -> int:
    args = _build_arg_parser().parse_args()
    manifest = load_manifest(args.manifest)
    errors = validate_manifest(manifest)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(
        "Validated binder fixture manifest: "
        f"{manifest['fixture_name']} with {manifest['expected_priced_card_count']} priced cards across {manifest['expected_page_count']} pages"
    )
    if args.validate_only:
        return 0

    rendered_paths = render_fixture_pages(manifest, args.render_dir)
    for path in rendered_paths:
        print(f"Rendered {path}")

    if not args.skip_demo_page:
        test_report = None
        if args.run_tests:
            test_report = run_fixture_test_command(cwd=Path(__file__).resolve().parents[2])
        audit_report = audit_picture_only_pipeline(manifest, args.render_dir)
        demo_path = build_demo_page(
            manifest,
            args.demo_page,
            render_dir=args.render_dir,
            test_report=test_report,
            audit_report=audit_report,
        )
        print(f"Wrote demo page {demo_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
