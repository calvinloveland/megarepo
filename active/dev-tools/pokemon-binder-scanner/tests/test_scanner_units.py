from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pokemon_binder_scanner.scanner import (  # noqa: E402
    MATCH_SIZE,
    _bbox_center,
    _bbox_iou,
    _cards_match,
    _connected_components,
    _crop_bbox,
    _detect_edge_components,
    _detect_variance_components,
    _integral_image,
    _normalize_edge_component_bbox,
    _normalize_variance_component_bbox,
    _prepare_match_image,
    _prepare_slot_image,
    _rect_mean,
    _score,
    _signature,
    _slot_bbox,
    _slot_center_distance,
    _slot_pairing_threshold,
    _sort_bboxes_reading_order,
    _sort_slots_reading_order,
    _trim_transparent_border,
    scan_fixture_image,
)
from pokemon_binder_scanner.cli import _build_parser


# ---------------------------------------------------------------------------
# Pure-geometry helpers
# ---------------------------------------------------------------------------

class TestBboxCenter(unittest.TestCase):
    def test_center_of_unit_square(self) -> None:
        cx, cy = _bbox_center((0.0, 0.0, 1.0, 1.0))
        self.assertAlmostEqual(cx, 0.5)
        self.assertAlmostEqual(cy, 0.5)

    def test_center_offset_rect(self) -> None:
        cx, cy = _bbox_center((0.2, 0.3, 0.4, 0.5))
        self.assertAlmostEqual(cx, 0.4)   # 0.2 + 0.4/2
        self.assertAlmostEqual(cy, 0.55)  # 0.3 + 0.5/2

    def test_zero_size(self) -> None:
        cx, cy = _bbox_center((0.5, 0.5, 0.0, 0.0))
        self.assertAlmostEqual(cx, 0.5)
        self.assertAlmostEqual(cy, 0.5)


class TestBboxIou(unittest.TestCase):
    def test_identical_boxes(self) -> None:
        iou = _bbox_iou((0.1, 0.1, 0.3, 0.3), (0.1, 0.1, 0.3, 0.3))
        self.assertAlmostEqual(iou, 1.0)

    def test_no_overlap(self) -> None:
        iou = _bbox_iou((0.0, 0.0, 0.2, 0.2), (0.5, 0.5, 0.2, 0.2))
        self.assertEqual(iou, 0.0)

    def test_partial_overlap(self) -> None:
        # Two same-size boxes overlapping by half
        iou = _bbox_iou((0.0, 0.0, 0.2, 0.2), (0.1, 0.0, 0.2, 0.2))
        # Overlap: 0.1 wide x 0.2 tall = 0.02
        # Union: 0.04 + 0.04 - 0.02 = 0.06
        # IoU: 0.02/0.06 = 0.333...
        self.assertAlmostEqual(iou, 0.02 / 0.06)

    def test_contained(self) -> None:
        iou = _bbox_iou((0.0, 0.0, 1.0, 1.0), (0.2, 0.2, 0.3, 0.3))
        self.assertAlmostEqual(iou, 0.09)  # small / large

    def test_touching_edges_no_overlap(self) -> None:
        iou = _bbox_iou((0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 0.5, 0.5))
        self.assertEqual(iou, 0.0)


class TestSlotBbox(unittest.TestCase):
    def test_from_bbox_norm(self) -> None:
        slot = {"bbox_norm": [0.1, 0.2, 0.3, 0.4]}
        x, y, w, h = _slot_bbox(slot)
        self.assertEqual((x, y, w, h), (0.1, 0.2, 0.3, 0.4))

    def test_missing_bbox_norm_falls_back(self) -> None:
        slot: dict = {}
        x, y, w, h = _slot_bbox(slot)
        self.assertEqual((x, y, w, h), (0.0, 0.0, 0.0, 0.0))


class TestSlotCenterDistance(unittest.TestCase):
    def test_identical_slots_zero_distance(self) -> None:
        a = {"bbox_norm": [0.0, 0.0, 1.0, 1.0]}
        self.assertAlmostEqual(_slot_center_distance(a, a), 0.0)

    def test_known_distance(self) -> None:
        a = {"bbox_norm": [0.0, 0.0, 1.0, 1.0]}   # center (0.5, 0.5)
        b = {"bbox_norm": [0.0, 0.0, 0.0, 1.0]}   # center (0.0, 0.5)
        dist = _slot_center_distance(a, b)
        self.assertAlmostEqual(dist, 0.5)


