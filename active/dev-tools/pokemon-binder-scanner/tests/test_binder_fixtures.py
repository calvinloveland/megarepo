from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from PIL import Image  # noqa: E402

from pokemon_binder_scanner.binder_fixtures import (  # noqa: E402
    audit_picture_only_pipeline,
    build_demo_page,
    load_manifest,
    render_fixture_pages,
    summarize_manifest,
    validate_manifest,
)
from pokemon_binder_scanner.scanner import evaluate_scanner_on_fixture_dataset, scan_fixture_image  # noqa: E402
from pokemon_binder_scanner.webapp import app as web_app  # noqa: E402


class BinderFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest_path = ROOT / "tests" / "fixtures" / "pokemon_binder" / "manifest.json"
        self.manifest = load_manifest(self.manifest_path)
        self.card_catalog = self._build_card_catalog()

    def _build_card_catalog(self) -> dict[str, dict[str, object]]:
        catalog: dict[str, dict[str, object]] = {}
        for page in self.manifest["pages"]:
            for slot in page["slots"]:
                card = slot.get("card")
                if not isinstance(card, dict):
                    continue
                catalog[str(card["canonical_card_id"])] = dict(card)
        return catalog

    def _make_layout_manifest(self) -> dict[str, object]:
        pages = [
            {
                "page_id": "layout-single",
                "label": "Layout single",
                "notes": ["single centered card should still scan"],
                "slots": [
                    {
                        "slot_id": "layout-single-01",
                        "bbox_norm": [0.25, 0.25, 0.50, 0.50],
                        "visibility": "clear",
                        "tilt_degrees": 0.0,
                        "card": dict(self.card_catalog["basep-1"]),
                    }
                ],
            },
            {
                "page_id": "layout-two-across",
                "label": "Layout two across",
                "notes": ["two-card spread should auto-detect as two slots"],
                "slots": [
                    {
                        "slot_id": "layout-two-across-01",
                        "bbox_norm": [0.12, 0.18, 0.32, 0.32],
                        "visibility": "glare",
                        "tilt_degrees": -4.0,
                        "card": dict(self.card_catalog["basep-3"]),
                    },
                    {
                        "slot_id": "layout-two-across-02",
                        "bbox_norm": [0.56, 0.18, 0.32, 0.32],
                        "visibility": "soft_focus",
                        "tilt_degrees": 5.0,
                        "card": dict(self.card_catalog["ju-60-1st"]),
                    },
                ],
            },
            {
                "page_id": "layout-grid-six",
                "label": "Layout grid six",
                "notes": ["six-card 3x2 layout should not rely on a 3x3 assumption"],
                "slots": [
                    {"slot_id": "layout-grid-six-01", "bbox_norm": [0.07, 0.14, 0.22, 0.22], "visibility": "clear", "tilt_degrees": 0.0, "card": dict(self.card_catalog["sv2-63"])},
                    {"slot_id": "layout-grid-six-02", "bbox_norm": [0.39, 0.14, 0.22, 0.22], "visibility": "glare", "tilt_degrees": 6.0, "card": dict(self.card_catalog["sv8-57"])},
                    {"slot_id": "layout-grid-six-03", "bbox_norm": [0.71, 0.14, 0.22, 0.22], "visibility": "tilted", "tilt_degrees": -7.0, "card": dict(self.card_catalog["swsh9tg-TG15"])},
                    {"slot_id": "layout-grid-six-04", "bbox_norm": [0.07, 0.52, 0.22, 0.22], "visibility": "soft_focus", "tilt_degrees": 4.0, "card": dict(self.card_catalog["swshp-SWSH179"])},
                    {"slot_id": "layout-grid-six-05", "bbox_norm": [0.39, 0.52, 0.22, 0.22], "visibility": "clear", "tilt_degrees": 0.0, "card": dict(self.card_catalog["swshp-SWSH181"])},
                    {"slot_id": "layout-grid-six-06", "bbox_norm": [0.71, 0.52, 0.22, 0.22], "visibility": "glare", "tilt_degrees": -5.0, "card": dict(self.card_catalog["swshp-SWSH183"])},
                ],
            },
            {
                "page_id": "layout-grid-twelve",
                "label": "Layout grid twelve",
                "notes": ["twelve-card 4x3 page should not rely on a 3x3 assumption"],
                "slots": [
                    {"slot_id": "layout-grid-twelve-01", "bbox_norm": [0.05, 0.07, 0.18, 0.18], "visibility": "clear", "tilt_degrees": 0.0, "card": dict(self.card_catalog["sv4-170"])},
                    {"slot_id": "layout-grid-twelve-02", "bbox_norm": [0.28, 0.07, 0.18, 0.18], "visibility": "glare", "tilt_degrees": 4.0, "card": dict(self.card_catalog["sv4-171"])},
                    {"slot_id": "layout-grid-twelve-03", "bbox_norm": [0.51, 0.07, 0.18, 0.18], "visibility": "soft_focus", "tilt_degrees": -4.0, "card": dict(self.card_catalog["sv1-166"])},
                    {"slot_id": "layout-grid-twelve-04", "bbox_norm": [0.74, 0.07, 0.18, 0.18], "visibility": "tilted", "tilt_degrees": 6.0, "card": dict(self.card_catalog["sv1-179"])},
                    {"slot_id": "layout-grid-twelve-05", "bbox_norm": [0.05, 0.37, 0.18, 0.18], "visibility": "clear", "tilt_degrees": 0.0, "card": dict(self.card_catalog["sv1-183"])},
                    {"slot_id": "layout-grid-twelve-06", "bbox_norm": [0.28, 0.37, 0.18, 0.18], "visibility": "glare", "tilt_degrees": -4.0, "card": dict(self.card_catalog["sv2-185"])},
                    {"slot_id": "layout-grid-twelve-07", "bbox_norm": [0.51, 0.37, 0.18, 0.18], "visibility": "soft_focus", "tilt_degrees": 5.0, "card": dict(self.card_catalog["swsh2-154"])},
                    {"slot_id": "layout-grid-twelve-08", "bbox_norm": [0.74, 0.37, 0.18, 0.18], "visibility": "tilted", "tilt_degrees": -6.0, "card": dict(self.card_catalog["sv5-155"])},
                    {"slot_id": "layout-grid-twelve-09", "bbox_norm": [0.05, 0.67, 0.18, 0.18], "visibility": "clear", "tilt_degrees": 0.0, "card": dict(self.card_catalog["sv3pt5-156"])},
                    {"slot_id": "layout-grid-twelve-10", "bbox_norm": [0.28, 0.67, 0.18, 0.18], "visibility": "glare", "tilt_degrees": 4.0, "card": dict(self.card_catalog["sv3pt5-160"])},
                    {"slot_id": "layout-grid-twelve-11", "bbox_norm": [0.51, 0.67, 0.18, 0.18], "visibility": "soft_focus", "tilt_degrees": -5.0, "card": dict(self.card_catalog["sv3pt5-161"])},
                    {"slot_id": "layout-grid-twelve-12", "bbox_norm": [0.74, 0.67, 0.18, 0.18], "visibility": "tilted", "tilt_degrees": 6.0, "card": dict(self.card_catalog["xy0-38"])},
                ],
            },
        ]
        for page in pages:
            page["expected_total_usd"] = round(sum(float(slot["card"]["fixture_price_usd"]) for slot in page["slots"]), 2)
        all_slots = [slot for page in pages for slot in page["slots"]]
        counts: dict[str, int] = {}
        totals: dict[str, float] = {}
        for slot in all_slots:
            card = slot["card"]
            card_id = str(card["canonical_card_id"])
            counts[card_id] = counts.get(card_id, 0) + 1
            totals[card_id] = round(totals.get(card_id, 0.0) + float(card["fixture_price_usd"]), 2)
        return {
            "fixture_name": "layout-coverage-fixture",
            "version": 1,
            "expected_page_count": len(pages),
            "expected_priced_card_count": len(all_slots),
            "expected_binder_total_usd": round(sum(page["expected_total_usd"] for page in pages), 2),
            "expected_duplicate_groups": [
                {"canonical_card_id": card_id, "count": count, "total_price_usd": totals[card_id]}
                for card_id, count in sorted(counts.items())
                if count > 1
            ],
            "pages": pages,
        }

    def test_manifest_validates_cleanly(self) -> None:
        self.assertEqual(validate_manifest(self.manifest), [])

    def test_expected_binder_total_matches_page_totals(self) -> None:
        computed_total = round(sum(page["expected_total_usd"] for page in self.manifest["pages"]), 2)
        self.assertEqual(computed_total, self.manifest["expected_binder_total_usd"])

    def test_summary_reports_expanded_fixture_shape(self) -> None:
        summary = summarize_manifest(self.manifest)
        total_slots = sum(len(page["slots"]) for page in self.manifest["pages"])
        empty_slots = total_slots - self.manifest["expected_priced_card_count"]
        self.assertEqual(summary["page_count"], self.manifest["expected_page_count"])
        self.assertEqual(summary["slot_count"], total_slots)
        self.assertEqual(summary["priced_card_count"], self.manifest["expected_priced_card_count"])
        self.assertEqual(summary["image_backed_card_count"], self.manifest["expected_priced_card_count"])
        self.assertEqual(summary["empty_slot_count"], empty_slots)
        self.assertEqual(summary["duplicate_group_count"], len(self.manifest["expected_duplicate_groups"]))
        self.assertEqual(summary["unique_card_count"], 88)
        self.assertEqual(summary["highest_value_card"]["name"], "Venusaur ex")

    def test_render_fixture_pages_writes_jpgs_without_exif(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            rendered_paths = render_fixture_pages(self.manifest, tmp_dir)
            self.assertEqual(len(rendered_paths), self.manifest["expected_page_count"])
            for rendered_path in rendered_paths:
                self.assertTrue(rendered_path.exists())
                self.assertEqual(rendered_path.suffix, ".jpg")
                with Image.open(rendered_path) as image:
                    self.assertEqual(image.format, "JPEG")
                    self.assertEqual(len(image.getexif()), 0)
                    self.assertGreater(image.size[0], 1000)
                    self.assertGreater(image.size[1], 1000)

    def test_scan_fixture_image_extracts_expected_slot_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            rendered_paths = render_fixture_pages(self.manifest, render_dir)
            scanned_page = scan_fixture_image(rendered_paths[0])
            self.assertEqual(scanned_page["page_id"], "page-01")
            self.assertEqual(scanned_page["slot_count"], 9)
            self.assertAlmostEqual(scanned_page["predicted_total_usd"], 786.91)

    def test_scanner_handles_multiple_non_3x3_layouts(self) -> None:
        layout_manifest = self._make_layout_manifest()
        self.assertEqual(validate_manifest(layout_manifest), [])
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            render_fixture_pages(layout_manifest, render_dir)
            single_scan = scan_fixture_image(render_dir / "layout-single.jpg")
            self.assertEqual(single_scan["slot_count"], 1)
            self.assertEqual(single_scan["slots"][0]["card"]["canonical_card_id"], "basep-1")
            report = evaluate_scanner_on_fixture_dataset(layout_manifest, render_dir)
            self.assertEqual(report["pages_evaluated"], 4)
            self.assertEqual(report["total_slots"], 21)
            self.assertGreaterEqual(report["card_accuracy"], 0.95)
            page_totals = {page["page_id"]: page["slot_count"] for page in report["page_reports"]}
            self.assertEqual(page_totals["layout-single"], 1)
            self.assertEqual(page_totals["layout-two-across"], 2)
            self.assertEqual(page_totals["layout-grid-six"], 6)
            self.assertEqual(page_totals["layout-grid-twelve"], 12)

    def test_scanner_evaluation_improves_but_still_struggles_on_hard_pages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            render_fixture_pages(self.manifest, render_dir)
            report = evaluate_scanner_on_fixture_dataset(self.manifest, render_dir)
            self.assertEqual(report["pages_evaluated"], self.manifest["expected_page_count"])
            self.assertLess(report["predicted_binder_total_usd"], self.manifest["expected_binder_total_usd"])
            self.assertGreater(report["predicted_binder_total_usd"], 12000.0)
            self.assertGreater(report["card_accuracy"], 0.80)
            self.assertLess(report["card_accuracy"], 1.0)
            bad_pages = [page for page in report["page_reports"] if page["mismatches"]]
            self.assertGreaterEqual(len(bad_pages), 14)
            page_15 = next(page for page in report["page_reports"] if page["page_id"] == "page-15")
            page_24 = next(page for page in report["page_reports"] if page["page_id"] == "page-24")
            page_30 = next(page for page in report["page_reports"] if page["page_id"] == "page-30")
            page_35 = next(page for page in report["page_reports"] if page["page_id"] == "page-35")
            page_36 = next(page for page in report["page_reports"] if page["page_id"] == "page-36")
            page_37 = next(page for page in report["page_reports"] if page["page_id"] == "page-37")
            page_38 = next(page for page in report["page_reports"] if page["page_id"] == "page-38")
            self.assertLess(page_15["card_matches"], page_15["slot_count"])
            self.assertGreaterEqual(page_24["card_matches"], 5)
            self.assertGreaterEqual(page_30["card_matches"], 8)
            self.assertGreaterEqual(page_35["card_matches"], 4)
            self.assertGreaterEqual(page_36["card_matches"], 4)
            self.assertGreaterEqual(page_37["card_matches"], 4)
            self.assertGreaterEqual(page_38["card_matches"], 5)
            self.assertLessEqual(page_35["predicted_slot_count"], page_35["slot_count"])
            self.assertLessEqual(page_36["predicted_slot_count"], page_36["slot_count"])
            self.assertLessEqual(page_37["predicted_slot_count"], page_37["slot_count"])
            self.assertLessEqual(page_38["predicted_slot_count"], 10)
            self.assertTrue(page_15["mismatches"])

    def test_picture_only_audit_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            render_fixture_pages(self.manifest, render_dir)
            audit_report = audit_picture_only_pipeline(self.manifest, render_dir)
            self.assertTrue(audit_report["passed"], audit_report["issues"])

    def test_manifest_contains_first_edition_pair(self) -> None:
        page_14 = next(page for page in self.manifest["pages"] if page["page_id"] == "page-14")
        cards = {slot["slot_id"]: slot["card"] for slot in page_14["slots"]}
        self.assertEqual(cards["p14-r3-c2"]["canonical_card_id"], "ju-60-unlimited")
        self.assertEqual(cards["p14-r3-c3"]["canonical_card_id"], "ju-60-1st")
        self.assertIn("edition", cards["p14-r3-c3"]["variant"])

    def test_web_appraiser_accepts_drag_drop_upload_images(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            rendered_paths = render_fixture_pages(self.manifest, render_dir)
            page_31 = next(path for path in rendered_paths if path.name == "page-31.jpg")
            page_34 = next(path for path in rendered_paths if path.name == "page-34.jpg")
            client = web_app.test_client()
            response = client.get("/")
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"Drag page images in and appraise the whole image", response.data)
            self.assertIn(b"loading-overlay", response.data)
            upload_data = {
                "images": [
                    (io.BytesIO(page_31.read_bytes()), "page-31.jpg"),
                    (io.BytesIO(page_34.read_bytes()), "page-34.jpg"),
                ]
            }
            post_response = client.post("/appraise", data=upload_data, content_type="multipart/form-data")
            self.assertEqual(post_response.status_code, 200)
            self.assertIn(b"page-31.jpg", post_response.data)
            self.assertIn(b"page-34.jpg", post_response.data)
            self.assertIn(b"Detected 1 card", post_response.data)
            self.assertIn(b"Detected 12 cards", post_response.data)
            self.assertIn(b"Predicted total", post_response.data)
            self.assertIn(b"results-section", post_response.data)
            self.assertIn("👍".encode("utf-8"), post_response.data)
            self.assertIn(b"Enter the actual card name or ID", post_response.data)

            feedback_response = client.post(
                "/feedback",
                data={
                    "image_filename": "page-31.jpg",
                    "original_name": "page-31.jpg",
                    "slot_id": "slot-01",
                    "predicted_card_id": "basep-1",
                    "predicted_card_name": "Pikachu",
                    "feedback": "down",
                    "actual_card": "basep-3",
                },
            )
            self.assertEqual(feedback_response.status_code, 200)
            self.assertIn("Correction saved", feedback_response.get_data(as_text=True))

    def test_build_demo_page_writes_html_with_summary_and_tests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            demo_path = Path(tmp_dir) / "index.html"
            render_fixture_pages(self.manifest, render_dir)
            output_path = build_demo_page(
                self.manifest,
                demo_path,
                render_dir=render_dir,
                test_report={
                    "passed": True,
                    "display_command": "python -m unittest tests/test_binder_fixtures.py",
                    "command": "python -m unittest tests/test_binder_fixtures.py",
                    "output": "Ran 7 tests\nOK",
                },
                scanner_report=None,
            )
            self.assertEqual(output_path, demo_path)
            html = demo_path.read_text(encoding="utf-8")
            self.assertIn("Pokémon binder fixture corpus", html)
            self.assertIn("python -m unittest tests/test_binder_fixtures.py", html)
            self.assertIn("Scanner evaluation", html)
            self.assertIn("page-15.jpg", html)
            self.assertIn("page-30.jpg", html)
            self.assertIn("page-34.jpg", html)
            self.assertIn("Picture-only audit", html)
            self.assertIn("adversarial scanner breakage cases", html)
            self.assertIn("twelve-up layout probe", html)


if __name__ == "__main__":
    unittest.main()
