from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from skimage.measure import label, regionprops

from .binder_fixtures import DEFAULT_MANIFEST_PATH, _apply_card_transform, build_reference_catalog, load_manifest

MATCH_SIZE = (56, 78)
DEFAULT_LAYOUT_BBOXES: tuple[tuple[float, float, float, float], ...] = (
    (0.05, 0.05, 0.25, 0.25),
    (0.365, 0.05, 0.25, 0.25),
    (0.68, 0.05, 0.25, 0.25),
    (0.05, 0.365, 0.25, 0.25),
    (0.365, 0.365, 0.25, 0.25),
    (0.68, 0.365, 0.25, 0.25),
    (0.05, 0.68, 0.25, 0.25),
    (0.365, 0.68, 0.25, 0.25),
    (0.68, 0.68, 0.25, 0.25),
)
IRREGULAR_LAYOUT_NMS_IOU_THRESHOLD = 0.35
IRREGULAR_LAYOUT_MATCH_SCORE_THRESHOLD = 0.12
IRREGULAR_REFINE_AREA_THRESHOLD = 0.048
IRREGULAR_REFINE_SHIFTS = (-0.05, 0.0, 0.05)
IRREGULAR_REFINE_SCALES = (0.85,)
IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA = 0.015
# Lower bar for real-world photos: accept layouts with just 1 candidate
# when the template confidence is also low.
IRREGULAR_LAYOUT_MIN_CANDIDATES = 2
IRREGULAR_LAYOUT_THRESHOLD_PAIRS: tuple[tuple[int, int], ...] = (
    (50, 80),
    (70, 80),
    (90, 80),
    (90, 60),
    (110, 60),
)
IRREGULAR_COMPONENT_MIN_PIXELS = 5_000
IRREGULAR_COMPONENT_MAX_PIXELS = 120_000

# Cascade-matching threshold: when the reference index has more than this
# many unique cards, the scanner uses a fast HSV-histogram pre-filter to
# narrow down to the top candidates before running the full match.
CASCADE_THRESHOLD = 200
CASCADE_TOP_K = 60

# Edge-based detection parameters (complementary to HSV thresholding)
IRREGULAR_EDGE_THRESHOLD_PERCENTILE = 83
IRREGULAR_EDGE_MIN_PIXELS = 4_000
IRREGULAR_EDGE_MAX_PIXELS = 150_000
IRREGULAR_EDGE_WIDTH_RANGE = (0.05, 0.28)
IRREGULAR_EDGE_HEIGHT_RANGE = (0.05, 0.28)
IRREGULAR_EDGE_ASPECT_RATIO_RANGE = (0.40, 1.20)

# Local-variance detection parameters (catches cards with low colour/edge
# contrast against the background but higher local texture than the binder
# page surface).
IRREGULAR_VARIANCE_BLOCK_SIZE = 17       # sliding window side in pixels
IRREGULAR_VARIANCE_THRESHOLD_PERCENTILE = 70
IRREGULAR_VARIANCE_MIN_PIXELS = 6_000
IRREGULAR_VARIANCE_MAX_PIXELS = 140_000
IRREGULAR_VARIANCE_WIDTH_RANGE = (0.06, 0.26)
IRREGULAR_VARIANCE_HEIGHT_RANGE = (0.06, 0.28)
IRREGULAR_VARIANCE_ASPECT_RATIO_RANGE = (0.42, 1.15)


def _square_grid_layout(
    cols: int,
    rows: int,
    *,
    left: float,
    top: float,
    size: float,
    gap_x: float,
    gap_y: float,
) -> tuple[tuple[float, float, float, float], ...]:
    return tuple(
        (left + column * (size + gap_x), top + row * (size + gap_y), size, size)
        for row in range(rows)
        for column in range(cols)
    )


AUTO_LAYOUT_TEMPLATES: tuple[tuple[str, tuple[tuple[float, float, float, float], ...]], ...] = (
    ("single-1x1", _square_grid_layout(1, 1, left=0.25, top=0.25, size=0.50, gap_x=0.0, gap_y=0.0)),
    ("spread-1x2", _square_grid_layout(2, 1, left=0.12, top=0.18, size=0.32, gap_x=0.12, gap_y=0.0)),
    ("quad-2x2", _square_grid_layout(2, 2, left=0.13, top=0.13, size=0.28, gap_x=0.18, gap_y=0.18)),
    ("grid-2x3", _square_grid_layout(3, 2, left=0.07, top=0.14, size=0.22, gap_x=0.10, gap_y=0.16)),
    ("grid-3x2", _square_grid_layout(2, 3, left=0.18, top=0.07, size=0.22, gap_x=0.18, gap_y=0.10)),
    ("grid-3x3", DEFAULT_LAYOUT_BBOXES),
    ("grid-4x3", _square_grid_layout(4, 3, left=0.05, top=0.07, size=0.18, gap_x=0.05, gap_y=0.12)),
    ("grid-3x4", _square_grid_layout(3, 4, left=0.07, top=0.05, size=0.18, gap_x=0.12, gap_y=0.05)),
)
def _variant_configs_for_corpus_size(corpus_size: int) -> tuple[dict[str, Any], ...]:
    """Return the appropriate variant configs based on corpus size."""
    if corpus_size <= CASCADE_THRESHOLD:
        return REFERENCE_VARIANT_CONFIGS
    return LIGHTWEIGHT_VARIANT_CONFIGS


REFERENCE_VARIANT_CONFIGS: tuple[dict[str, Any], ...] = (
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []},
    {"visibility": "glare", "tilt_degrees": 4.0, "render_effects": []},
    {"visibility": "glare", "tilt_degrees": -4.0, "render_effects": []},
    {"visibility": "sleeve_glare", "tilt_degrees": 6.0, "render_effects": []},
    {"visibility": "soft_focus", "tilt_degrees": 0.0, "render_effects": []},
    {"visibility": "tilted", "tilt_degrees": 8.0, "render_effects": []},
    {"visibility": "tilted", "tilt_degrees": -8.0, "render_effects": ["extreme_shear"]},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["motion_blur", "low_light"]},
    {"visibility": "clear", "tilt_degrees": 3.0, "render_effects": ["heavy_glare", "center_band"]},
    {"visibility": "clear", "tilt_degrees": -3.0, "render_effects": ["blue_cast", "bottom_occlusion"]},
    {"visibility": "clear", "tilt_degrees": 5.0, "render_effects": ["desaturate", "corner_occlusion"]},
    {"visibility": "clear", "tilt_degrees": -5.0, "render_effects": ["zoom_crop", "low_light"]},
    {
        "visibility": "glare",
        "tilt_degrees": 7.0,
        "render_effects": ["heavy_glare", "center_band", "desaturate"],
    },
    {
        "visibility": "soft_focus",
        "tilt_degrees": -7.0,
        "render_effects": ["motion_blur", "blue_cast", "bottom_occlusion"],
    },
    {"visibility": "tilted", "tilt_degrees": 9.0, "render_effects": ["zoom_crop", "corner_occlusion"]},
)

LIGHTWEIGHT_VARIANT_CONFIGS: tuple[dict[str, Any], ...] = (
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []},
    {"visibility": "glare", "tilt_degrees": 3.0, "render_effects": []},
    {"visibility": "glare", "tilt_degrees": -3.0, "render_effects": []},
    {"visibility": "soft_focus", "tilt_degrees": 0.0, "render_effects": []},
    {"visibility": "tilted", "tilt_degrees": 6.0, "render_effects": []},
    # Phone-photo variants: low-light, warm cast, desaturated
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "desaturate"]},
    {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "blue_cast"]},
    {"visibility": "soft_focus", "tilt_degrees": 3.0, "render_effects": ["desaturate"]},
)



@lru_cache(maxsize=1)
def _default_reference_index() -> list[dict[str, Any]]:
    manifest = load_manifest(DEFAULT_MANIFEST_PATH)
    return build_reference_index(manifest)


def build_reference_index(
    manifest: dict[str, Any],
    *,
    manifest_root: str | Path | None = None,
) -> list[dict[str, Any]]:
    root_key = str(manifest_root) if manifest_root is not None else ""
    manifest_json = json.dumps(manifest, sort_keys=True)
    return _build_reference_index_cached(manifest_json, root_key)


@lru_cache(maxsize=4)
def _build_reference_index_cached(manifest_json: str, root_key: str) -> list[dict[str, Any]]:
    if root_key:
        manifest_root = Path(root_key)
    else:
        manifest_root = DEFAULT_MANIFEST_PATH.parent
    manifest = json.loads(manifest_json)
    catalog = build_reference_catalog(manifest)
    index: list[dict[str, Any]] = []
    # Pre-computed HSV fingerprints for cascade matching (one per card, not
    # per variant — we pick the "clear" variant as the canonical fingerprint).
    cascade_fingerprints: list[np.ndarray] | None = None
    cascade_card_ids: list[str] | None = None
    if len(catalog) > CASCADE_THRESHOLD:
        cascade_fingerprints = []
        cascade_card_ids = []
    for canonical_card_id, card in sorted(catalog.items()):
        reference_path = manifest_root / str(card["reference_image_path"])
        with Image.open(reference_path) as source_image:
            source = ImageOps.exif_transpose(source_image).convert("RGBA")
        variant_configs = _variant_configs_for_corpus_size(len(catalog))
        variants = [_signature(_prepare_reference_variant(source, config)) for config in variant_configs]
        index.append(
            {
                "canonical_card_id": canonical_card_id,
                "card": dict(card),
                "variants": variants,
            }
        )
        # Store the HSV fingerprint of the "clear" variant for cascade pre-filter.
        if cascade_fingerprints is not None and cascade_card_ids is not None:
            cascade_fingerprints.append(_fingerprint_from_hsv(variants[0]["hsv"]))
            cascade_card_ids.append(canonical_card_id)
    # Add empty-slot reference so the matcher can recognise blank pockets
    empty_ref_path = manifest_root / "reference_cards" / "empty.jpg"
    if empty_ref_path.exists():
        with Image.open(empty_ref_path) as empty_source:
            empty = ImageOps.exif_transpose(empty_source).convert("RGBA")
    else:
        empty = Image.new("RGBA", MATCH_SIZE, (12, 24, 40, 255))
    blank_variants = [_signature(_prepare_reference_variant(empty, config)) for config in REFERENCE_VARIANT_CONFIGS]
    index.append(
        {
            "canonical_card_id": "empty",
            "card": {
                "canonical_card_id": "empty",
                "name": "Empty slot",
                "reference_image_path": "",
                "fixture_price_usd": 0.0,
            },
            "variants": blank_variants,
        }
    )
    # Attach cascade metadata to the index (first entry carries it).
    if cascade_fingerprints is not None and len(index) > 0:
        index[0]["_cascade_fingerprints"] = np.stack(cascade_fingerprints, axis=0)
        index[0]["_cascade_card_ids"] = cascade_card_ids
    return index