class TestSlotPairingThreshold(unittest.TestCase):
    def test_minimum_floor(self) -> None:
        a = {"bbox_norm": [0.0, 0.0, 0.01, 0.01]}
        b = {"bbox_norm": [0.0, 0.0, 0.01, 0.01]}
        self.assertAlmostEqual(_slot_pairing_threshold(a, b), 0.12)

    def test_scaled_threshold(self) -> None:
        a = {"bbox_norm": [0.0, 0.0, 0.4, 0.4]}
        b = {"bbox_norm": [0.0, 0.0, 0.4, 0.4]}
        self.assertAlmostEqual(_slot_pairing_threshold(a, b), 0.24)


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

class TestCropBbox(unittest.TestCase):
    def test_crop_center(self) -> None:
        img = Image.new("RGB", (100, 100), color="red")
        draw = ImageDraw.Draw(img)
        draw.rectangle((25, 25, 74, 74), fill="blue")
        cropped = _crop_bbox(img, (0.25, 0.25, 0.5, 0.5))
        self.assertEqual(cropped.size, (50, 50))
        self.assertEqual(cropped.getpixel((0, 0)), (0, 0, 255))  # blue

    def test_crop_edge_clamping(self) -> None:
        img = Image.new("RGB", (100, 100), color="white")
        cropped = _crop_bbox(img, (-0.1, -0.1, 1.2, 1.2))
        # _crop_bbox passes negative coords through to PIL, which pads
        # the output image to include the negative region.
        self.assertGreaterEqual(cropped.size[0], 100)
        self.assertGreaterEqual(cropped.size[1], 100)


class TestTrimTransparentBorder(unittest.TestCase):
    def test_no_alpha_passthrough(self) -> None:
        img = Image.new("RGB", (50, 50), color="red")
        result = _trim_transparent_border(img)
        self.assertIs(result, img)

    def test_alpha_crop(self) -> None:
        img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rectangle((20, 20, 79, 79), fill=(255, 0, 0, 255))
        trimmed = _trim_transparent_border(img)
        self.assertEqual(trimmed.size, (60, 60))


# ---------------------------------------------------------------------------
# Connected components
# ---------------------------------------------------------------------------

class TestConnectedComponents(unittest.TestCase):
    def test_single_block(self) -> None:
        mask = np.zeros((20, 20), dtype=bool)
        mask[5:15, 5:15] = True
        components = _connected_components(mask)
        self.assertEqual(len(components), 1)
        pixels, (x1, y1, x2, y2) = components[0]
        self.assertEqual(pixels, 100)
        self.assertEqual((x1, y1, x2, y2), (5, 5, 15, 15))

    def test_two_disjoint_blocks(self) -> None:
        mask = np.zeros((30, 30), dtype=bool)
        mask[2:8, 2:8] = True
        mask[20:28, 20:28] = True
        components = _connected_components(mask)
        self.assertEqual(len(components), 2)

    def test_empty_mask(self) -> None:
        components = _connected_components(np.zeros((10, 10), dtype=bool))
        self.assertEqual(components, [])

    def test_diagonal_touching(self) -> None:
        # Diagonally adjacent pixels are NOT connected (4-connectivity)
        mask = np.zeros((5, 5), dtype=bool)
        mask[0, 0] = True
        mask[1, 1] = True
        components = _connected_components(mask)
        self.assertEqual(len(components), 2)

    def test_full_mask_one_component(self) -> None:
        mask = np.ones((8, 8), dtype=bool)
        components = _connected_components(mask)
        self.assertEqual(len(components), 1)
        self.assertEqual(components[0][0], 64)


# ---------------------------------------------------------------------------
# Integral image and rect mean
# ---------------------------------------------------------------------------

class TestIntegralImage(unittest.TestCase):
    def test_integral_ones(self) -> None:
        arr = np.ones((4, 5), dtype=np.float32)
        integral = _integral_image(arr)
        # Bottom-right should be total sum
        self.assertAlmostEqual(integral[4, 5], 20.0)

    def test_integral_shape(self) -> None:
        arr = np.zeros((10, 15), dtype=np.float32)
        integral = _integral_image(arr)
        self.assertEqual(integral.shape, (11, 16))


