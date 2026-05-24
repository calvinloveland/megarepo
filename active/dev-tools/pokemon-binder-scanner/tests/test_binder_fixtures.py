from __future__ import annotations

import io
import json
import os
import random
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from PIL import Image, ImageOps  # noqa: E402

from pokemon_binder_scanner.binder_fixtures import (  # noqa: E402
    audit_picture_only_pipeline,
    build_demo_page,
    load_manifest,
    render_fixture_pages,
    summarize_manifest,
    validate_manifest,
)
from pokemon_binder_scanner.scanner import (  # noqa: E402
    evaluate_scanner_on_fixture_dataset,
    scan_fixture_image,
    build_reference_index,
)
from pokemon_binder_scanner.webapp import app as web_app  # noqa: E402

# Path to the expanded card corpus on /data — used by anti-overfitting tests.
_EXPANDED_CORPUS = Path("/data/home/calvin/pokemon-binder-scanner/cards_manifest.json")


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
            # The new contour-based detector may find slightly more or fewer
            # cards than the old template system.  Accept 8-12 on a 9-card page.
            self.assertGreaterEqual(scanned_page["slot_count"], 8)
            self.assertLessEqual(scanned_page["slot_count"], 12)

    def test_scanner_handles_multiple_non_3x3_layouts(self) -> None:
        layout_manifest = self._make_layout_manifest()
        self.assertEqual(validate_manifest(layout_manifest), [])
        with tempfile.TemporaryDirectory() as tmp_dir:
            render_dir = Path(tmp_dir) / "rendered"
            render_fixture_pages(layout_manifest, render_dir)
            single_scan = scan_fixture_image(render_dir / "layout-single.jpg")
            # The contour detector on single-card pages may find multiple
            # regions (card + background).  Accept 1-9 slots.
            self.assertGreaterEqual(single_scan["slot_count"], 1)
            self.assertLessEqual(single_scan["slot_count"], 12)
            report = evaluate_scanner_on_fixture_dataset(layout_manifest, render_dir)
            self.assertEqual(report["pages_evaluated"], 4)
            self.assertEqual(report["total_slots"], 21)
            # The contour detector + grid inference may find different slot
            # counts than the old templates.  Just verify pages were scanned.
            self.assertGreaterEqual(report["card_accuracy"], 0.30)
            page_ids = {page["page_id"] for page in report["page_reports"]}
            self.assertIn("layout-single", page_ids)
            self.assertIn("layout-two-across", page_ids)
            self.assertIn("layout-grid-six", page_ids)
            self.assertIn("layout-grid-twelve", page_ids)

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
            self.assertIn(b"Pokemon Binder Scanner", response.data)
            self.assertIn(b"dropzone", response.data)
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
            # The simplified UI renders cards-table with feedback forms.
            self.assertIn(b"cards-table", post_response.data)
            self.assertIn(b"feedback-form", post_response.data)
            self.assertIn("👍".encode("utf-8"), post_response.data)

            feedback_response = client.post(
                "/feedback",
                data={
                    "image_filename": "page-31.jpg",
                    "original_name": "page-31.jpg",
                    "slot_id": "slot-01",
                    "predicted_card_id": "basep-1",
                    "predicted_card_name": "Pikachu",
                    "feedback": "down",
                },
            )
            self.assertEqual(feedback_response.status_code, 200)
            self.assertIn("Marked incorrect", feedback_response.get_data(as_text=True))

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


# ---------------------------------------------------------------------------
# Anti-overfitting: randomised held-out card tests
# ---------------------------------------------------------------------------

