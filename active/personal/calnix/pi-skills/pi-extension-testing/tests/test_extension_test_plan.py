from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from extension_test_plan import build_test_plan  # type: ignore[import-not-found]


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def test_build_test_plan_uses_pi_manifest_and_detects_checks(tmp_path: Path) -> None:
    package_dir = tmp_path / "demo-package"
    (package_dir / "extensions").mkdir(parents=True)
    (package_dir / "tests").mkdir()

    write_json(
        package_dir / "package.json",
        {
            "name": "demo-package",
            "pi": {"extensions": ["./extensions"]},
        },
    )
    (package_dir / "extensions" / "demo.ts").write_text(
        'import helper from "./helper.mjs";\nexport default function () { return helper; }\n',
        encoding="utf-8",
    )
    (package_dir / "extensions" / "helper.mjs").write_text("export default 1;\n", encoding="utf-8")
    (package_dir / "tests" / "demo.test.mjs").write_text("import test from 'node:test';\n", encoding="utf-8")

    plan = build_test_plan(package_dir)

    assert plan.target_type == "package"
    assert [entry.relative_path for entry in plan.extension_entries] == ["extensions/demo.ts"]
    assert plan.node_test_files == ["tests/demo.test.mjs"]
    assert plan.python_test_files == []
    assert plan.import_issues == []
    assert plan.suggested_commands[0].startswith("node --test")
    assert any(command.startswith("pi -e") for command in plan.suggested_commands)


def test_build_test_plan_falls_back_to_conventional_extensions_directory(tmp_path: Path) -> None:
    package_dir = tmp_path / "conventional-package"
    (package_dir / "extensions").mkdir(parents=True)
    (package_dir / "extensions" / "entry.js").write_text("export default function () {}\n", encoding="utf-8")

    plan = build_test_plan(package_dir)

    assert [entry.relative_path for entry in plan.extension_entries] == ["extensions/entry.js"]
    assert plan.coverage_warnings == ["No automated Node or Python tests were discovered for this extension package."]
    assert plan.suggested_commands[-1].startswith("pi -e ")


def test_build_test_plan_reports_missing_relative_imports(tmp_path: Path) -> None:
    package_dir = tmp_path / "broken-package"
    (package_dir / "extensions").mkdir(parents=True)
    (package_dir / "extensions" / "broken.ts").write_text(
        'import missing from "./missing-helper.mjs";\nexport default function () { return missing; }\n',
        encoding="utf-8",
    )

    plan = build_test_plan(package_dir)

    assert plan.import_issues == ["extensions/broken.ts -> ./missing-helper.mjs"]


def test_build_test_plan_audits_global_extension_symlinks(tmp_path: Path) -> None:
    package_dir = tmp_path / "linked-package"
    extensions_dir = tmp_path / "pi-extensions"
    (package_dir / "extensions").mkdir(parents=True)
    extensions_dir.mkdir(parents=True)

    entry_file = package_dir / "extensions" / "linked.ts"
    entry_file.write_text("export default function () {}\n", encoding="utf-8")
    (extensions_dir / "linked.ts").symlink_to(entry_file)

    plan = build_test_plan(package_dir, global_extensions_dir=extensions_dir)

    assert plan.link_issues == []


def test_build_test_plan_reports_link_mismatches(tmp_path: Path) -> None:
    package_dir = tmp_path / "mismatch-package"
    extensions_dir = tmp_path / "pi-extensions"
    (package_dir / "extensions").mkdir(parents=True)
    extensions_dir.mkdir(parents=True)

    entry_file = package_dir / "extensions" / "mismatch.ts"
    entry_file.write_text("export default function () {}\n", encoding="utf-8")
    other_file = tmp_path / "other.ts"
    other_file.write_text("export default function () {}\n", encoding="utf-8")
    (extensions_dir / "mismatch.ts").symlink_to(other_file)

    plan = build_test_plan(package_dir, global_extensions_dir=extensions_dir)

    assert plan.link_issues == [f"mismatch.ts -> {other_file}"]