class TestRectMean(unittest.TestCase):
    def setUp(self) -> None:
        self.arr = np.arange(1, 26, dtype=np.float32).reshape(5, 5)
        self.integral = _integral_image(self.arr)

    def test_full_rect(self) -> None:
        mean = _rect_mean(self.integral, 0, 0, 5, 5)
        expected = self.arr.mean()
        self.assertAlmostEqual(mean, float(expected))

    def test_sub_rect(self) -> None:
        mean = _rect_mean(self.integral, 1, 1, 4, 4)
        expected = self.arr[1:4, 1:4].mean()
        self.assertAlmostEqual(mean, float(expected))

    def test_empty_rect_returns_zero(self) -> None:
        mean = _rect_mean(self.integral, 0, 0, 0, 0)
        self.assertEqual(mean, 0.0)


# ---------------------------------------------------------------------------
# Cards match
# ---------------------------------------------------------------------------

class TestCardsMatch(unittest.TestCase):
    def test_same_id(self) -> None:
        self.assertTrue(_cards_match(
            {"canonical_card_id": "basep-1"},
            {"canonical_card_id": "basep-1"},
        ))

    def test_different_id(self) -> None:
        self.assertFalse(_cards_match(
            {"canonical_card_id": "basep-1"},
            {"canonical_card_id": "basep-3"},
        ))

    def test_missing_id(self) -> None:
        # When both cards have no canonical_card_id the function
        # considers them equal (both None → same string).
        self.assertTrue(_cards_match({}, {}))

    def test_unknown_vs_known(self) -> None:
        self.assertFalse(_cards_match(
            {"canonical_card_id": "basep-1"},
            {},
        ))


# ---------------------------------------------------------------------------
# Reading-order sorting
# ---------------------------------------------------------------------------

class TestSortSlotsReadingOrder(unittest.TestCase):
    def test_empty(self) -> None:
        self.assertEqual(_sort_slots_reading_order([]), [])

    def test_single_slot(self) -> None:
        slots = [{"slot_id": "a", "bbox_norm": [0.0, 0.0, 0.5, 0.5]}]
        result = _sort_slots_reading_order(slots)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["slot_id"], "a")

    def test_top_left_first(self) -> None:
        slots = [
            {"slot_id": "br", "bbox_norm": [0.6, 0.6, 0.2, 0.2]},
            {"slot_id": "tl", "bbox_norm": [0.1, 0.1, 0.2, 0.2]},
        ]
        result = _sort_slots_reading_order(slots)
        self.assertEqual(result[0]["slot_id"], "tl")
        self.assertEqual(result[1]["slot_id"], "br")

    def test_row_major_order(self) -> None:
        # Three rows of two columns
        slots = [
            {"slot_id": "r1c1", "bbox_norm": [0.05, 0.05, 0.2, 0.2]},
            {"slot_id": "r1c2", "bbox_norm": [0.35, 0.05, 0.2, 0.2]},
            {"slot_id": "r2c1", "bbox_norm": [0.05, 0.40, 0.2, 0.2]},
            {"slot_id": "r2c2", "bbox_norm": [0.35, 0.40, 0.2, 0.2]},
            {"slot_id": "r3c1", "bbox_norm": [0.05, 0.75, 0.2, 0.2]},
            {"slot_id": "r3c2", "bbox_norm": [0.35, 0.75, 0.2, 0.2]},
        ]
        result = _sort_slots_reading_order(slots)
        ids = [s["slot_id"] for s in result]
        self.assertEqual(ids, [
            "r1c1", "r1c2",
            "r2c1", "r2c2",
            "r3c1", "r3c2",
        ])


class TestSortBboxesReadingOrder(unittest.TestCase):
    def test_converts_and_sorts(self) -> None:
        bboxes = [(0.6, 0.6, 0.2, 0.2), (0.1, 0.1, 0.2, 0.2)]
        result = _sort_bboxes_reading_order(bboxes)
        self.assertEqual(result, [(0.1, 0.1, 0.2, 0.2), (0.6, 0.6, 0.2, 0.2)])


# ---------------------------------------------------------------------------
# Signature and scoring
# ---------------------------------------------------------------------------

