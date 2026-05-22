from __future__ import annotations

import argparse
from pathlib import Path

from .binder_fixtures import (
    DEFAULT_DEMO_PAGE_PATH,
    DEFAULT_MANIFEST_PATH,
    DEFAULT_RENDER_DIR,
    audit_picture_only_pipeline,
    build_demo_page,
    load_manifest,
    render_fixture_pages,
    run_fixture_test_command,
    validate_manifest,
)
from .real_card_assets import sync_manifest_reference_assets
from .scanner import evaluate_scanner_on_fixture_dataset


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Utilities for the Pokémon binder scanner starter project.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate-fixtures", help="Validate the synthetic binder fixture manifest")
    validate_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)

    render_parser = subparsers.add_parser("render-fixtures", help="Render JPEG binder-page fixtures from real card scans")
    render_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    render_parser.add_argument(
        "--render-dir",
        type=Path,
        default=DEFAULT_RENDER_DIR,
    )

    demo_parser = subparsers.add_parser("demo-page", help="Generate an HTML page that demonstrates the dataset and regression tests")
    demo_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    demo_parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)
    demo_parser.add_argument("--output", type=Path, default=DEFAULT_DEMO_PAGE_PATH)
    demo_parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Skip running the fixture unittest command before writing the demo page",
    )

    evaluate_parser = subparsers.add_parser("evaluate-scanner", help="Run the picture-only fixture scanner against the rendered dataset")
    evaluate_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    evaluate_parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)

    sync_parser = subparsers.add_parser("sync-real-assets", help="Resolve real Pokémon card references and download local reference images")
    sync_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    sync_parser.add_argument("--asset-dir", type=Path, default=DEFAULT_MANIFEST_PATH.parent / "reference_cards")

    audit_parser = subparsers.add_parser("audit-picture-only", help="Audit the raster fixture pipeline for svg/metadata leakage")
    audit_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    audit_parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)

    subparsers.add_parser("web", help="Run the local Flask scanner web app")

    scan_parser = subparsers.add_parser("scan-image", help="Scan a single user-provided binder page image and print detected cards")
    scan_parser.add_argument("image", type=Path, help="Path to a .jpg, .png, or .webp binder page image")
    scan_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    scan_parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format")

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "web":
        from .webapp import main as run_webapp

        run_webapp()
        return 0

    manifest = load_manifest(args.manifest)
    errors = validate_manifest(manifest)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    if args.command == "validate-fixtures":
        print(
            "Validated fixture corpus: "
            f"{manifest['fixture_name']} ({manifest['expected_priced_card_count']} priced cards, "
            f"${manifest['expected_binder_total_usd']:.2f} total)"
        )
        return 0

    if args.command == "render-fixtures":
        render_dir = args.render_dir
        rendered_paths = render_fixture_pages(manifest, render_dir)
        for path in rendered_paths:
            print(f"Rendered {path}")
        return 0

    if args.command == "sync-real-assets":
        report = sync_manifest_reference_assets(args.manifest, args.asset_dir)
        print(
            "Synced real card assets: "
            f"{report['resolved_unique_cards']} unique cards -> {report['asset_dir']}"
        )
        return 0

    if args.command == "evaluate-scanner":
        rendered_paths = render_fixture_pages(manifest, args.render_dir)
        for path in rendered_paths:
            print(f"Rendered {path}")
        report = evaluate_scanner_on_fixture_dataset(manifest, args.render_dir)
        print(
            "Scanner evaluation: "
            f"card_accuracy={report['card_accuracy']:.3f} predicted_total=${report['predicted_binder_total_usd']:.2f}"
        )
        for page in report["page_reports"]:
            mismatch_text = "; ".join(page["mismatches"]) if page["mismatches"] else "none"
            print(
                f"- {page['page_id']}: cards {page['card_matches']}/{page['slot_count']}, mismatches={mismatch_text}"
            )
        return 0

    if args.command == "scan-image":
        import json as jsonlib
        from .scanner import scan_fixture_image

        image_path = args.image
        if not image_path.exists():
            print(f"ERROR: image not found: {image_path}")
            return 1
        result = scan_fixture_image(image_path)
        if args.format == "json":
            # Make result JSON-serializable
            output = {
                "page_id": result["page_id"],
                "slot_count": result["slot_count"],
                "predicted_total_usd": result["predicted_total_usd"],
                "slots": [
                    {
                        "slot_id": slot["slot_id"],
                        "canonical_card_id": slot["card"].get("canonical_card_id"),
                        "name": slot["card"].get("name"),
                        "price_usd": round(float(slot["card"].get("fixture_price_usd", 0.0)), 2),
                        "match_score": slot["match_score"],
                        "bbox_norm": slot["bbox_norm"],
                    }
                    for slot in result["slots"]
                ],
            }
            print(jsonlib.dumps(output, indent=2))
        else:
            print(f"Page: {result['page_id']}")
            print(f"Detected slots: {result['slot_count']}")
            print(f"Predicted total: ${result['predicted_total_usd']:.2f}")
            for slot in result["slots"]:
                card = slot["card"]
                print(
                    f"  {slot['slot_id']}: {card.get('name', 'Unknown')} "
                    f"({card.get('canonical_card_id', '?')}) — "
                    f"${float(card.get('fixture_price_usd', 0.0)):.2f} "
                    f"[score {slot['match_score']}]"
                )
        return 0

    if args.command == "audit-picture-only":
        report = audit_picture_only_pipeline(manifest, args.render_dir)
        print(f"Picture-only audit: {'PASS' if report['passed'] else 'FAIL'}")
        for issue in report['issues']:
            print(f"- {issue}")
        return 0 if report['passed'] else 1

    test_report = None if args.skip_tests else run_fixture_test_command(cwd=Path(__file__).resolve().parents[2])
    rendered_paths = render_fixture_pages(manifest, args.render_dir)
    for path in rendered_paths:
        print(f"Rendered {path}")
    scanner_report = evaluate_scanner_on_fixture_dataset(manifest, args.render_dir)
    audit_report = audit_picture_only_pipeline(manifest, args.render_dir)
    output_path = build_demo_page(
        manifest,
        args.output,
        render_dir=args.render_dir,
        test_report=test_report,
        scanner_report=scanner_report,
        audit_report=audit_report,
    )
    print(f"Wrote demo page {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
