#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

IMPORT_RE = re.compile(r"(?:import|export)\s+(?:[^;]*?from\s+)?[\"'](\.[^\"']+)[\"']")
SUPPORTED_EXTENSION_FILES = (".ts", ".js")
NODE_TEST_SUFFIXES = (".test.mjs", ".test.js", ".test.cjs", ".test.ts")


@dataclass(frozen=True)
class ExtensionEntry:
    relative_path: str
    absolute_path: str


@dataclass(frozen=True)
class TestPlan:
    target_type: str
    target_path: str
    package_root: str
    extension_entries: list[ExtensionEntry]
    node_test_files: list[str]
    python_test_files: list[str]
    import_issues: list[str]
    link_issues: list[str]
    coverage_warnings: list[str]
    suggested_commands: list[str]

    def to_json(self) -> dict:
        return {
            **asdict(self),
            "extension_entries": [asdict(entry) for entry in self.extension_entries],
        }


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    output: str


@dataclass(frozen=True)
class RunResult:
    plan: TestPlan
    command_results: list[CommandResult]


def _package_manifest(package_root: Path) -> dict | None:
    package_json = package_root / "package.json"
    if not package_json.exists():
        return None
    return json.loads(package_json.read_text(encoding="utf-8"))


def _normalize_target(target_path: Path) -> tuple[str, Path, Path]:
    resolved = target_path.expanduser().resolve()
    if resolved.is_file():
        return "extension_file", resolved, resolved.parent
    return "package", resolved, resolved


def _discover_extension_paths(package_root: Path, manifest: dict | None) -> list[Path]:
    if manifest and isinstance(manifest.get("pi"), dict):
        raw_entries = manifest["pi"].get("extensions") or []
        if isinstance(raw_entries, str):
            raw_entries = [raw_entries]
        resolved_entries: list[Path] = []
        for raw_entry in raw_entries:
            if not isinstance(raw_entry, str) or not raw_entry.strip() or raw_entry.startswith("!"):
                continue
            candidate = (package_root / raw_entry).resolve()
            if candidate.is_dir():
                resolved_entries.extend(sorted(path for path in candidate.rglob("*") if path.suffix in SUPPORTED_EXTENSION_FILES))
            elif candidate.is_file() and candidate.suffix in SUPPORTED_EXTENSION_FILES:
                resolved_entries.append(candidate)
        if resolved_entries:
            return sorted(dict.fromkeys(resolved_entries))

    conventional_dir = package_root / "extensions"
    if conventional_dir.exists():
        return sorted(path for path in conventional_dir.rglob("*") if path.suffix in SUPPORTED_EXTENSION_FILES)
    return []


def _discover_node_tests(package_root: Path) -> list[Path]:
    tests_dir = package_root / "tests"
    if not tests_dir.exists():
        return []
    return sorted(path for path in tests_dir.rglob("*") if path.name.endswith(NODE_TEST_SUFFIXES))


def _discover_python_tests(package_root: Path) -> list[Path]:
    tests_dir = package_root / "tests"
    if not tests_dir.exists():
        return []
    return sorted(path for path in tests_dir.rglob("test_*.py"))


def _relative_paths(paths: Iterable[Path], package_root: Path) -> list[str]:
    return [path.relative_to(package_root).as_posix() for path in paths]


def _import_issues(extension_paths: Iterable[Path], package_root: Path) -> list[str]:
    issues: list[str] = []
    for extension_path in extension_paths:
        content = extension_path.read_text(encoding="utf-8")
        for relative_import in IMPORT_RE.findall(content):
            imported = (extension_path.parent / relative_import).resolve()
            if imported.exists():
                continue
            for suffix in (".ts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js", "/index.mjs", "/index.cjs"):
                if Path(f"{imported}{suffix}").exists():
                    break
            else:
                issues.append(f"{extension_path.relative_to(package_root).as_posix()} -> {relative_import}")
    return issues


def _link_issues(extension_paths: Iterable[Path], global_extensions_dir: Path | None) -> list[str]:
    if global_extensions_dir is None or not global_extensions_dir.exists():
        return []

    issues: list[str] = []
    for extension_path in extension_paths:
        link_path = global_extensions_dir / extension_path.name
        if not link_path.exists() or not link_path.is_symlink():
            continue
        resolved_target = link_path.resolve()
        if resolved_target != extension_path.resolve():
            issues.append(f"{link_path.name} -> {resolved_target}")
    return issues