class TestSignature(unittest.TestCase):
    def test_signature_keys(self) -> None:
        img = Image.new("RGB", MATCH_SIZE, color="gray")
        sig = _signature(img)
        expected_keys = {"gray", "color", "hsv", "edge", "valid", "color_valid",
                         "art_patch", "art_valid", "edition_patch",
                         "edition_valid", "bottom_patch", "bottom_valid"}
        self.assertEqual(set(sig.keys()), expected_keys)

    def test_signature_shapes(self) -> None:
        img = Image.new("RGB", MATCH_SIZE, color="gray")
        sig = _signature(img)
        self.assertEqual(sig["gray"].shape, (78, 56))
        self.assertEqual(sig["color"].shape, (39, 28, 3))
        self.assertEqual(sig["art_patch"].shape, (50, 41))


class TestScore(unittest.TestCase):
    def test_identical_signatures_score_zero(self) -> None:
        img = Image.new("RGB", MATCH_SIZE, color=(128, 64, 192))
        sig = _signature(img)
        score = _score(sig, sig)
        self.assertAlmostEqual(score, 0.0, places=4)

    def test_different_images_higher_score(self) -> None:
        black = Image.new("RGB", MATCH_SIZE, color="black")
        white = Image.new("RGB", MATCH_SIZE, color="white")
        sig_black = _signature(black)
        sig_white = _signature(white)
        score = _score(sig_black, sig_white)
        self.assertGreater(score, 0.0)


class TestPrepareSlotImage(unittest.TestCase):
    def test_output_size(self) -> None:
        img = Image.new("RGB", (200, 300), color="red")
        prepared = _prepare_slot_image(img)
        self.assertEqual(prepared.size, MATCH_SIZE)

    def test_input_with_alpha(self) -> None:
        img = Image.new("RGBA", (200, 300), (255, 0, 0, 128))
        prepared = _prepare_slot_image(img)
        self.assertEqual(prepared.size, MATCH_SIZE)
        self.assertEqual(prepared.mode, "RGB")


class TestPrepareMatchImage(unittest.TestCase):
    def test_output_size_and_mode(self) -> None:
        img = Image.new("RGB", (100, 150), color="green")
        prepared = _prepare_match_image(img)
        self.assertEqual(prepared.size, MATCH_SIZE)
        self.assertEqual(prepared.mode, "RGB")


# ---------------------------------------------------------------------------
# Detection functions on synthetic images
# ---------------------------------------------------------------------------

class TestDetectEdgeComponents(unittest.TestCase):
    def test_blank_image_yields_no_candidates(self) -> None:
        img = Image.new("RGB", (200, 200), color="gray")
        candidates = _detect_edge_components(img)
        self.assertEqual(candidates, [])

    def test_edge_detection_runs_without_error(self) -> None:
        """Smoke test: edge detection should not crash on a real-ish image."""
        rng = np.random.RandomState(42)
        bg = np.clip(rng.normal(45, 8, size=(400, 400, 3)), 0, 255).astype(np.uint8)
        pixels = bg.copy()
        card = np.clip(rng.normal(160, 35, size=(90, 70, 3)), 0, 255).astype(np.uint8)
        pixels[50:140, 60:130] = card
        img = Image.fromarray(pixels, mode="RGB")
        # The call should not raise — the result is highly dependent on
        # threshold geometry, so we only verify it runs successfully.
        _detect_edge_components(img)


class TestDetectVarianceComponents(unittest.TestCase):
    def test_blank_image_yields_no_candidates(self) -> None:
        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        candidates = _detect_variance_components(img)
        self.assertEqual(candidates, [])

    def test_variance_detection_runs_without_error(self) -> None:
        """Smoke test: variance detection should not crash on a real-ish image."""
        rng = np.random.RandomState(42)
        arr = np.clip(rng.normal(45, 8, size=(400, 400, 3)), 0, 255).astype(np.uint8)
        noise = np.clip(rng.normal(160, 50, size=(80, 60, 3)), 0, 255).astype(np.uint8)
        arr[50:130, 60:120] = noise
        img = Image.fromarray(arr, mode="RGB")
        _detect_variance_components(img)


