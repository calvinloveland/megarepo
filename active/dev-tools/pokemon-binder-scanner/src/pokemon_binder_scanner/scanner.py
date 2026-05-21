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
LAYOUT_TEMPLATE_CONFIDENCE_THRESHOLD = 0.16
IRREGULAR_LAYOUT_NMS_IOU_THRESHOLD = 0.35
IRREGULAR_LAYOUT_MATCH_SCORE_THRESHOLD = 0.09
IRREGULAR_LAYOUT_THRESHOLD_PAIRS: tuple[tuple[int, int], ...] = (
    (50, 80),
    (70, 80),
    (90, 80),
    (90, 60),
    (110, 60),
)
IRREGULAR_COMPONENT_MIN_PIXELS = 5_000
IRREGULAR_COMPONENT_MAX_PIXELS = 120_000

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


@lru_cache(maxsize=1)
def _default_reference_index() -> list[dict[str, Any]]:
    manifest = load_manifest(DEFAULT_MANIFEST_PATH)
    return build_reference_index(manifest)


def build_reference_index(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    manifest_json = json.dumps(manifest, sort_keys=True)
    return _build_reference_index_cached(manifest_json)


@lru_cache(maxsize=4)
def _build_reference_index_cached(manifest_json: str) -> list[dict[str, Any]]:
    manifest_root = DEFAULT_MANIFEST_PATH.parent
    manifest = json.loads(manifest_json)
    catalog = build_reference_catalog(manifest)
    index: list[dict[str, Any]] = []
    for canonical_card_id, card in sorted(catalog.items()):
        reference_path = manifest_root / str(card["reference_image_path"])
        with Image.open(reference_path) as source_image:
            source = ImageOps.exif_transpose(source_image).convert("RGBA")
        variants = [_signature(_prepare_reference_variant(source, config)) for config in REFERENCE_VARIANT_CONFIGS]
        index.append(
            {
                "canonical_card_id": canonical_card_id,
                "card": dict(card),
                "variants": variants,
            }
        )
    return index


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
) -> dict[str, Any]:
    render_path = Path(render_dir)
    reference_index = build_reference_index(manifest)
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
            expected_card = expected_slot["card"]
            predicted_card = scanned_slot["card"]
            is_match = _cards_match(expected_card, predicted_card)
            if is_match:
                matched_cards += 1
                page_card_matches += 1
            else:
                page_mismatches.append(
                    f"{expected_slot['slot_id']}: expected {expected_card.get('canonical_card_id')} got {predicted_card.get('canonical_card_id')}"
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
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    gradient_y, gradient_x = np.gradient(gray)
    edge = np.hypot(gradient_x, gradient_y)
    edge_scale = max(1e-6, float(np.percentile(edge, 99)))
    edge = np.clip(edge / edge_scale, 0.0, 1.0)
    edge_integral = _integral_image(edge)
    scored_templates = sorted(
        (
            (_score_layout_template(edge_integral, layout_bboxes, gray.shape[1], gray.shape[0]), layout_bboxes)
            for _, layout_bboxes in AUTO_LAYOUT_TEMPLATES
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    if not scored_templates:
        return DEFAULT_LAYOUT_BBOXES
    best_template_score, best_template_bboxes = scored_templates[0]
    if best_template_score >= LAYOUT_TEMPLATE_CONFIDENCE_THRESHOLD:
        return best_template_bboxes

    irregular_bboxes = _detect_irregular_layout_bboxes(image, reference_index=reference_index or _default_reference_index())
    return irregular_bboxes if irregular_bboxes else best_template_bboxes


def _detect_irregular_layout_bboxes(
    image: Image.Image,
    *,
    reference_index: list[dict[str, Any]],
) -> tuple[tuple[float, float, float, float], ...]:
    hsv = np.asarray(image.convert("HSV"), dtype=np.uint8)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate_bboxes: list[tuple[float, tuple[float, float, float, float]]] = []

    # ---- 1. HSV-based candidates (existing approach) ----
    for saturation_threshold, value_threshold in IRREGULAR_LAYOUT_THRESHOLD_PAIRS:
        component_mask = (saturation > saturation_threshold) & (value > value_threshold)
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

    # ---- 4. NMS + match-score filter ----
    filtered_candidates = sorted(candidate_bboxes, key=lambda item: item[0], reverse=True)
    accepted_bboxes: list[tuple[float, float, float, float]] = []
    for _, bbox in filtered_candidates:
        if any(_bbox_iou(bbox, existing_bbox) > IRREGULAR_LAYOUT_NMS_IOU_THRESHOLD for existing_bbox in accepted_bboxes):
            continue
        best_match = _predict_slot_match(_crop_bbox(image, bbox), reference_index)
        if best_match["score"] <= IRREGULAR_LAYOUT_MATCH_SCORE_THRESHOLD:
            accepted_bboxes.append(bbox)

    return tuple(_sort_bboxes_reading_order(accepted_bboxes)) if len(accepted_bboxes) >= 3 else ()


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
    best_match: dict[str, Any] | None = None
    for card_crop in _extract_card_candidates(slot_image):
        slot_signature = _signature(_prepare_slot_image(card_crop))
        candidate_match = _best_match(slot_signature, reference_index)
        if best_match is None or candidate_match["score"] < best_match["score"]:
            best_match = candidate_match
    assert best_match is not None
    return best_match


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
    return _prepare_match_image(image.convert("RGB"))


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
    return rgb.filter(ImageFilter.GaussianBlur(radius=0.25))


def _signature(image: Image.Image) -> dict[str, Any]:
    gray_image = ImageOps.equalize(image.convert("L"))
    gray = np.asarray(gray_image, dtype=np.float32) / 255.0
    color = np.asarray(image.resize((18, 25), resample=Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    valid = ((gray > 0.08) & (gray < 0.96)).astype(np.float32)
    color_valid = (
        np.asarray(
            Image.fromarray((valid * 255).astype(np.uint8)).resize((18, 25), resample=Image.Resampling.BILINEAR),
            dtype=np.float32,
        )
        / 255.0
    )
    edge = _edge_map(gray)
    return {
        "gray": gray,
        "color": color,
        "edge": edge,
        "valid": valid,
        "color_valid": color_valid,
        "art_patch": gray[8:58, 8:48],
        "art_valid": valid[8:58, 8:48],
        "edition_patch": gray[28:48, 2:18],
        "edition_valid": valid[28:48, 2:18],
        "bottom_patch": gray[60:78, 0:56],
        "bottom_valid": valid[60:78, 0:56],
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
    color_mae = _masked_mae(left["color"], right["color"], left["color_valid"], right["color_valid"])
    return gray_mse * 0.20 + edge_mse * 0.28 + art_mse * 0.24 + edition_mse * 0.14 + bottom_mse * 0.08 + color_mae * 0.06


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


def _cards_match(expected_card: dict[str, Any], predicted_card: dict[str, Any]) -> bool:
    return str(expected_card.get("canonical_card_id", "")) == str(predicted_card.get("canonical_card_id", ""))