def _fingerprint_from_hsv(hsv: np.ndarray) -> np.ndarray:
    """Compute a compact fingerprint from an HSV image patch.

    Returns a 1-D float32 array of normalised 2D histogram bin counts.
    """
    h_bins, s_bins = 12, 8
    hs = hsv[:, :, :2].reshape(-1, 2)
    hist, _ = np.histogramdd(hs, bins=(h_bins, s_bins), range=((0, 1), (0, 1)))
    hist_f = hist.astype(np.float32).ravel()
    total = hist_f.sum()
    return hist_f / max(1.0, total)


def scan_fixture_image(
    path: str | Path,
    *,
    reference_index: list[dict[str, Any]] | None = None,
    layout_bboxes: tuple[tuple[float, float, float, float], ...] | None = None,
) -> dict[str, Any]:
    image_path = Path(path)
    index = reference_index or _default_reference_index()
    with Image.open(image_path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("RGB")

    inferred_layout_bboxes = tuple(layout_bboxes or _detect_layout_bboxes(image, reference_index=index))
    slots: list[dict[str, Any]] = []
    predicted_total = 0.0

    for position, bbox in enumerate(inferred_layout_bboxes, start=1):
        best_match = _predict_slot_match(_crop_bbox(image, bbox), index)
        slot_id = f"slot-{position:02d}"
        predicted_card = dict(best_match["card"])
        predicted_total += float(predicted_card.get("fixture_price_usd", 0.0))
        slots.append(
            {
                "slot_id": slot_id,
                "bbox_norm": [round(value, 4) for value in bbox],
                "card": predicted_card,
                "match_score": round(float(best_match["score"]), 6),
            }
        )

    return {
        "page_id": image_path.stem,
        "slot_count": len(slots),
        "predicted_total_usd": round(predicted_total, 2),
        "slots": slots,
    }


def evaluate_scanner_on_fixture_dataset(
    manifest: dict[str, Any],
    render_dir: str | Path,
    *,
    manifest_root: str | Path | None = None,
) -> dict[str, Any]:
    render_path = Path(render_dir)
    reference_index = build_reference_index(manifest, manifest_root=manifest_root)
    page_reports: list[dict[str, Any]] = []
    total_slots = 0
    matched_cards = 0
    predicted_total = 0.0

    for expected_page in manifest.get("pages", []):
        page_path = render_path / f"{expected_page['page_id']}.jpg"
        scanned_page = scan_fixture_image(page_path, reference_index=reference_index)
        expected_slots = _sort_slots_reading_order(list(expected_page["slots"]))
        scanned_slots = _sort_slots_reading_order(list(scanned_page["slots"]))
        expected_to_scanned, unmatched_scanned_indices = _match_slots_by_position(expected_slots, scanned_slots)
        page_mismatches: list[str] = []
        page_card_matches = 0
        identified_slots: list[dict[str, Any]] = []

        for expected_index, expected_slot in enumerate(expected_slots):
            total_slots += 1
            scanned_index = expected_to_scanned.get(expected_index)
            if scanned_index is None:
                page_mismatches.append(f"{expected_slot['slot_id']}: missing detection")
                identified_slots.append(
                    {
                        "slot_id": expected_slot["slot_id"],
                        "matched": False,
                        "reference_image_path": None,
                        "predicted_card": None,
                        "expected_card": expected_slot["card"],
                    }
                )
                continue

            scanned_slot = scanned_slots[scanned_index]
            expected_card = expected_slot.get("card")
            predicted_card = scanned_slot["card"]
            is_match = _cards_match(expected_card, predicted_card)
            if is_match:
                matched_cards += 1
                page_card_matches += 1
            else:
                expected_label = expected_card.get("canonical_card_id", "empty") if expected_card else "empty"
                predicted_label = predicted_card.get("canonical_card_id", "empty") if predicted_card else "empty"
                page_mismatches.append(
                    f"{expected_slot['slot_id']}: expected {expected_label} got {predicted_label}"
                )
            identified_slots.append(
                {
                    "slot_id": expected_slot["slot_id"],
                    "matched": is_match,
                    "reference_image_path": (predicted_card or {}).get("reference_image_path"),
                    "predicted_card": predicted_card,
                    "expected_card": expected_card,
                }
            )

        for scanned_index in unmatched_scanned_indices:
            scanned_slot = scanned_slots[scanned_index]
            page_mismatches.append(
                f"unexpected detected slot {scanned_slot['slot_id']}: got {scanned_slot['card'].get('canonical_card_id')}"
            )
            identified_slots.append(
                {
                    "slot_id": scanned_slot["slot_id"],
                    "matched": False,
                    "reference_image_path": scanned_slot["card"].get("reference_image_path"),
                    "predicted_card": scanned_slot["card"],
                    "expected_card": None,
                }
            )

        predicted_total += scanned_page["predicted_total_usd"]
        page_reports.append(
            {
                "page_id": expected_page["page_id"],
                "label": expected_page["label"],
                "expected_total_usd": round(float(expected_page["expected_total_usd"]), 2),
                "predicted_total_usd": scanned_page["predicted_total_usd"],
                "slot_count": len(expected_slots),
                "predicted_slot_count": len(scanned_slots),
                "card_matches": page_card_matches,
                "mismatches": page_mismatches,
                "identified_slots": identified_slots,
            }
        )

    return {
        "pages_evaluated": len(page_reports),
        "card_accuracy": matched_cards / total_slots if total_slots else 0.0,
        "matched_cards": matched_cards,
        "total_slots": total_slots,
        "expected_binder_total_usd": round(float(manifest.get("expected_binder_total_usd", 0.0)), 2),
        "predicted_binder_total_usd": round(predicted_total, 2),
        "page_reports": page_reports,
    }


def _detect_layout_bboxes(
    image: Image.Image,
    *,
    reference_index: list[dict[str, Any]] | None = None,
) -> tuple[tuple[float, float, float, float], ...]:
    """Detect card bounding boxes in a binder-page image.

    Uses contour detection on edge maps to find rectangular card-like
    regions.  Works on any number of pockets — no template assumptions.
    """
    bboxes = _detect_card_bboxes(image)
    if bboxes:
        return bboxes
    # Fallback: try the old irregular detector.
    for candidate_image in (image, ImageOps.equalize(image)):
        irregular = _detect_irregular_layout_bboxes(
            candidate_image,
            reference_index=reference_index or _default_reference_index(),
        )
        if irregular:
            return irregular
    # Last resort: assume a 3×3 grid.
    return DEFAULT_LAYOUT_BBOXES


def _detect_card_bboxes(
    image: Image.Image,
) -> tuple[tuple[float, float, float, float], ...]:
    """Find card rectangles using multi-scale region detection.

    Strategy: cards are bright rectangular regions separated by dark
    binder gaps.  We threshold at multiple levels, find contours at
    each level, merge overlapping detections, and filter by shape.
    No template assumptions — works on any pocket count.
    """
    import cv2

    img_w, img_h = image.size
    gray = np.asarray(image.convert("L"), dtype=np.uint8)

    # CLAHE for even lighting.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Multi-level thresholding to find card regions at different
    # brightness levels (handles mixed card colors).
    all_bboxes: list[tuple[float, float, float, float]] = []

    for thresh_ratio in (0.35, 0.50, 0.65):
        thresh_val = int(gray.max() * thresh_ratio)
        _, binary = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)

        # Close small gaps inside cards (artwork creates holes).
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

        # Find contours of bright regions (the cards).
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for c in contours:
            area = cv2.contourArea(c)
            area_f = area / (img_w * img_h)
            if area_f < 0.008 or area_f > 0.14:
                continue

            x, y, cw, ch = cv2.boundingRect(c)
            ar = cw / max(1, ch)
            # Allow wider aspect range since perspective distorts cards.
            if ar < 0.45 or ar > 1.05:
                continue

            # Solidity check: cards are mostly solid rectangles.
            hull = cv2.convexHull(c)
            hull_area = cv2.contourArea(hull)
            solidity = area / max(1.0, hull_area)
            if solidity < 0.65:
                continue

            # Small inward margin so the crop doesn't catch pocket edges.
            margin = 0.02
            nx = max(0.0, x / img_w + margin)
            ny = max(0.0, y / img_h + margin)
            nw = min(1.0 - margin, (x + cw) / img_w - margin) - nx
            nh = min(1.0 - margin, (y + ch) / img_h - margin) - ny
            if nw > 0.04 and nh > 0.06:
                all_bboxes.append((nx, ny, nw, nh))

    if not all_bboxes:
        return _detect_card_bboxes_contour(image, gray,
            cv2.Canny(gray, 30, 100))

    # Merge overlapping detections from multiple threshold levels.
    merged = list(_merge_overlapping_bboxes(all_bboxes, iou_threshold=0.6))

    if len(merged) < 2:
        return _detect_card_bboxes_contour(image, gray,
            cv2.Canny(gray, 30, 100))

    return _sort_bboxes_reading_order(merged)