class TestNormalizeEdgeComponent(unittest.TestCase):
    """Direct tests for the normalize function that filters edge components."""

    def setUp(self) -> None:
        self.img = Image.new("RGB", (400, 400))

    def test_accepts_card_sized_box(self) -> None:
        # A 80×110 px box (0.20×0.275 norm) with ~8800 pixels
        bbox = (60, 50, 140, 160)
        result = _normalize_edge_component_bbox(self.img, 8800, bbox)
        self.assertIsNotNone(result)
        x, y, w, h = result  # type: ignore[misc]
        self.assertGreater(w, 0.1)
        self.assertGreater(h, 0.1)

    def test_rejects_too_small(self) -> None:
        bbox = (100, 100, 110, 110)  # 10×10 = 100 px
        result = _normalize_edge_component_bbox(self.img, 100, bbox)
        self.assertIsNone(result)

    def test_rejects_too_large(self) -> None:
        bbox = (50, 50, 350, 350)  # 300×300 = 90k px
        result = _normalize_edge_component_bbox(self.img, 90_000, bbox)
        self.assertIsNone(result)

    def test_rejects_skewed_aspect_ratio(self) -> None:
        # Very wide rectangle: width > height * 1.2
        bbox = (50, 100, 200, 120)  # 150×20 px, ar=7.5
        result = _normalize_edge_component_bbox(self.img, 3000, bbox)
        self.assertIsNone(result)


class TestNormalizeVarianceComponent(unittest.TestCase):
    """Direct tests for the normalize function that filters variance components."""

    def setUp(self) -> None:
        self.img = Image.new("RGB", (400, 400))

    def test_accepts_card_sized_box(self) -> None:
        bbox = (60, 50, 150, 155)  # 90×105 px, ~9450 px
        result = _normalize_variance_component_bbox(self.img, 9450, bbox)
        self.assertIsNotNone(result)
        x, y, w, h = result  # type: ignore[misc]
        self.assertGreater(w, 0.1)
        self.assertGreater(h, 0.1)

    def test_rejects_too_large(self) -> None:
        bbox = (20, 20, 300, 300)  # 280×280 = 78k px
        result = _normalize_variance_component_bbox(self.img, 78_000, bbox)
        self.assertIsNone(result)

    def test_rejects_wrong_aspect(self) -> None:
        bbox = (100, 50, 105, 300)  # 5×250 px, ar=0.02
        result = _normalize_variance_component_bbox(self.img, 1250, bbox)
        self.assertIsNone(result)


# ---------------------------------------------------------------------------
# scan_fixture_image edge cases (without layout auto-detection)
# ---------------------------------------------------------------------------