def build_test_plan(target: str | Path, global_extensions_dir: str | Path | None = Path("~/.pi/agent/extensions")) -> TestPlan:
    target_type, resolved_target, package_root = _normalize_target(Path(target))
    manifest = _package_manifest(package_root)
    extension_paths = [resolved_target] if target_type == "extension_file" else _discover_extension_paths(package_root, manifest)
    node_tests = _discover_node_tests(package_root)
    python_tests = _discover_python_tests(package_root)
    import_issues = _import_issues(extension_paths, package_root)
    extensions_dir = Path(global_extensions_dir).expanduser().resolve() if global_extensions_dir is not None else None
    link_issues = _link_issues(extension_paths, extensions_dir)
    coverage_warnings: list[str] = []
    if extension_paths and not node_tests and not python_tests:
        coverage_warnings.append("No automated Node or Python tests were discovered for this extension package.")

    suggested_commands: list[str] = []
    if node_tests:
        suggested_commands.append("node --test " + " ".join(_relative_paths(node_tests, package_root)))
    if python_tests:
        suggested_commands.append("python -m pytest -q " + " ".join(_relative_paths(python_tests, package_root)))
    suggested_commands.append(f"pi -e {package_root}")

    return TestPlan(
        target_type=target_type,
        target_path=str(resolved_target),
        package_root=str(package_root),
        extension_entries=[
            ExtensionEntry(relative_path=path.relative_to(package_root).as_posix(), absolute_path=str(path))
            for path in extension_paths
        ],
        node_test_files=_relative_paths(node_tests, package_root),
        python_test_files=_relative_paths(python_tests, package_root),
        import_issues=import_issues,
        link_issues=link_issues,
        coverage_warnings=coverage_warnings,
        suggested_commands=suggested_commands,
    )


def run_automated_checks(plan: TestPlan) -> RunResult:
    package_root = Path(plan.package_root)
    command_results: list[CommandResult] = []
    for command in plan.suggested_commands:
        if not command.startswith(("node --test ", "python -m pytest ")):
            continue
        proc = subprocess.run(command, cwd=package_root, shell=True, capture_output=True, text=True)
        output = ((proc.stdout or "") + (proc.stderr or "")).strip()
        command_results.append(CommandResult(command=command, exit_code=proc.returncode, output=output))
    return RunResult(plan=plan, command_results=command_results)


def _print_plan(plan: TestPlan) -> None:
    print(f"Target: {plan.target_path}")
    print(f"Target type: {plan.target_type}")
    print(f"Package root: {plan.package_root}")
    print()

    print("Extension entries:")
    for entry in plan.extension_entries:
        print(f"  - {entry.relative_path}")
    if not plan.extension_entries:
        print("  - none discovered")
    print()

    print("Automated tests:")
    if plan.node_test_files:
        print("  - node: " + ", ".join(plan.node_test_files))
    if plan.python_test_files:
        print("  - python: " + ", ".join(plan.python_test_files))
    if not plan.node_test_files and not plan.python_test_files:
        print("  - none discovered")
    print()

    if plan.import_issues:
        print("Import issues:")
        for issue in plan.import_issues:
            print(f"  - {issue}")
        print()

    if plan.link_issues:
        print("Global extension link issues:")
        for issue in plan.link_issues:
            print(f"  - {issue}")
        print()

    if plan.coverage_warnings:
        print("Coverage warnings:")
        for warning in plan.coverage_warnings:
            print(f"  - {warning}")
        print()

    print("Suggested commands:")
    for command in plan.suggested_commands:
        print(f"  - {command}")


def _print_run_result(run_result: RunResult) -> None:
    _print_plan(run_result.plan)
    print()
    print("Automated command results:")
    for result in run_result.command_results:
        print(f"  - {result.command} -> exit {result.exit_code}")
        if result.output:
            print(result.output)
            print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and optionally run a repeatable test plan for a Pi extension package")
    parser.add_argument("target", help="Package directory or extension file")
    parser.add_argument("--json", action="store_true", help="Print the plan as JSON")
    parser.add_argument("--run", action="store_true", help="Run discovered automated test commands")
    parser.add_argument(
        "--global-extensions-dir",
        default="~/.pi/agent/extensions",
        help="Directory containing globally linked extension files for optional symlink auditing",
    )
    args = parser.parse_args()

    plan = build_test_plan(args.target, global_extensions_dir=args.global_extensions_dir)
    if args.run:
        run_result = run_automated_checks(plan)
        if args.json:
            print(
                json.dumps(
                    {
                        "plan": run_result.plan.to_json(),
                        "command_results": [asdict(result) for result in run_result.command_results],
                    },
                    indent=2,
                )
            )
            return 0 if all(result.exit_code == 0 for result in run_result.command_results) else 1
        _print_run_result(run_result)
        return 0 if all(result.exit_code == 0 for result in run_result.command_results) else 1

    if args.json:
        print(json.dumps(plan.to_json(), indent=2))
        return 0

    _print_plan(plan)
    return 0 if not plan.import_issues and not plan.link_issues and not plan.coverage_warnings else 1


if __name__ == "__main__":
    raise SystemExit(main())