def _detect_card_bboxes_contour(
    image: Image.Image,
    gray: np.ndarray,
    edges: np.ndarray,
) -> tuple[tuple[float, float, float, float], ...]:
    """Fallback: contour-based card detection when thresholding fails."""
    import cv2

    img_w, img_h = image.size

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    closed = cv2.morphologyEx(cv2.bitwise_or(binary, edges), cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    raw: list[tuple[float, float, float, float]] = []
    for c in contours:
        area = cv2.contourArea(c)
        area_f = area / (img_w * img_h)
        if area_f < 0.006 or area_f > 0.14:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        ar = cw / max(1, ch)
        if ar < 0.50 or ar > 1.0:
            continue
        pad = 0.02
        nx = max(0.0, x / img_w - pad)
        ny = max(0.0, y / img_h - pad)
        nw = min(1.0, (x + cw) / img_w + pad) - nx
        nh = min(1.0, (y + ch) / img_h + pad) - ny
        raw.append((nx, ny, nw, nh))

    if len(raw) <= 1:
        return tuple(raw)
    return _sort_bboxes_reading_order(list(_merge_overlapping_bboxes(raw)))


def _merge_overlapping_bboxes(
    bboxes: list[tuple[float, float, float, float]],
    iou_threshold: float = 0.5,
) -> tuple[tuple[float, float, float, float], ...]:
    """Merge bounding boxes with high overlap, keeping the larger one."""
    if len(bboxes) <= 1:
        return tuple(bboxes)

    # Sort by area descending so larger boxes survive.
    sorted_boxes = sorted(bboxes, key=lambda b: -b[2] * b[3])
    kept: list[tuple[float, float, float, float]] = []

    for box in sorted_boxes:
        if any(_bbox_iou(box, existing) > iou_threshold for existing in kept):
            continue
        kept.append(box)

    return tuple(kept)


def _refine_irregular_bbox(
    image: Image.Image,
    bbox: tuple[float, float, float, float],
    reference_index: list[dict[str, Any]],
) -> tuple[float, tuple[float, float, float, float], str]:
    """Run a small local search around *bbox* and return the best sub-box."""
    left, top, w, h = bbox
    best_match = _predict_slot_match(_crop_bbox(image, bbox), reference_index)
    best = (best_match["score"], bbox, best_match["card"]["canonical_card_id"])
    for dx in IRREGULAR_REFINE_SHIFTS:
        for dy in IRREGULAR_REFINE_SHIFTS:
            for scale in IRREGULAR_REFINE_SCALES:
                cx = left + w / 2 + dx
                cy = top + h / 2 + dy
                sw = w * scale
                sh = h * scale
                sub = (max(0.0, cx - sw / 2), max(0.0, cy - sh / 2), sw, sh)
                match = _predict_slot_match(_crop_bbox(image, sub), reference_index)
                if match["score"] < best[0]:
                    best = (match["score"], sub, match["card"]["canonical_card_id"])
    return best


def _detect_irregular_layout_bboxes(
    image: Image.Image,
    *,
    reference_index: list[dict[str, Any]],
) -> tuple[tuple[float, float, float, float], ...]:
    hsv = np.asarray(image.convert("HSV"), dtype=np.uint8)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate_bboxes: list[tuple[float, tuple[float, float, float, float]]] = []

    # ---- 0. Adapt thresholds based on image statistics ----
    # Real-world photos often have lower saturation and value ranges
    # than synthetic fixtures.  Scale thresholds down for washed-out images.
    mean_sat = float(np.percentile(saturation, 50))
    threshold_scale = max(0.55, min(1.0, mean_sat / 80.0))

    # ---- 1. HSV-based candidates ----
    for saturation_threshold, value_threshold in IRREGULAR_LAYOUT_THRESHOLD_PAIRS:
        sat_t = saturation_threshold * threshold_scale
        val_t = value_threshold * threshold_scale
        component_mask = (saturation > sat_t) & (value > val_t)
        mask_image = Image.fromarray((component_mask.astype(np.uint8) * 255), mode="L")
        mask_image = mask_image.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(5))
        for component_pixels, component_bbox in _connected_components(np.asarray(mask_image) > 0):
            normalized_bbox = _normalize_irregular_component_bbox(image, component_pixels, component_bbox)
            if normalized_bbox is None:
                continue
            aspect_score = 1.0 - abs((component_bbox[2] - component_bbox[0]) / max(1, component_bbox[3] - component_bbox[1]) - 0.73)
            candidate_bboxes.append((component_pixels * max(0.1, aspect_score), normalized_bbox))

    # ---- 2. Edge-based candidates (complementary) ----
    candidate_bboxes.extend(_detect_edge_components(image))

    # ---- 3. Variance-based candidates (complementary) ----
    candidate_bboxes.extend(_detect_variance_components(image))

    # ---- 3b. Canny-edge candidates (complementary, robust to real photos) ----
    import cv2

    gray_img = image.convert("L")
    gray_arr = np.asarray(gray_img, dtype=np.uint8)
    # Use a low threshold for Canny to pick up faint card edges.
    edges_canny = cv2.Canny(gray_arr, 30, 90)
    # Dilate to connect edge fragments.
    kernel = np.ones((5, 5), np.uint8)
    edges_dilated = cv2.dilate(edges_canny, kernel, iterations=2)
    # Close small gaps, then erode to trim bloat.
    edges_closed = cv2.morphologyEx(edges_dilated, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    edges_final = cv2.erode(edges_closed, np.ones((7, 7), np.uint8), iterations=1)

    canny_candidates: list[tuple[float, tuple[float, float, float, float]]] = []
    for component_pixels, component_bbox in _connected_components(edges_final > 0):
        if component_pixels < 1500 or component_pixels > 90000:
            continue
        left, top, right, bottom = component_bbox
        cw = right - left
        ch = bottom - top
        cw_norm = cw / image.width
        ch_norm = ch / image.height
        aspect = cw / max(1, ch)
        if not (0.04 <= cw_norm <= 0.30 and 0.05 <= ch_norm <= 0.32):
            continue
        if not (0.38 <= aspect <= 1.15):
            continue
        expand_x = max(10, int(cw * 0.20))
        expand_y = max(12, int(ch * 0.10))
        nx = max(0.0, (left - expand_x) / image.width)
        ny = max(0.0, (top - expand_y) / image.height)
        nw = min(1.0, (right + expand_x) / image.width) - nx
        nh = min(1.0, (bottom + expand_y) / image.height) - ny
        aspect_score = 1.0 - abs(aspect - 0.73) / 0.5
        canny_candidates.append((component_pixels * max(0.1, aspect_score), (nx, ny, nw, nh)))
    candidate_bboxes.extend(canny_candidates)

    # ---- 4. Deduplicate, score, then NMS by match quality ----
    deduped: list[tuple[float, tuple[float, float, float, float]]] = []
    for score, bbox in candidate_bboxes:
        if any(_bbox_iou(bbox, existing_bbox) > 0.8 for _, existing_bbox in deduped):
            continue
        deduped.append((score, bbox))

    # Limit to top 25 by component score to keep scoring fast
    top_candidates = sorted(deduped, key=lambda item: item[0], reverse=True)[:25]

    # Score each candidate with the matcher
    scored: list[tuple[float, tuple[float, float, float, float]]] = []
    for _, bbox in top_candidates:
        best_match = _predict_slot_match(_crop_bbox(image, bbox), reference_index)
        scored.append((best_match["score"], bbox))

    # Refine large accepted candidates with a local grid search
    refined: list[tuple[float, tuple[float, float, float, float]]] = []
    for match_score, bbox in scored:
        area = bbox[2] * bbox[3]
        if area > IRREGULAR_REFINE_AREA_THRESHOLD and match_score <= IRREGULAR_LAYOUT_MATCH_SCORE_THRESHOLD:
            refined_match = _refine_irregular_bbox(image, bbox, reference_index)
            refined.append((refined_match[0], refined_match[1]))
        else:
            refined.append((match_score, bbox))

    # Deduplicate refined candidates
    deduped_refined: list[tuple[float, tuple[float, float, float, float]]] = []
    for score, bbox in refined:
        if any(_bbox_iou(bbox, existing_bbox) > 0.8 for _, existing_bbox in deduped_refined):
            continue
        deduped_refined.append((score, bbox))

    # Sort by match score (lower is better), then NMS
    deduped_refined.sort(key=lambda item: item[0])
    accepted_bboxes: list[tuple[float, float, float, float]] = []
    for match_score, bbox in deduped_refined:
        if match_score > IRREGULAR_LAYOUT_MATCH_SCORE_THRESHOLD:
            continue
        if bbox[2] * bbox[3] < IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA:
            continue
        if any(_bbox_iou(bbox, existing_bbox) > IRREGULAR_LAYOUT_NMS_IOU_THRESHOLD for existing_bbox in accepted_bboxes):
            continue
        accepted_bboxes.append(bbox)

    return tuple(_sort_bboxes_reading_order(accepted_bboxes)) if len(accepted_bboxes) >= IRREGULAR_LAYOUT_MIN_CANDIDATES else ()


def _detect_edge_components(
    image: Image.Image,
) -> list[tuple[float, tuple[float, float, float, float]]]:
    """Detect candidate card regions using gradient/edge information.

    Complementary to the HSV-based detection in
    :func:`_detect_irregular_layout_bboxes`.  Cards with low colour
    contrast against the binder page (e.g.  glare, soft-focus, or
    pale artwork) still produce visible edges that this method
    can pick up.

    Uses Otsu thresholding (adaptive per image) instead of a fixed
    percentile, so that images with weak overall edges still isolate
    card boundaries cleanly.
    """
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    gy, gx = np.gradient(gray)
    edge = np.hypot(gx, gy)

    # Convert to 8-bit for Otsu thresholding
    edge_max = float(edge.max())
    if edge_max > 1e-6:
        edge_8bit = (edge / edge_max * 255).astype(np.uint8)
        # Otsu's method — maximise between-class variance
        hist = np.bincount(edge_8bit.ravel(), minlength=256)[:256]
        total = edge_8bit.size
        sum_total = np.dot(np.arange(256, dtype=np.float64), hist)
        sum_bg = 0.0
        w_bg = 0
        best_thresh = int(np.percentile(edge_8bit, 83))  # fallback
        best_var = 0.0
        for t in range(256):
            w_bg += hist[t]
            if w_bg == 0:
                continue
            w_fg = total - w_bg
            if w_fg == 0:
                break
            sum_bg += t * hist[t]
            mu_bg = sum_bg / w_bg
            mu_fg = (sum_total - sum_bg) / w_fg
            between_var = w_bg * w_fg * (mu_bg - mu_fg) ** 2
            if between_var > best_var:
                best_var = between_var
                best_thresh = t
        threshold = best_thresh / 255.0 * edge_max
    else:
        threshold = float(np.percentile(edge, IRREGULAR_EDGE_THRESHOLD_PERCENTILE))

    edge_mask = (edge > threshold).astype(np.uint8) * 255

    mask_img = Image.fromarray(edge_mask, mode="L")
    # Dilate to connect card-edge fragments, then erode to suppress noise,
    # then dilate again to fill the card body inside the edge ring.
    mask_img = (
        mask_img.filter(ImageFilter.MaxFilter(9))
        .filter(ImageFilter.MinFilter(7))
        .filter(ImageFilter.MaxFilter(5))
    )

    candidates: list[tuple[float, tuple[float, float, float, float]]] = []
    for component_pixels, component_bbox in _connected_components(np.asarray(mask_img) > 0):
        normalized = _normalize_edge_component_bbox(image, component_pixels, component_bbox)
        if normalized is None:
            continue
        left, top, w, h = normalized
        aspect = w / max(h, 1e-6)
        aspect_score = 1.0 - abs(aspect - 0.73) / 0.5
        candidates.append((component_pixels * max(0.1, aspect_score), normalized))

    return candidates


def _normalize_edge_component_bbox(
    image: Image.Image,
    component_pixels: int,
    component_bbox: tuple[int, int, int, int],
) -> tuple[float, float, float, float] | None:
    """Normalise a component from edge detection with relaxed size constraints."""
    if component_pixels < IRREGULAR_EDGE_MIN_PIXELS or component_pixels > IRREGULAR_EDGE_MAX_PIXELS:
        return None

    left, top, right, bottom = component_bbox
    width = right - left
    height = bottom - top
    width_norm = width / image.width
    height_norm = height / image.height
    aspect_ratio = width / max(1, height)

    w_lo, w_hi = IRREGULAR_EDGE_WIDTH_RANGE
    h_lo, h_hi = IRREGULAR_EDGE_HEIGHT_RANGE
    ar_lo, ar_hi = IRREGULAR_EDGE_ASPECT_RATIO_RANGE

    if not (w_lo <= width_norm <= w_hi and h_lo <= height_norm <= h_hi):
        return None
    if not (ar_lo <= aspect_ratio <= ar_hi):
        return None

    # More generous expansion for edge-detected blobs (they are often
    # the card border ring rather than the full face).
    expand_x = max(18, int(width * 0.22))
    expand_y = max(20, int(height * 0.12))
    normalized_left = max(0.0, (left - expand_x) / image.width)
    normalized_top = max(0.0, (top - expand_y) / image.height)
    normalized_right = min(1.0, (right + expand_x) / image.width)
    normalized_bottom = min(1.0, (bottom + expand_y) / image.height)
    return (
        normalized_left,
        normalized_top,
        normalized_right - normalized_left,
        normalized_bottom - normalized_top,
    )


def _detect_variance_components(
    image: Image.Image,
) -> list[tuple[float, tuple[float, float, float, float]]]:
    """Detect candidate card regions using local texture variance.

    Cards have higher local intensity variance than the blank binder
    page background.  This complements HSV and edge detection for
    cards where both colour contrast and crisp edges are weak (e.g.
    soft-focus + pale artwork + moderate glare).
    """
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    height, width = gray.shape
    block = IRREGULAR_VARIANCE_BLOCK_SIZE
    half = block // 2

    # Integral images for fast block-sum queries (vectorised).
    integral = np.pad(
        gray.cumsum(axis=0).cumsum(axis=1), ((1, 0), (1, 0)), mode="constant"
    )
    integral_sq = np.pad(
        (gray**2).cumsum(axis=0).cumsum(axis=1), ((1, 0), (1, 0)), mode="constant"
    )

    # Compute per-pixel local variance in one shot via array slicing.
    y_idx = np.arange(height, dtype=np.intp)
    x_idx = np.arange(width, dtype=np.intp)

    y1 = np.clip(y_idx[:, None] - half, 0, height).astype(np.intp)
    y2 = np.clip(y_idx[:, None] + half + 1, 0, height).astype(np.intp)
    x1 = np.clip(x_idx[None, :] - half, 0, width).astype(np.intp)
    x2 = np.clip(x_idx[None, :] + half + 1, 0, width).astype(np.intp)

    s = integral[y2, x2] - integral[y1, x2] - integral[y2, x1] + integral[y1, x1]
    sq = integral_sq[y2, x2] - integral_sq[y1, x2] - integral_sq[y2, x1] + integral_sq[y1, x1]
    n = ((y2 - y1) * (x2 - x1)).astype(np.float32)
    var_map = sq / n - (s / n) ** 2

    threshold = float(np.percentile(var_map, IRREGULAR_VARIANCE_THRESHOLD_PERCENTILE))
    var_mask = (var_map > threshold).astype(np.uint8) * 255

    mask_img = Image.fromarray(var_mask, mode="L")
    mask_img = (
        mask_img.filter(ImageFilter.MaxFilter(11))
        .filter(ImageFilter.MinFilter(9))
        .filter(ImageFilter.MaxFilter(7))
    )

    candidates: list[tuple[float, tuple[float, float, float, float]]] = []
    for component_pixels, component_bbox in _connected_components(np.asarray(mask_img) > 0):
        normalized = _normalize_variance_component_bbox(image, component_pixels, component_bbox)
        if normalized is None:
            continue
        left, top, w, h = normalized
        aspect = w / max(h, 1e-6)
        aspect_score = 1.0 - abs(aspect - 0.73) / 0.5
        candidates.append((component_pixels * max(0.1, aspect_score), normalized))

    return candidates


def _normalize_variance_component_bbox(
    image: Image.Image,
    component_pixels: int,
    component_bbox: tuple[int, int, int, int],
) -> tuple[float, float, float, float] | None:
    if component_pixels < IRREGULAR_VARIANCE_MIN_PIXELS or component_pixels > IRREGULAR_VARIANCE_MAX_PIXELS:
        return None

    left, top, right, bottom = component_bbox
    width = right - left
    height = bottom - top
    width_norm = width / image.width
    height_norm = height / image.height
    aspect_ratio = width / max(1, height)

    w_lo, w_hi = IRREGULAR_VARIANCE_WIDTH_RANGE
    h_lo, h_hi = IRREGULAR_VARIANCE_HEIGHT_RANGE
    ar_lo, ar_hi = IRREGULAR_VARIANCE_ASPECT_RATIO_RANGE

    if not (w_lo <= width_norm <= w_hi and h_lo <= height_norm <= h_hi):
        return None
    if not (ar_lo <= aspect_ratio <= ar_hi):
        return None

    expand_x = max(16, int(width * 0.18))
    expand_y = max(18, int(height * 0.10))
    normalized_left = max(0.0, (left - expand_x) / image.width)
    normalized_top = max(0.0, (top - expand_y) / image.height)
    normalized_right = min(1.0, (right + expand_x) / image.width)
    normalized_bottom = min(1.0, (bottom + expand_y) / image.height)
    return (
        normalized_left,
        normalized_top,
        normalized_right - normalized_left,
        normalized_bottom - normalized_top,
    )


def _normalize_irregular_component_bbox(
    image: Image.Image,
    component_pixels: int,
    component_bbox: tuple[int, int, int, int],
) -> tuple[float, float, float, float] | None:
    if component_pixels < IRREGULAR_COMPONENT_MIN_PIXELS or component_pixels > IRREGULAR_COMPONENT_MAX_PIXELS:
        return None

    left, top, right, bottom = component_bbox
    width = right - left
    height = bottom - top
    width_norm = width / image.width
    height_norm = height / image.height
    aspect_ratio = width / max(1, height)

    if not (0.06 <= width_norm <= 0.22 and 0.06 <= height_norm <= 0.26):
        return None
    if not (0.45 <= aspect_ratio <= 1.1):
        return None

    expand_x = max(16, int(width * 0.18))
    expand_y = max(18, int(height * 0.08))
    normalized_left = max(0.0, (left - expand_x) / image.width)
    normalized_top = max(0.0, (top - expand_y) / image.height)
    normalized_right = min(1.0, (right + expand_x) / image.width)
    normalized_bottom = min(1.0, (bottom + expand_y) / image.height)
    return (
        normalized_left,
        normalized_top,
        normalized_right - normalized_left,
        normalized_bottom - normalized_top,
    )


def _connected_components(mask: np.ndarray) -> list[tuple[int, tuple[int, int, int, int]]]:
    labeled = label(mask, connectivity=1)
    if labeled.max() == 0:
        return []
    props = regionprops(labeled)
    return [
        (int(prop.area), (prop.bbox[1], prop.bbox[0], prop.bbox[3], prop.bbox[2]))
        for prop in props
    ]


def _score_layout_template(
    edge_integral: np.ndarray,
    layout_bboxes: tuple[tuple[float, float, float, float], ...],
    width: int,
    height: int,
) -> float:
    if not layout_bboxes:
        return float("-inf")
    return float(np.mean([_bbox_edge_ring_score(edge_integral, bbox, width, height) for bbox in layout_bboxes]))


def _bbox_edge_ring_score(
    edge_integral: np.ndarray,
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
) -> float:
    x, y, w, h = bbox
    left = x * width
    top = y * height
    box_w = w * width
    box_h = h * height
    ring = 0.04
    return (
        _rect_mean(edge_integral, left, top, left + box_w, top + box_h * ring)
        + _rect_mean(edge_integral, left, top + box_h * (1.0 - ring), left + box_w, top + box_h)
        + _rect_mean(edge_integral, left, top, left + box_w * ring, top + box_h)
        + _rect_mean(edge_integral, left + box_w * (1.0 - ring), top, left + box_w, top + box_h)
    ) / 4.0


def _integral_image(array: np.ndarray) -> np.ndarray:
    return np.pad(array.cumsum(axis=0).cumsum(axis=1), ((1, 0), (1, 0)), mode="constant")


def _rect_mean(integral: np.ndarray, left: float, top: float, right: float, bottom: float) -> float:
    max_y = integral.shape[0] - 1
    max_x = integral.shape[1] - 1
    x1 = max(0, min(max_x, int(round(left))))
    y1 = max(0, min(max_y, int(round(top))))
    x2 = max(0, min(max_x, int(round(right))))
    y2 = max(0, min(max_y, int(round(bottom))))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    total = integral[y2, x2] - integral[y1, x2] - integral[y2, x1] + integral[y1, x1]
    return float(total) / float((x2 - x1) * (y2 - y1))


def _match_slots_by_position(
    expected_slots: list[dict[str, Any]],
    scanned_slots: list[dict[str, Any]],
) -> tuple[dict[int, int], list[int]]:
    pair_candidates: list[tuple[float, int, int]] = []
    for expected_index, expected_slot in enumerate(expected_slots):
        for scanned_index, scanned_slot in enumerate(scanned_slots):
            distance = _slot_center_distance(expected_slot, scanned_slot)
            if distance <= _slot_pairing_threshold(expected_slot, scanned_slot):
                pair_candidates.append((distance, expected_index, scanned_index))

    expected_to_scanned: dict[int, int] = {}
    used_scanned_indices: set[int] = set()
    for _, expected_index, scanned_index in sorted(pair_candidates):
        if expected_index in expected_to_scanned or scanned_index in used_scanned_indices:
            continue
        expected_to_scanned[expected_index] = scanned_index
        used_scanned_indices.add(scanned_index)

    unmatched_scanned_indices = [
        scanned_index for scanned_index in range(len(scanned_slots)) if scanned_index not in used_scanned_indices
    ]
    return expected_to_scanned, unmatched_scanned_indices


def _slot_center_distance(left_slot: dict[str, Any], right_slot: dict[str, Any]) -> float:
    left_x, left_y = _bbox_center(_slot_bbox(left_slot))
    right_x, right_y = _bbox_center(_slot_bbox(right_slot))
    return float(np.hypot(left_x - right_x, left_y - right_y))


def _slot_pairing_threshold(expected_slot: dict[str, Any], scanned_slot: dict[str, Any]) -> float:
    expected_bbox = _slot_bbox(expected_slot)
    scanned_bbox = _slot_bbox(scanned_slot)
    slot_scale = max(expected_bbox[2], expected_bbox[3], scanned_bbox[2], scanned_bbox[3])
    return max(0.12, slot_scale * 0.6)


def _sort_slots_reading_order(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not slots:
        return []
    decorated_slots = [(_slot_bbox(slot), slot) for slot in slots]
    decorated_slots.sort(key=lambda item: (_bbox_center(item[0])[1], _bbox_center(item[0])[0]))
    rows: list[list[tuple[tuple[float, float, float, float], dict[str, Any]]]] = []
    for bbox, slot in decorated_slots:
        center_x, center_y = _bbox_center(bbox)
        if rows:
            previous_row = rows[-1]
            previous_centers = [_bbox_center(previous_bbox)[1] for previous_bbox, _ in previous_row]
            previous_heights = [previous_bbox[3] for previous_bbox, _ in previous_row]
            row_center_y = sum(previous_centers) / len(previous_centers)
            row_height = max(previous_heights)
            if abs(center_y - row_center_y) <= max(row_height * 0.45, bbox[3] * 0.45):
                previous_row.append((bbox, slot))
                continue
        rows.append([(bbox, slot)])

    ordered_slots: list[dict[str, Any]] = []
    for row in rows:
        row.sort(key=lambda item: _bbox_center(item[0])[0])
        ordered_slots.extend(slot for _, slot in row)
    return ordered_slots


def _sort_bboxes_reading_order(
    bboxes: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float, float]]:
    pseudo_slots = [{"bbox_norm": list(bbox)} for bbox in bboxes]
    return [tuple(_slot_bbox(slot)) for slot in _sort_slots_reading_order(pseudo_slots)]


def _slot_sort_key(slot: dict[str, Any]) -> tuple[float, float]:
    center_x, center_y = _bbox_center(_slot_bbox(slot))
    return (round(center_y, 4), round(center_x, 4))


def _slot_bbox(slot: dict[str, Any]) -> tuple[float, float, float, float]:
    bbox = slot.get("bbox_norm") or [0.0, 0.0, 0.0, 0.0]
    x, y, w, h = [float(value) for value in bbox]
    return (x, y, w, h)


def _bbox_center(bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    x, y, w, h = bbox
    return (x + w / 2.0, y + h / 2.0)


def _bbox_iou(
    left_bbox: tuple[float, float, float, float],
    right_bbox: tuple[float, float, float, float],
) -> float:
    left_x1, left_y1, left_w, left_h = left_bbox
    right_x1, right_y1, right_w, right_h = right_bbox
    left_x2 = left_x1 + left_w
    left_y2 = left_y1 + left_h
    right_x2 = right_x1 + right_w
    right_y2 = right_y1 + right_h

    intersection_x1 = max(left_x1, right_x1)
    intersection_y1 = max(left_y1, right_y1)
    intersection_x2 = min(left_x2, right_x2)
    intersection_y2 = min(left_y2, right_y2)
    if intersection_x2 <= intersection_x1 or intersection_y2 <= intersection_y1:
        return 0.0

    intersection_area = (intersection_x2 - intersection_x1) * (intersection_y2 - intersection_y1)
    union_area = left_w * left_h + right_w * right_h - intersection_area
    return intersection_area / union_area if union_area > 0 else 0.0


def _crop_bbox(image: Image.Image, bbox: tuple[float, float, float, float]) -> Image.Image:
    width, height = image.size
    x, y, w, h = bbox
    return image.crop(
        (
            int(round(x * width)),
            int(round(y * height)),
            int(round((x + w) * width)),
            int(round((y + h) * height)),
        )
    )


def _predict_slot_match(slot_image: Image.Image, reference_index: list[dict[str, Any]]) -> dict[str, Any]:
    # Check whether cascade matching is available (pre-computed fingerprints
    # are stored on the first index entry when the corpus is large).
    cascade_prints: np.ndarray | None = reference_index[0].get("_cascade_fingerprints")  # type: ignore[assignment]
    cascade_ids: list[str] | None = reference_index[0].get("_cascade_card_ids")  # type: ignore[assignment]

    best_match: dict[str, Any] | None = None
    for card_crop in _extract_card_candidates(slot_image):
        slot_signature = _signature(_prepare_slot_image(card_crop))
        if cascade_prints is not None and cascade_ids is not None:
            candidate_match = _cascade_match(slot_signature, reference_index, cascade_prints, cascade_ids)
        else:
            candidate_match = _best_match(slot_signature, reference_index)
        if best_match is None or candidate_match["score"] < best_match["score"]:
            best_match = candidate_match
    assert best_match is not None
    return best_match


def _find_top_k_candidates(
    query_hsv: np.ndarray,
    cascade_prints: np.ndarray,
    cascade_ids: list[str],
    k: int,
) -> list[str]:
    """Find the top-K card IDs whose HSV fingerprints are closest to the query.

    Uses vectorised Bhattacharyya distance over the pre-computed fingerprint
    matrix.  Returns the K most-similar unique card IDs.
    """
    query_fp = _fingerprint_from_hsv(query_hsv).astype(np.float64)
    prints_f64 = cascade_prints.astype(np.float64)

    # Bhattacharyya distance:  1 - sum(sqrt(q * r))
    bc = np.sum(np.sqrt(query_fp[None, :] * prints_f64), axis=1)
    distances = 1.0 - bc

    # Get indices of K smallest distances.
    if k >= len(distances):
        top_indices = np.arange(len(distances))
    else:
        # Use argpartition for O(N) partial sort.
        top_indices = np.argpartition(distances, k)[:k]
        top_indices = top_indices[np.argsort(distances[top_indices])]

    # Deduplicate card IDs while preserving distance order.
    seen: set[str] = set()
    candidates: list[str] = []
    for idx in top_indices:
        cid = cascade_ids[idx]
        if cid not in seen:
            seen.add(cid)
            candidates.append(cid)
    return candidates


def _cascade_match(
    slot_signature: dict[str, Any],
    reference_index: list[dict[str, Any]],
    cascade_prints: np.ndarray,
    cascade_ids: list[str],
) -> dict[str, Any]:
    """Two-stage match: fast HSV pre-filter, then full comparison on top-K."""
    query_hsv = slot_signature.get("hsv")
    if query_hsv is None:
        return _best_match(slot_signature, reference_index)

    # Stage 1: find top-K candidates via HSV fingerprint distance.
    candidates = _find_top_k_candidates(query_hsv, cascade_prints, cascade_ids, CASCADE_TOP_K)

    # Build a candidate set for fast lookup.  Always include "empty".
    candidate_set = set(candidates)
    candidate_set.add("empty")

    # Stage 2: run full signature matching only on the shortlisted cards.
    best: dict[str, Any] | None = None
    for entry in reference_index:
        if entry["canonical_card_id"] not in candidate_set:
            continue
        best_variant_score = min(_score(slot_signature, variant) for variant in entry["variants"])
        if best is None or best_variant_score < best["score"]:
            best = {
                "card": dict(entry["card"], canonical_card_id=entry["canonical_card_id"]),
                "score": best_variant_score,
            }
    assert best is not None
    return best


def _extract_card_candidates(slot_image: Image.Image) -> list[Image.Image]:
    rgb = slot_image.convert("RGB")
    width, height = rgb.size
    inset_boxes = (
        (0.16, 0.05, 0.84, 0.95),
        (0.13, 0.03, 0.87, 0.97),
        (0.18, 0.07, 0.82, 0.93),
        (0.11, 0.02, 0.89, 0.98),
    )
    candidates: list[Image.Image] = []
    seen_shapes: set[tuple[int, int, int]] = set()
    for left, top, right, bottom in inset_boxes:
        inner = rgb.crop((int(width * left), int(height * top), int(width * right), int(height * bottom)))
        for candidate in (inner, _content_crop(inner)):
            candidate_rgb = candidate.convert("RGB")
            key = (candidate_rgb.width, candidate_rgb.height, hash(candidate_rgb.tobytes()[::97]))
            if candidate_rgb.width < 40 or candidate_rgb.height < 60 or key in seen_shapes:
                continue
            seen_shapes.add(key)
            candidates.append(candidate_rgb)
    return candidates or [rgb]


def _content_crop(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    arr = np.asarray(rgb, dtype=np.int16)
    height, width, _ = arr.shape
    corner_h = max(6, height // 14)
    corner_w = max(6, width // 14)
    corner_patch = np.concatenate(
        [
            arr[:corner_h, :corner_w].reshape(-1, 3),
            arr[:corner_h, -corner_w:].reshape(-1, 3),
            arr[-corner_h:, :corner_w].reshape(-1, 3),
            arr[-corner_h:, -corner_w:].reshape(-1, 3),
        ]
    )
    background = np.median(corner_patch, axis=0)
    distance = np.sqrt(np.sum((arr - background) ** 2, axis=2))
    luminance = arr.mean(axis=2)
    gradient_y, gradient_x = np.gradient(luminance.astype(np.float32))
    gradient = np.hypot(gradient_x, gradient_y)
    mask = (distance > 22.0) | (gradient > 9.0)
    coords = np.argwhere(mask)
    if coords.size == 0:
        return rgb
    y1, x1 = coords.min(axis=0)
    y2, x2 = coords.max(axis=0)
    pad_x = max(4, int(width * 0.02))
    pad_y = max(4, int(height * 0.02))
    x1 = max(0, int(x1) - pad_x)
    y1 = max(0, int(y1) - pad_y)
    x2 = min(width, int(x2) + pad_x)
    y2 = min(height, int(y2) + pad_y)
    if x2 - x1 < 40 or y2 - y1 < 60:
        return rgb
    return rgb.crop((x1, y1, x2, y2))


def _prepare_reference_variant(image: Image.Image, config: dict[str, Any]) -> Image.Image:
    trimmed = _trim_transparent_border(image.convert("RGBA"))
    transformed = _apply_card_transform(
        trimmed,
        {
            "visibility": config["visibility"],
            "tilt_degrees": config["tilt_degrees"],
            "render_effects": list(config["render_effects"]),
        },
        random.Random("reference-variant"),
    )
    return _prepare_match_image(transformed.convert("RGB"))


def _prepare_slot_image(image: Image.Image) -> Image.Image:
    """Prepare a query card crop for matching.

    Applies stronger normalisation than _prepare_match_image because
    real-world photos need white-balance correction and contrast
    stretching to match the clean reference domain.
    """
    from PIL import ImageEnhance

    rgb = image.convert("RGB")
    # Auto white balance via gray-world assumption.
    rgb = _auto_white_balance(rgb)
    # Boost contrast aggressively — phone photos are often washed out.
    rgb = ImageOps.autocontrast(rgb, cutoff=3)
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.3)
    rgb = ImageEnhance.Color(rgb).enhance(1.15)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.0, percent=110, threshold=3))
    rgb = ImageOps.fit(rgb, MATCH_SIZE, method=Image.Resampling.LANCZOS)
    return rgb.filter(ImageFilter.GaussianBlur(radius=0.12))


def _auto_white_balance(image: Image.Image) -> Image.Image:
    """Simple gray-world white balance correction."""
    import numpy as np
    arr = np.asarray(image, dtype=np.float32)
    # Scale each channel so its mean equals the overall mean.
    means = arr.mean(axis=(0, 1))
    overall = means.mean()
    scale = np.where(means > 0, overall / (means + 1e-6), 1.0)
    balanced = np.clip(arr * scale[None, None, :], 0, 255).astype(np.uint8)
    return Image.fromarray(balanced, mode="RGB")


def _trim_transparent_border(image: Image.Image) -> Image.Image:
    if "A" not in image.getbands():
        return image
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def _prepare_match_image(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    rgb = ImageOps.autocontrast(rgb)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2, percent=135, threshold=3))
    rgb = ImageOps.fit(rgb, MATCH_SIZE, method=Image.Resampling.LANCZOS)
    # Reduced blur — 0.25 was removing too much discriminative high-frequency
    # detail.  A radius of 0.12 preserves fine edges (holo patterns, small text,
    # edition stamps) while still suppressing capture noise.
    return rgb.filter(ImageFilter.GaussianBlur(radius=0.12))


def _signature(image: Image.Image) -> dict[str, Any]:
    gray_image = ImageOps.equalize(image.convert("L"))
    gray = np.asarray(gray_image, dtype=np.float32) / 255.0

    # Larger colour patch (28×39 vs old 18×25) in perceptually-uniform LAB
    # space.  Pokémon card palettes are highly distinctive across types and
    # rarities, so a richer colour feature pays off.
    lab_color = image.convert("RGB").resize((28, 39), resample=Image.Resampling.BILINEAR)
    lab = np.asarray(lab_color, dtype=np.float32) / 255.0

    # Also keep a compact HSV colour patch for complementary histogram matching.
    hsv_color = image.convert("HSV").resize((14, 20), resample=Image.Resampling.BILINEAR)
    hsv = np.asarray(hsv_color, dtype=np.float32) / 255.0

    valid = ((gray > 0.08) & (gray < 0.96)).astype(np.float32)
    color_valid = (
        np.asarray(
            Image.fromarray((valid * 255).astype(np.uint8)).resize((28, 39), resample=Image.Resampling.BILINEAR),
            dtype=np.float32,
        )
        / 255.0
    )
    edge = _edge_map(gray)

    # Proportion-based patch regions so the signature adapts to the 56×78
    # match size rather than depending on hard-coded pixel offsets.
    h, w = gray.shape
    art_r1, art_r2 = int(h * 0.10), int(h * 0.74)
    art_c1, art_c2 = int(w * 0.14), int(w * 0.86)
    edition_r1, edition_r2 = int(h * 0.36), int(h * 0.62)
    edition_c1, edition_c2 = int(w * 0.04), int(w * 0.32)
    bottom_r1, bottom_r2 = int(h * 0.77), h
    bottom_c1, bottom_c2 = 0, w

    return {
        "gray": gray,
        "color": lab,
        "hsv": hsv,
        "edge": edge,
        "valid": valid,
        "color_valid": color_valid,
        "art_patch": gray[art_r1:art_r2, art_c1:art_c2],
        "art_valid": valid[art_r1:art_r2, art_c1:art_c2],
        "edition_patch": gray[edition_r1:edition_r2, edition_c1:edition_c2],
        "edition_valid": valid[edition_r1:edition_r2, edition_c1:edition_c2],
        "bottom_patch": gray[bottom_r1:bottom_r2, bottom_c1:bottom_c2],
        "bottom_valid": valid[bottom_r1:bottom_r2, bottom_c1:bottom_c2],
    }


def _edge_map(gray: np.ndarray) -> np.ndarray:
    gradient_y, gradient_x = np.gradient(gray)
    edge = np.hypot(gradient_x, gradient_y)
    scale = max(1e-6, float(np.percentile(edge, 95)))
    return np.clip(edge / scale, 0.0, 1.0)


def _best_match(slot_signature: dict[str, Any], reference_index: list[dict[str, Any]]) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for entry in reference_index:
        best_variant_score = min(_score(slot_signature, variant) for variant in entry["variants"])
        if best is None or best_variant_score < best["score"]:
            best = {
                "card": dict(entry["card"], canonical_card_id=entry["canonical_card_id"]),
                "score": best_variant_score,
            }
    assert best is not None
    return best


def _score(left: dict[str, Any], right: dict[str, Any]) -> float:
    gray_mse = _masked_mse(left["gray"], right["gray"], left["valid"], right["valid"])
    edge_mse = _masked_mse(left["edge"], right["edge"], left["valid"], right["valid"])
    art_mse = _masked_mse(left["art_patch"], right["art_patch"], left["art_valid"], right["art_valid"])
    edition_mse = _masked_mse(
        left["edition_patch"],
        right["edition_patch"],
        left["edition_valid"],
        right["edition_valid"],
    )
    bottom_mse = _masked_mse(left["bottom_patch"], right["bottom_patch"], left["bottom_valid"], right["bottom_valid"])
    # LAB colour — perceptually uniform, higher weight because Pokémon card
    # palettes are strongly type- and rarity-specific.
    color_mae = _masked_mae(left["color"], right["color"], left["color_valid"], right["color_valid"])
    # HSV histogram distance — robust to small spatial shifts and lighting.
    hsv_dist = _hsv_histogram_distance(left["hsv"], right["hsv"])
    return (
        gray_mse * 0.06
        + edge_mse * 0.24
        + art_mse * 0.30
        + edition_mse * 0.12
        + bottom_mse * 0.06
        + color_mae * 0.14
        + hsv_dist * 0.08
    )


def _hsv_histogram_distance(left: np.ndarray, right: np.ndarray) -> float:
    """Bhattacharyya distance between 2D hue-saturation histograms.

    Ignores the value (brightness) channel so that lighting differences
    (glare, low-light, over-exposure) don't dominate.  Returns a score
    in [0, 1] where 0 = identical distributions.
    """
    h_bins, s_bins = 12, 8
    # Use only H and S channels (ignore V for lighting robustness).
    left_hs = left[:, :, :2].reshape(-1, 2)
    right_hs = right[:, :, :2].reshape(-1, 2)

    left_hist, _ = np.histogramdd(
        left_hs, bins=(h_bins, s_bins), range=((0, 1), (0, 1))
    )
    right_hist, _ = np.histogramdd(
        right_hs, bins=(h_bins, s_bins), range=((0, 1), (0, 1))
    )

    # Normalise to probability distributions.
    left_norm = left_hist.astype(np.float64) / max(1, left_hist.sum())
    right_norm = right_hist.astype(np.float64) / max(1, right_hist.sum())

    # Bhattacharyya coefficient, then distance.
    bc = float(np.sum(np.sqrt(left_norm * right_norm)))
    return 1.0 - bc  # 0 = identical, 1 = completely different


def _masked_mse(left: np.ndarray, right: np.ndarray, left_mask: np.ndarray, right_mask: np.ndarray) -> float:
    mask = (left_mask > 0.2) & (right_mask > 0.2)
    count = int(mask.sum())
    threshold = max(24, mask.size // 12)
    if count < threshold:
        return float(np.mean((left - right) ** 2))
    diff_sq = np.where(mask, (left - right) ** 2, 0.0)
    return float(diff_sq.sum() / count)


def _masked_mae(left: np.ndarray, right: np.ndarray, left_mask: np.ndarray, right_mask: np.ndarray) -> float:
    mask = (left_mask > 0.2) & (right_mask > 0.2)
    count = int(mask.sum())
    threshold = max(18, mask.shape[0] * mask.shape[1] // 10)
    if count < threshold:
        return float(np.mean(np.abs(left - right)))
    diff = np.abs(left - right)
    masked_diff = np.where(mask[..., None], diff, 0.0)
    return float(masked_diff.sum() / count)


# ---------------------------------------------------------------------------
# FAISS-powered full-corpus scanner (handles 20k+ cards at sub-second speed)
# ---------------------------------------------------------------------------

_FAISS_INDEX: Any = None
_FAISS_CARDS: list[dict[str, Any]] = []
_FAISS_FINGERPRINTS: Any = None
_CLIP_MODEL: Any = None
_CLIP_PROCESSOR: Any = None


def load_faiss_index(index_dir: str | Path) -> tuple[Any, list[dict[str, Any]], Any]:
    """Load a pre-built FAISS index + card metadata + fingerprint matrix.

    Returns (faiss_index, cards_list, fingerprints_matrix).
    Call once at startup; the result is cached globally.
    """
    global _FAISS_INDEX, _FAISS_CARDS, _FAISS_FINGERPRINTS
    import faiss

    index_path = Path(index_dir)
    _FAISS_INDEX = faiss.read_index(str(index_path / "combined.index"))
    _FAISS_CARDS = json.loads((index_path / "cards.json").read_text())
    _FAISS_FINGERPRINTS = np.load(index_path / "combined_fingerprints.npy")
    return _FAISS_INDEX, _FAISS_CARDS, _FAISS_FINGERPRINTS


def load_clip_index(index_dir: str | Path) -> None:
    """Load the CLIP FAISS index (replaces fingerprint index)."""
    global _FAISS_INDEX, _FAISS_CARDS
    import faiss
    index_path = Path(index_dir)
    _FAISS_INDEX = faiss.read_index(str(index_path / "clip.index"))
    _FAISS_CARDS = json.loads((index_path / "cards.json").read_text())


def _ensure_clip_loaded() -> None:
    """Lazy-load CLIP model on first use."""
    global _CLIP_MODEL, _CLIP_PROCESSOR
    if _CLIP_MODEL is not None:
        return
    from transformers import CLIPModel, CLIPProcessor
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _CLIP_MODEL = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        _CLIP_PROCESSOR = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    _CLIP_MODEL.eval()



_ADAPTER: Any = None

def load_clip_adapter(adapter_path: str | Path) -> None:
    """Load a trained CLIP adapter for inference."""
    global _ADAPTER
    import torch
    from scripts.train_clip_adapter import CLIPAdapter
    _ADAPTER = CLIPAdapter()
    _ADAPTER.load_state_dict(torch.load(str(adapter_path), weights_only=True))
    _ADAPTER.eval()

def _clip_embed_slots(images: list[Image.Image]) -> np.ndarray:
    """Compute CLIP embeddings for a batch of card-crop images."""
    import torch
    _ensure_clip_loaded()
    inputs = _CLIP_PROCESSOR(images=images, return_tensors="pt")
    with torch.no_grad():
        outputs = _CLIP_MODEL.get_image_features(**inputs)
        feats = outputs.pooler_output
        feats = feats / feats.norm(dim=-1, keepdim=True)
        if _ADAPTER is not None:
            feats = _ADAPTER(feats)
            feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy().astype(np.float32)


def _faiss_lookup(
    query_fingerprint: np.ndarray,
    k: int = 60,
) -> list[tuple[str, float]]:
    """Find top-K card IDs by cosine similarity via FAISS.

    Returns list of (card_id, similarity_score) sorted best-first.
    """
    import faiss

    if _FAISS_INDEX is None:
        return []

    query = query_fingerprint.astype(np.float32).reshape(1, -1)
    faiss.normalize_L2(query)
    distances, indices = _FAISS_INDEX.search(query, k)  # type: ignore[union-attr]

    results: list[tuple[str, float]] = []
    seen: set[str] = set()
    for idx, dist in zip(indices[0], distances[0]):
        if idx < 0 or idx >= len(_FAISS_CARDS):
            continue
        cid = _FAISS_CARDS[idx]["canonical_card_id"]
        if cid not in seen:
            seen.add(cid)
            # Convert inner-product similarity back to a distance-like score.
            # IP ∈ [-1, 1]; we map to [0, 1] where 0 = perfect match.
            score = 1.0 - max(0.0, float(dist))
            results.append((cid, score))
    return results


def faiss_scan_image(
    image_path: str | Path,
    *,
    index_dir: str | Path | None = None,
    reference_manifest: dict[str, Any] | None = None,
    manifest_root: str | Path | None = None,
) -> dict[str, Any]:
    """Identify cards in a binder-page image using the FAISS full-corpus index.

    This is the production path: FAISS pre-filter → full signature verification
    on the top candidates.  Handles 20k+ cards in under a second per slot.

    If *reference_manifest* is provided, falls back to building a traditional
    reference index for fine verification.  Otherwise uses only FAISS results.
    """
    path = Path(image_path)

    # Ensure FAISS index is loaded.
    if _FAISS_INDEX is None and index_dir is not None:
        load_faiss_index(index_dir)

    with Image.open(path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("RGB")

    # Detect layout bboxes.
    if reference_manifest is not None:
        ref_index = build_reference_index(reference_manifest, manifest_root=manifest_root)
    else:
        # Without a reference manifest, use a minimal index just for layout
        # detection.  Build it on the fly from the FAISS card store.
        ref_index = _build_minimal_faiss_index()

    inferred_layout_bboxes = tuple(_detect_layout_bboxes(image, reference_index=ref_index))
    slots: list[dict[str, Any]] = []
    predicted_total = 0.0

    # Pre-compute slot signatures and fingerprints for batched FAISS.
    slot_sigs: list[dict[str, Any]] = []
    slot_fps: list[np.ndarray] = []
    for bbox in inferred_layout_bboxes:
        slot_img = _crop_bbox(image, bbox)
        crop_candidates = _extract_card_candidates(slot_img)
        sig = _signature(_prepare_slot_image(crop_candidates[0]))
        slot_sigs.append(sig)
        query_fp = _fingerprint_from_hsv(sig["hsv"])
        edge = sig["edge"]
        col_edge = edge.mean(axis=0).astype(np.float32)
        row_edge = edge.mean(axis=1).astype(np.float32)
        edge_fp = np.concatenate([col_edge, row_edge]).astype(np.float32)
        combined_fp = np.concatenate([query_fp * 0.7, edge_fp * 0.3]).astype(np.float32)
        slot_fps.append(combined_fp)

    # Batch FAISS query: one call for all slots.
    all_candidates: list[list[tuple[str, float]]] = []
    if slot_fps and _FAISS_INDEX is not None:
        import faiss
        fp_matrix = np.stack(slot_fps, axis=0).astype(np.float32)
        faiss.normalize_L2(fp_matrix)
        distances, indices = _FAISS_INDEX.search(fp_matrix, 100)  # type: ignore[union-attr]
        for slot_idx in range(len(slot_fps)):
            cands: list[tuple[str, float]] = []
            seen: set[str] = set()
            for j in range(100):
                idx = indices[slot_idx, j]
                if idx < 0 or idx >= len(_FAISS_CARDS):
                    continue
                cid = _FAISS_CARDS[idx]["canonical_card_id"]
                if cid not in seen:
                    seen.add(cid)
                    cands.append((cid, 1.0 - max(0.0, float(distances[slot_idx, j]))))
            all_candidates.append(cands)
    else:
        all_candidates = [[] for _ in slot_sigs]

    for position, (bbox, slot_sig, faiss_candidates) in enumerate(
        zip(inferred_layout_bboxes, slot_sigs, all_candidates), start=1
    ):
        best: dict[str, Any] | None = None

        # Stage 2: fine verification on FAISS top candidates.
        if faiss_candidates:
            best = _verify_faiss_candidates(slot_sig, faiss_candidates, k=50, query_image=_crop_bbox(image, bbox))

        if best is None:
            # Fallback: traditional pipeline on the slot image.
            slot_image = _crop_bbox(image, bbox)
            best = _predict_slot_match(slot_image, ref_index)

        slot_id = f"slot-{position:02d}"
        predicted_card = dict(best["card"])
        predicted_total += float(predicted_card.get("fixture_price_usd", 0.0))
        slots.append({
            "slot_id": slot_id,
            "bbox_norm": [round(value, 4) for value in bbox],
            "card": predicted_card,
            "match_score": round(float(best["score"]), 6),
        })

    return {
        "page_id": path.stem,
        "slot_count": len(slots),
        "predicted_total_usd": round(predicted_total, 2),
        "slots": slots,
    }


# Cache of recently-loaded reference signatures for fine verification.
_VERIFY_CACHE: dict[str, list[dict[str, Any]]] = {}
_VERIFY_CACHE_MAX = 200  # keep at most this many cards' signatures cached


def _verify_faiss_candidates(
    query_sig: dict[str, Any],
    faiss_candidates: list[tuple[str, float]],
    k: int = 30,
    *,
    query_image: Image.Image | None = None,
) -> dict[str, Any] | None:
    """Fine verification using signature scoring on FAISS top candidates.

    The query crop is aggressively normalised (white balance, contrast
    stretch) to bridge the domain gap between phone photos and clean
    reference scans.  Reference variants include phone-photo simulations.
    """
    import random as _random

    ref_dir = Path("/data/home/calvin/pokemon-binder-scanner/reference_cards")
    best: dict[str, Any] | None = None

    # Use the normalised query signature if available, otherwise the raw one.
    if query_image is not None:
        norm_query = _prepare_slot_image(query_image)
        q_sig = _signature(norm_query)
    else:
        q_sig = query_sig

    for cid, faiss_score in faiss_candidates[:k]:
        img_path = ref_dir / f"{cid}.png"
        if not img_path.exists():
            continue

        # Check cache.
        if cid in _VERIFY_CACHE:
            variants = _VERIFY_CACHE[cid]
        else:
            try:
                with Image.open(img_path) as src:
                    source = ImageOps.exif_transpose(src).convert("RGBA")
            except Exception:
                continue

            rng = _random.Random(cid)
            configs: list[dict[str, Any]] = [
                {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []},
                {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["low_light", "desaturate"]},
                {"visibility": "soft_focus", "tilt_degrees": 2.0, "render_effects": []},
                {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": ["blue_cast"]},
            ]
            variants = [
                _signature(_prepare_reference_variant(source, cfg))
                for cfg in configs
            ]
            if len(_VERIFY_CACHE) >= _VERIFY_CACHE_MAX:
                oldest = next(iter(_VERIFY_CACHE))
                del _VERIFY_CACHE[oldest]
            _VERIFY_CACHE[cid] = variants

        best_variant_score = min(
            _score(q_sig, variant) for variant in variants
        )
        combined = best_variant_score * 0.7 + faiss_score * 0.3

        if best is None or combined < best["score"]:
            card_info = next(
                (c for c in _FAISS_CARDS if c["canonical_card_id"] == cid),
                None,
            )
            if card_info:
                best = {
                    "card": {
                        "canonical_card_id": cid,
                        "name": card_info.get("name", cid),
                        "fixture_price_usd": card_info.get("fixture_price_usd", 0.0),
                        "set_code": card_info.get("set_code", ""),
                        "rarity": card_info.get("rarity", ""),
                        "variant": card_info.get("variant", "unknown"),
                        "condition": card_info.get("condition", "near_mint"),
                    },
                    "score": combined,
                }
    return best
def _build_minimal_faiss_index() -> list[dict[str, Any]]:
    """Build a minimal reference index for layout detection when using FAISS.

    Only includes the first 10 cards from the FAISS store — enough for the
    layout detector to work, without loading thousands of reference images.
    """
    import random as _random

    index: list[dict[str, Any]] = []
    cards_to_use = _FAISS_CARDS[:10] if _FAISS_CARDS else []

    for card_meta in cards_to_use:
        cid = card_meta["canonical_card_id"]
        ref_path = Path("/data/home/calvin/pokemon-binder-scanner/reference_cards") / f"{cid}.png"
        if not ref_path.exists():
            continue
        try:
            with Image.open(ref_path) as source_img:
                source = ImageOps.exif_transpose(source_img).convert("RGBA")
        except Exception:
            continue
        rng = _random.Random(cid)
        config = {"visibility": "clear", "tilt_degrees": 0.0, "render_effects": []}
        variant = _signature(_prepare_reference_variant(source, config))
        index.append({
            "canonical_card_id": cid,
            "card": dict(card_meta),
            "variants": [variant],
        })
    # Add empty slot.
    empty_img = Image.new("RGBA", MATCH_SIZE, (12, 24, 40, 255))
    empty_sig = _signature(_prepare_match_image(empty_img.convert("RGB")))
    index.append({
        "canonical_card_id": "empty",
        "card": {"canonical_card_id": "empty", "name": "Empty slot",
                  "reference_image_path": "", "fixture_price_usd": 0.0},
        "variants": [empty_sig],
    })
    return index


def clip_scan_image(
    image_path: str | Path,
) -> dict[str, Any]:
    """Identify cards using CLIP embeddings + FAISS.

    This is the recommended path for real-world photos.  CLIP embeddings
    are robust to lighting, colour shifts, and photographic artifacts.
    """
    import faiss

    path = Path(image_path)
    _ensure_clip_loaded()

    with Image.open(path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("RGB")

    # Layout detection (same as before).
    ref_index = _build_minimal_faiss_index()
    bboxes = _detect_layout_bboxes(image, reference_index=ref_index)
    if not bboxes:
        bboxes = DEFAULT_LAYOUT_BBOXES

    # Extract all card crops and compute signatures for re-ranking.
    crops: list[Image.Image] = []
    slot_sigs: list[dict[str, Any]] = []
    for bbox in bboxes:
        slot_img = _crop_bbox(image, bbox)
        candidates = _extract_card_candidates(slot_img)
        crop = candidates[0]
        crops.append(crop)
        slot_sigs.append(_signature(_prepare_slot_image(crop)))

    # Batch CLIP embedding.
    embeddings = _clip_embed_slots(crops)

    # Batch FAISS search.
    distances, indices = _FAISS_INDEX.search(embeddings, 40)  # type: ignore[union-attr]

    slots: list[dict[str, Any]] = []
    predicted_total = 0.0

    for position, (bbox, dists, idxs, slot_sig, crop) in enumerate(
        zip(bboxes, distances, indices, slot_sigs, crops), start=1
    ):
        best_cid = None
        best_name = "Unknown"
        best_price = 0.0
        best_score = 1.0

        # Stage 1: collect top unique CLIP candidates.
        clip_candidates: list[tuple[str, float]] = []
        seen_ids: set[str] = set()
        for j in range(min(40, len(dists))):
            idx = idxs[j]
            if idx < 0 or idx >= len(_FAISS_CARDS):
                continue
            cid = _FAISS_CARDS[idx]["canonical_card_id"]
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            clip_score = 1.0 - max(0.0, float(dists[j]))
            clip_candidates.append((cid, clip_score))
            if len(clip_candidates) >= 15:
                break

        # Stage 2: fine verification on top CLIP candidates using
        # the full multi-patch scoring (much more discriminative than
        # CLIP embeddings alone, especially for near-identical cards).
        best_cid = None
        best_name = "Unknown"
        best_price = 0.0
        best_score = 1.0
        if clip_candidates:
            verified = _verify_faiss_candidates(
                slot_sig, clip_candidates, k=15, query_image=crop
            )
            if verified is not None:
                best_cid = verified["card"]["canonical_card_id"]
                best_name = verified["card"].get("name", best_cid)
                best_price = float(verified["card"].get("fixture_price_usd", 0.0))
                best_score = verified["score"]

        # Fallback to pure CLIP if verification fails.
        if best_cid is None:
            for cid, clip_score in clip_candidates:
                if clip_score < best_score:
                    best_score = clip_score
                    card = next((c for c in _FAISS_CARDS if c["canonical_card_id"] == cid), None)
                    if card:
                        best_cid = cid
                        best_name = card.get("name", cid)
                        best_price = float(card.get("fixture_price_usd", 0.0))

        slot_id = f"slot-{position:02d}"
        predicted_total += best_price
        slots.append({
            "slot_id": slot_id,
            "bbox_norm": [round(v, 4) for v in bbox],
            "card": {
                "canonical_card_id": best_cid or "unknown",
                "name": best_name,
                "fixture_price_usd": round(best_price, 2),
            },
            "match_score": round(best_score, 6),
        })

    return {
        "page_id": path.stem,
        "slot_count": len(slots),
        "predicted_total_usd": round(predicted_total, 2),
        "slots": slots,
    }



def _cards_match(expected_card: dict[str, Any] | None, predicted_card: dict[str, Any] | None) -> bool:
    expected_id = str(expected_card.get("canonical_card_id", "")) if expected_card else "empty"
    predicted_id = str(predicted_card.get("canonical_card_id", "")) if predicted_card else "empty"
    return expected_id == predicted_id