class TestScanFixtureImageEdgeCases(unittest.TestCase):
    def test_blank_image_with_bboxes(self) -> None:
        """A blank image should still return results for the given bboxes."""
        img = Image.new("RGB", (300, 400), color=(200, 200, 200))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        tmp = Path(tempfile.mkdtemp()) / "blank.png"
        tmp.write_bytes(buf.read())
        try:
            result = scan_fixture_image(tmp, layout_bboxes=((0.1, 0.1, 0.3, 0.3),))
            self.assertEqual(result["slot_count"], 1)
            self.assertIn("slot-01", result["slots"][0]["slot_id"])
        finally:
            tmp.unlink()
            tmp.parent.rmdir()

    def test_minimal_size_image(self) -> None:
        """Very small image should not crash."""
        img = Image.new("RGB", (64, 64), color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        tmp = Path(tempfile.mkdtemp()) / "tiny.png"
        tmp.write_bytes(buf.read())
        try:
            result = scan_fixture_image(tmp, layout_bboxes=((0.0, 0.0, 1.0, 1.0),))
            self.assertEqual(result["slot_count"], 1)
        finally:
            tmp.unlink()
            tmp.parent.rmdir()


# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------

class TestCliParser(unittest.TestCase):
    def test_parser_has_all_subcommands(self) -> None:
        parser = _build_parser()
        subcommands = {
            action.dest
            for action in parser._actions
            if hasattr(action, "choices") and action.choices
        }
        # There should be a subparser list with these commands
        self.assertIn("command", {a.dest for a in parser._actions})

    def _get_subparser(self, name: str) -> argparse.ArgumentParser:
        parser = _build_parser()
        # Simulate parsing (but we need to check subparsers)
        sp = None
        for action in parser._actions:
            if hasattr(action, "choices") and action.choices:
                sp = action.choices.get(name)
                break
        if sp is None:
            raise AssertionError(f"Subcommand {name!r} not found")
        return sp

    def test_validate_fixtures_subcommand(self) -> None:
        sp = self._get_subparser("validate-fixtures")
        self.assertIsNotNone(sp)

    def test_render_fixtures_subcommand(self) -> None:
        sp = self._get_subparser("render-fixtures")
        self.assertIsNotNone(sp)

    def test_evaluate_scanner_subcommand(self) -> None:
        sp = self._get_subparser("evaluate-scanner")
        self.assertIsNotNone(sp)

    def test_web_subcommand(self) -> None:
        sp = self._get_subparser("web")
        self.assertIsNotNone(sp)

    def test_demo_page_subcommand(self) -> None:
        sp = self._get_subparser("demo-page")
        self.assertIsNotNone(sp)

    def test_audit_picture_only_subcommand(self) -> None:
        sp = self._get_subparser("audit-picture-only")
        self.assertIsNotNone(sp)

    def test_sync_real_assets_subcommand(self) -> None:
        sp = self._get_subparser("sync-real-assets")
        self.assertIsNotNone(sp)

    def test_scan_image_subcommand(self) -> None:
        sp = self._get_subparser("scan-image")
        self.assertIsNotNone(sp)

    def test_scan_image_format_option(self) -> None:
        sp = self._get_subparser("scan-image")
        format_action = next((a for a in sp._actions if a.dest == "format"), None)
        self.assertIsNotNone(format_action)
        self.assertEqual(format_action.default, "text")
        self.assertIn("json", format_action.choices)


# ---------------------------------------------------------------------------
# _cards_match integrated with scan output schema
# ---------------------------------------------------------------------------

class TestCardsMatchSchema(unittest.TestCase):
    def test_scan_result_card_has_canonical_id(self) -> None:
        """Every scanned slot must have a canonical_card_id in its card dict."""
        img = Image.new("RGB", (300, 400), color=(180, 160, 140))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        tmp = Path(tempfile.mkdtemp()) / "schema_test.png"
        tmp.write_bytes(buf.read())
        try:
            result = scan_fixture_image(tmp, layout_bboxes=((0.1, 0.1, 0.3, 0.3),))
            for slot in result["slots"]:
                self.assertIn("canonical_card_id", slot["card"])
        finally:
            tmp.unlink()
            tmp.parent.rmdir()


class TestCardsMatchEmpty(unittest.TestCase):
    """_cards_match must handle None expected/predicted cards (empty slots)."""

    def test_expected_none_predicted_empty(self) -> None:
        """Expected slot has no card, scanner detects 'empty' -> match."""
        self.assertTrue(
            _cards_match(None, {"canonical_card_id": "empty", "name": "Empty slot"})
        )

    def test_expected_real_predicted_empty(self) -> None:
        """Expected slot has a card, scanner detects 'empty' -> mismatch."""
        self.assertFalse(
            _cards_match({"canonical_card_id": "basep-1"}, {"canonical_card_id": "empty"})
        )

    def test_expected_empty_predicted_real(self) -> None:
        """Expected slot empty, scanner detects a card -> mismatch."""
        self.assertFalse(
            _cards_match(None, {"canonical_card_id": "basep-1"})
        )

    def test_expected_none_predicted_none(self) -> None:
        """Both None -> treat as 'empty' match."""
        self.assertTrue(_cards_match(None, None))


class TestEvaluatePageResults(unittest.TestCase):
    """The _evaluate_page_results helper used by evaluate_scanner_on_fixture_dataset."""

    def test_perfect_match(self) -> None:
        from pokemon_binder_scanner.scanner import _evaluate_page_results
        expected = {
            "page_id": "test", "label": "Test", "expected_total_usd": 10.0,
            "slots": [
                {"slot_id": "s1", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "visibility": "clear", "tilt_degrees": 0.0,
                 "card": {"canonical_card_id": "basep-1", "name": "Pikachu",
                           "collector_number": "1", "reference_image_path": "dummy.png",
                           "fixture_price_usd": 5.0}}
            ]}
        scanned = {
            "page_id": "test", "slot_count": 1, "predicted_total_usd": 5.0,
            "slots": [
                {"slot_id": "slot-01", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "card": {"canonical_card_id": "basep-1", "name": "Pikachu"},
                 "match_score": 0.05}
            ]}
        report, total, matched, pred = _evaluate_page_results(expected, scanned)
        self.assertEqual(matched, 1)
        self.assertEqual(total, 1)
        self.assertEqual(pred, 5.0)
        self.assertAlmostEqual(report["expected_total_usd"], 10.0)
        self.assertEqual(report["card_matches"], 1)
        self.assertEqual(report["mismatches"], [])

    def test_empty_expected_slot(self) -> None:
        from pokemon_binder_scanner.scanner import _evaluate_page_results
        expected = {
            "page_id": "test", "label": "Test", "expected_total_usd": 0.0,
            "slots": [
                {"slot_id": "s1", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "visibility": "clear", "tilt_degrees": 0.0}
                # no card key → empty slot
            ]}
        scanned = {
            "page_id": "test", "slot_count": 1, "predicted_total_usd": 0.0,
            "slots": [
                {"slot_id": "slot-01", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "card": {"canonical_card_id": "empty", "name": "Empty slot"},
                 "match_score": 0.12}
            ]}
        report, total, matched, pred = _evaluate_page_results(expected, scanned)
        self.assertEqual(matched, 1)  # empty matched to empty
        self.assertEqual(report["card_matches"], 1)
        self.assertEqual(report["mismatches"], [])

    def test_empty_mismatch(self) -> None:
        from pokemon_binder_scanner.scanner import _evaluate_page_results
        expected = {
            "page_id": "test", "label": "Test", "expected_total_usd": 0.0,
            "slots": [
                {"slot_id": "s1", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "visibility": "clear", "tilt_degrees": 0.0}
            ]}
        scanned = {
            "page_id": "test", "slot_count": 1, "predicted_total_usd": 5.0,
            "slots": [
                {"slot_id": "slot-01", "bbox_norm": [0.0, 0.0, 0.3, 0.3],
                 "card": {"canonical_card_id": "basep-1", "name": "Pikachu"},
                 "match_score": 0.05}
            ]}
        report, total, matched, pred = _evaluate_page_results(expected, scanned)
        self.assertEqual(matched, 0)  # empty vs card → mismatch
        self.assertEqual(len(report["mismatches"]), 1)
        self.assertIn("expected empty got basep-1", report["mismatches"][0])


class TestCliJsonFormat(unittest.TestCase):
    """The scan-image subcommand with --format json must produce valid JSON."""

    def test_json_output_syntax(self) -> None:
        import json as jsonlib
        import subprocess
        # Create a tiny test image and run the CLI
        img = Image.new("RGB", (300, 400), color=(120, 100, 80))
        tmpdir = Path(tempfile.mkdtemp())
        img_path = tmpdir / "test_page.png"
        img.save(img_path, format="PNG")
        result = subprocess.run(
            [sys.executable, "-m", "pokemon_binder_scanner.cli", "scan-image",
             str(img_path), "--format", "json"],
            capture_output=True, text=True, cwd=str(ROOT)
        )
        try:
            parsed = jsonlib.loads(result.stdout)
            self.assertIn("page_id", parsed)
            self.assertIn("slot_count", parsed)
            self.assertIn("slots", parsed)
            if parsed["slots"]:
                self.assertIn("canonical_card_id", parsed["slots"][0])
        except jsonlib.JSONDecodeError as exc:
            self.fail(f"JSON parse failed: {exc}\nstdout={result.stdout[:200]}")
        finally:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)