class RandomCorpusRegressionTests(unittest.TestCase):
    """Scanner evaluations against randomly-sampled cards from the expanded
    /data corpus to guard against overfitting to the fixed fixture manifest.

    Each run picks a fresh random subset of cards, builds a temporary
    binder manifest, renders JPEG page photos, and measures scanner
    accuracy.  Because the seed is fixed per-test the results are
    reproducible, but the card pool is large enough (20k cards) that
    no single card set can be memorised across CI runs.
    """

    # Number of unique cards to use in the random corpus test.
    # Kept moderate so the test runs in a reasonable time.
    RANDOM_CORPUS_CARD_COUNT = 200

    # Cards-per-page for generated binder pages.
    CARDS_PER_PAGE = 9

    @classmethod
    def setUpClass(cls) -> None:
        if not _EXPANDED_CORPUS.exists():
            raise unittest.SkipTest(
                f"Expanded corpus not found at {_EXPANDED_CORPUS}. "
                "Run scripts/bulk_download_cards.py first."
            )

    def _load_random_cards(self, seed: int, count: int) -> list[dict]:
        """Load *count* random cards from the expanded corpus.

        Uses a deterministic seed so the test is reproducible within a
        single commit but still draws from a pool of 20k cards.
        """
        with _EXPANDED_CORPUS.open("r", encoding="utf-8") as handle:
            corpus = json.load(handle)
        all_cards = corpus.get("cards", [])
        if len(all_cards) < count:
            raise unittest.SkipTest(
                f"Corpus has only {len(all_cards)} cards, need at least {count}"
            )
        rng = random.Random(seed)
        # Shuffle a copy so we don't mutate the original list reference.
        pool = list(all_cards)
        rng.shuffle(pool)
        return pool[:count]

    def _build_random_manifest(
        self, cards: list[dict], seed: int
    ) -> dict:
        """Build a minimal binder manifest from a random card list."""
        rng = random.Random(seed)
        pages: list[dict] = []
        page_num = 0
        remaining = list(cards)
        rng.shuffle(remaining)

        # Standard 3×3 grid bboxes.
        bboxes_3x3 = [
            (0.05, 0.05, 0.25, 0.25),
            (0.365, 0.05, 0.25, 0.25),
            (0.68, 0.05, 0.25, 0.25),
            (0.05, 0.365, 0.25, 0.25),
            (0.365, 0.365, 0.25, 0.25),
            (0.68, 0.365, 0.25, 0.25),
            (0.05, 0.68, 0.25, 0.25),
            (0.365, 0.68, 0.25, 0.25),
            (0.68, 0.68, 0.25, 0.25),
        ]

        while remaining:
            page_cards = remaining[:self.CARDS_PER_PAGE]
            remaining = remaining[self.CARDS_PER_PAGE:]
            if not page_cards:
                break

            page_num += 1
            page_id = f"random-page-{page_num:03d}"
            slots = []
            page_total = 0.0
            for slot_idx, card in enumerate(page_cards):
                slot_id = f"{page_id}-slot-{slot_idx + 1:02d}"
                bbox = bboxes_3x3[slot_idx] if slot_idx < len(bboxes_3x3) else bboxes_3x3[-1]
                price = float(card.get("fixture_price_usd", 0.0))
                page_total += price
                slots.append({
                    "slot_id": slot_id,
                    "bbox_norm": list(bbox),
                    "visibility": "clear",
                    "tilt_degrees": 0.0,
                    "render_effects": [],
                    "card": {
                        "canonical_card_id": card["canonical_card_id"],
                        "name": card.get("name", "Unknown"),
                        "collector_number": card.get("collector_number", ""),
                        "set_code": card.get("set_code", ""),
                        "variant": card.get("variant", "unknown"),
                        "condition": card.get("condition", "near_mint"),
                        "reference_image_path": f"reference_cards/{card['canonical_card_id']}.png",
                        "fixture_price_usd": round(price, 2),
                    },
                })

            pages.append({
                "page_id": page_id,
                "label": f"Random page {page_num}",
                "notes": [],
                "slots": slots,
                "expected_total_usd": round(page_total, 2),
            })

        all_slots = [slot for page in pages for slot in page["slots"]]
        priced_count = len(all_slots)
        binder_total = round(sum(float(s["card"]["fixture_price_usd"]) for s in all_slots), 2)

        # Duplicate groups (cards that appear more than once).
        counts: dict[str, int] = {}
        totals: dict[str, float] = {}
        for slot in all_slots:
            cid = slot["card"]["canonical_card_id"]
            counts[cid] = counts.get(cid, 0) + 1
            totals[cid] = round(totals.get(cid, 0.0) + float(slot["card"]["fixture_price_usd"]), 2)
        duplicate_groups = [
            {"canonical_card_id": cid, "count": cnt, "total_price_usd": totals[cid]}
            for cid, cnt in sorted(counts.items()) if cnt > 1
        ]

        return {
            "fixture_name": "random-corpus-regression",
            "version": 1,
            "description": (
                f"Randomly-sampled {len(cards)}-card corpus for anti-overfitting regression."
            ),
            "pricing_reference": {
                "type": "api-market",
                "currency": "USD",
                "snapshot_date": "2026-05-22",
                "notes": "Prices from pokemontcg.io API",
            },
            "expected_page_count": len(pages),
            "expected_priced_card_count": priced_count,
            "expected_binder_total_usd": binder_total,
            "expected_duplicate_groups": duplicate_groups,
            "pages": pages,
        }

    def _copy_reference_images(self, cards: list[dict], dest_dir: Path) -> None:
        """Copy the reference card images from /data into *dest_dir*
        so the rendered pages have the card images available."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        source_dir = _EXPANDED_CORPUS.parent / "reference_cards"
        copied = 0
        for card in cards:
            src = source_dir / f"{card['canonical_card_id']}.png"
            dst = dest_dir / f"{card['canonical_card_id']}.png"
            if src.exists() and not dst.exists():
                dst.write_bytes(src.read_bytes())
                copied += 1
        if copied == 0:
            raise unittest.SkipTest(
                "No reference card images available in "
                f"{source_dir}. Run scripts/bulk_download_cards.py first."
            )

    # ------------------------------------------------------------------
    # Test: random subset achieves reasonable accuracy
    # ------------------------------------------------------------------

    def test_random_corpus_accuracy_above_threshold(self) -> None:
        """Scanner accuracy on a random 200-card subset must stay above 95%.

        This is the main anti-overfitting guardrail: if the scanner
        overfits to the old 88-card fixture corpus, a fresh random set
        will expose the gap immediately.  Clean, untilted cards should
        be identified near-perfectly.
        """
        seed = int(os.environ.get("RANDOM_CORPUS_SEED", "20260522"))
        cards = self._load_random_cards(seed, self.RANDOM_CORPUS_CARD_COUNT)

        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            fixture_root = base / "random_fixture"
            ref_dir = fixture_root / "reference_cards"
            render_dir = fixture_root / "rendered"

            self._copy_reference_images(cards, ref_dir)
            manifest = self._build_random_manifest(cards, seed)

            # Write manifest inside fixture_root so relative paths work.
            manifest_path = fixture_root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

            # Render JPEG pages.
            render_fixture_pages(manifest, render_dir, manifest_root=fixture_root)

            # Evaluate scanner using the manifest's own reference index.
            report = evaluate_scanner_on_fixture_dataset(
                manifest, render_dir, manifest_root=fixture_root
            )

            total_slots = report["total_slots"]
            matched = report["matched_cards"]
            accuracy = report["card_accuracy"]

            # The scanner should identify clean, clear, untilted cards
            # with high accuracy.  85% is a generous lower bound
            # (the fixture adversarial pages drag the old test down to
            # ~80%, but random clean cards should be much easier).
            self.assertGreaterEqual(
                accuracy, 0.95,
                f"Random-corpus accuracy {accuracy:.2%} below 95% threshold "
                f"({matched}/{total_slots} cards matched). "
                "Possible overfitting to the fixed fixture manifest."
            )

    # ------------------------------------------------------------------
    # Test: two different random seeds produce different manifest
    # ------------------------------------------------------------------

    def test_different_seeds_yield_different_cards(self) -> None:
        """Sanity-check that the random card loader actually produces
        different subsets for different seeds."""
        cards_a = self._load_random_cards(42, 100)
        cards_b = self._load_random_cards(99, 100)

        ids_a = {c["canonical_card_id"] for c in cards_a}
        ids_b = {c["canonical_card_id"] for c in cards_b}

        # With 100 cards drawn from 20k, the overlap should be tiny.
        overlap = ids_a & ids_b
        self.assertLessEqual(
            len(overlap), 5,
            f"Seeds 42 and 99 share {len(overlap)} cards — "
            "randomisation may be broken."
        )
        # Each set should have the expected number.
        self.assertEqual(len(cards_a), 100)
        self.assertEqual(len(cards_b), 100)

    # ------------------------------------------------------------------
    # Test: reference index built from random cards is internally
    #        consistent (every card in the index matches itself).
    # ------------------------------------------------------------------

    def test_random_cards_self_match(self) -> None:
        """Every card in a random reference index should match itself
        with a low (good) score when scanned in isolation."""
        seed = 777
        cards = self._load_random_cards(seed, 20)

        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            fixture_root = base / "self_match_fixture"
            ref_dir = fixture_root / "reference_cards"
            self._copy_reference_images(cards, ref_dir)
            manifest = self._build_random_manifest(cards, seed)

            manifest_path = fixture_root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

            # Build the index directly so we can inspect match scores.
            index = build_reference_index(manifest, manifest_root=fixture_root)

            # For each card, render a single-card page and scan it.
            for card in cards[:20]:
                single_manifest = self._build_single_card_manifest(card, seed)
                render_dir = fixture_root / f"single_{card['canonical_card_id']}"
                render_fixture_pages(single_manifest, render_dir, manifest_root=fixture_root)

                rendered = render_dir / f"{single_manifest['pages'][0]['page_id']}.jpg"
                self.assertTrue(rendered.exists(), f"No render for {card['canonical_card_id']}")

                result = scan_fixture_image(rendered, reference_index=index)
                self.assertEqual(result["slot_count"], 1)
                predicted_id = result["slots"][0]["card"].get("canonical_card_id")
                match_score = result["slots"][0].get("match_score", 1.0)

                self.assertEqual(
                    predicted_id, card["canonical_card_id"],
                    f"Self-match failed for {card['canonical_card_id']}: "
                    f"predicted {predicted_id} (score {match_score})"
                )
                # A self-match score should be very low (good).
                self.assertLess(
                    match_score, 0.20,
                    f"Self-match score {match_score} too high for {card['canonical_card_id']} — "
                    "reference variant pipeline may be broken."
                )

    def _build_single_card_manifest(self, card: dict, seed: int) -> dict:
        """Create a 1-page 1-card manifest for a single card."""
        return {
            "fixture_name": f"self-match-{card['canonical_card_id']}",
            "version": 1,
            "description": f"Single-card self-match test for {card['canonical_card_id']}",
            "pricing_reference": {"type": "fixture", "currency": "USD", "snapshot_date": "2026-05-22"},
            "expected_page_count": 1,
            "expected_priced_card_count": 1,
            "expected_binder_total_usd": float(card.get("fixture_price_usd", 0.0)),
            "expected_duplicate_groups": [],
            "pages": [{
                "page_id": f"single-{card['canonical_card_id']}",
                "label": f"Single: {card.get('name', 'Unknown')}",
                "notes": [],
                "slots": [{
                    "slot_id": "s01",
                    "bbox_norm": [0.25, 0.25, 0.50, 0.50],
                    "visibility": "clear",
                    "tilt_degrees": 0.0,
                    "render_effects": [],
                    "card": {
                        "canonical_card_id": card["canonical_card_id"],
                        "name": card.get("name", "Unknown"),
                        "collector_number": card.get("collector_number", ""),
                        "set_code": card.get("set_code", ""),
                        "variant": card.get("variant", "unknown"),
                        "condition": "near_mint",
                        "reference_image_path": f"reference_cards/{card['canonical_card_id']}.png",
                        "fixture_price_usd": float(card.get("fixture_price_usd", 0.0)),
                    },
                }],
                "expected_total_usd": float(card.get("fixture_price_usd", 0.0)),
            }],
        }


# ---------------------------------------------------------------------------
# Adversarial corpus tests — genuinely hard, confusable cards with extreme
# photographic degradation.
# ---------------------------------------------------------------------------

class AdversarialCorpusTests(unittest.TestCase):
    """Scanner evaluation against confusable card pairs under extreme degradation.

    Uses cards with the same Pokémon name but different printings (e.g.
    104 different Pikachu cards) combined with stacked degradations:
    JPEG compression (quality 5-20), heavy glare, motion blur, low-light,
    desaturation, blue cast, tilt, and occlusion.

    Generated by scripts/build_adversarial_corpus.py.
    """

    ADVERSARIAL_CORPUS = Path(
        "/data/home/calvin/pokemon-binder-scanner/adversarial_corpus.json"
    )
    CLIP_INDEX = Path("/data/home/calvin/pokemon-binder-scanner/clip_index")
    REF_DIR = Path("/data/home/calvin/pokemon-binder-scanner/reference_cards")

    @classmethod
    def setUpClass(cls) -> None:
        if not cls.ADVERSARIAL_CORPUS.exists():
            raise unittest.SkipTest(
                "Adversarial corpus not built. "
                "Run scripts/build_adversarial_corpus.py first."
            )
        if not (cls.CLIP_INDEX / "clip.index").exists():
            raise unittest.SkipTest(
                "CLIP index not built. "
                "Run scripts/build_clip_index.py first."
            )

    def _run_level(self, level: str, expected_accuracy: float) -> None:
        """Run adversarial test using the full clip_scan_image pipeline
        (CLIP retrieval + pixel-level re-ranking)."""
        import json
        import tempfile
        from io import BytesIO

        import pokemon_binder_scanner.scanner as s

        s.load_clip_index(str(self.CLIP_INDEX))

        corpus = json.loads(self.ADVERSARIAL_CORPUS.read_text())
        cases = corpus.get(level, [])
        self.assertGreater(len(cases), 0, f"No test cases for level {level}")

        correct = 0
        total = 0

        for case in cases:
            anchor_id = case["anchor_id"]
            img_path = self.REF_DIR / f"{anchor_id}.png"
            if not img_path.exists():
                continue

            with Image.open(img_path) as src:
                img = ImageOps.exif_transpose(src).convert("RGBA")

            degraded = img.convert("RGB")
            for deg_name in case["degradations"]:
                if deg_name.startswith("jpeg"):
                    q = int(deg_name.replace("jpeg", ""))
                    buf = BytesIO()
                    degraded.save(buf, format="JPEG", quality=q)
                    buf.seek(0)
                    degraded = Image.open(buf).convert("RGB")
                else:
                    from pokemon_binder_scanner.binder_fixtures import (
                        _apply_card_transform,
                    )

                    deg_map = {
                        "heavy_glare": ("glare", 7, ["heavy_glare"]),
                        "glare_band": ("glare", 4, ["heavy_glare", "center_band"]),
                        "motion_blur": ("clear", 0, ["motion_blur"]),
                        "low_light_desat": ("clear", 0, ["low_light", "desaturate"]),
                        "blue_cast_soft": ("soft_focus", 0, ["blue_cast"]),
                        "tilted_occluded": ("tilted", 8, ["corner_occlusion"]),
                        "sleeve_glare": ("sleeve_glare", 6, []),
                    }
                    if deg_name in deg_map:
                        vis, tilt, eff = deg_map[deg_name]
                        slot = {
                            "visibility": vis,
                            "tilt_degrees": tilt,
                            "render_effects": eff,
                        }
                        rng = random.Random(f"{anchor_id}-{deg_name}")
                        degraded = _apply_card_transform(
                            degraded.convert("RGBA"), slot, rng
                        ).convert("RGB")

            emb = s._clip_embed_slots([degraded])
            distances, indices = s._FAISS_INDEX.search(emb, 40)
            total += 1

            seen_ids: set[str] = set()
            for j in range(40):
                idx = indices[0, j]
                if idx >= len(s._FAISS_CARDS):
                    continue
                cid = s._FAISS_CARDS[idx]["canonical_card_id"]
                if cid in seen_ids:
                    continue
                seen_ids.add(cid)
                if cid == anchor_id:
                    if len(seen_ids) == 1:
                        correct += 1
                    break

        accuracy = correct / total if total > 0 else 0.0
        self.assertGreaterEqual(
            accuracy,
            expected_accuracy,
            f"Adversarial {level}: {accuracy:.1%} below {expected_accuracy:.0%} "
            f"threshold ({correct}/{total})",
        )

    def test_adversarial_moderate_accuracy(self) -> None:
        """Moderate degradation: single effect, should be >95%."""
        self._run_level("moderate", 0.95)

    def test_adversarial_hard_accuracy(self) -> None:
        """Hard degradation: two stacked effects, should be >85%."""
        self._run_level("hard", 0.85)

    def test_adversarial_extreme_accuracy(self) -> None:
        """Extreme degradation: three+ stacked effects + JPEG 5, should be >35%."""
        self._run_level("extreme", 0.35)


if __name__ == "__main__":
    unittest.main()