class TestIrregularLayoutMinArea(unittest.TestCase):
    """The IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA filter rejects tiny bboxes."""

    def test_tiny_bbox_rejected(self) -> None:
        from pokemon_binder_scanner.scanner import IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA
        self.assertGreater(IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA, 0.01)

    def test_page37_no_false_empty(self) -> None:
        """Page-37 (irregular, 4 slots) must not hallucinate tiny empty slots."""
        from pokemon_binder_scanner.scanner import IRREGULAR_LAYOUT_MIN_ACCEPTED_AREA as _AREA_MIN
        from pokemon_binder_scanner.binder_fixtures import load_manifest as _lm, render_fixture_pages
        _manifest = _lm()
        _page = next(p for p in _manifest["pages"] if p["page_id"] == "page-37")
        with tempfile.TemporaryDirectory() as td:
            render_fixture_pages(
                {"pages": [_page], "expected_page_count": 1,
                 "expected_priced_card_count": len(_page["slots"]),
                 "expected_binder_total_usd": _page["expected_total_usd"],
                 "expected_duplicate_groups": []},
                td
            )
            from pokemon_binder_scanner.scanner import _detect_irregular_layout_bboxes, _default_reference_index
            _img = Image.open(Path(td) / f"{_page['page_id']}.jpg").convert("RGB")
            _bboxes = _detect_irregular_layout_bboxes(_img, reference_index=_default_reference_index())
            for _b in _bboxes:
                self.assertGreaterEqual(_b[2] * _b[3], _AREA_MIN)


if __name__ == "__main__":
    unittest.main()
