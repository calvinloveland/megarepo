"""CLI for Copilot lint fixer."""
from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from copilot_lint_fixer.copilot_client import (
    CopilotFixer,
    build_fix_prompt,
    extract_updated_file,
)
from copilot_lint_fixer.pylint_runner import PylintIssue, run_pylint

logger = logging.getLogger(__name__)

DEFAULT_EXCLUDES = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "site",
    "archive",
}


def iter_python_files(root: Path, excludes: Iterable[str]) -> Iterable[Path]:
    if root.is_file():
        if root.suffix == ".py":
            yield root
        return

    exclude_set = set(excludes)
    for path in root.rglob("*.py"):
        if any(part in exclude_set for part in path.parts):
            continue
        yield path


def select_issue(issues: Sequence[PylintIssue], index: int) -> Optional[PylintIssue]:
    if not issues:
        return None
    if index < 0 or index >= len(issues):
        return issues[0]
    return issues[index]


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copilot SDK powered pylint auto-fixer")
    parser.add_argument("path", nargs="?", default=".", help="File or folder to scan")
    parser.add_argument("--max-files", type=int, default=100, help="Maximum files to scan")
    parser.add_argument("--max-fixes", type=int, default=1, help="Maximum fixes to attempt")
    parser.add_argument("--issue-index", type=int, default=0, help="Index of pylint issue to fix")
    parser.add_argument("--dry-run", action="store_true", help="Do not write files")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    parser.add_argument(
        "--pylint-args",
        nargs="*",
        default=[],
        help="Extra arguments forwarded to pylint",
    )
    parser.add_argument("--model", help="Copilot model override")
    parser.add_argument("--cli-url", help="Copilot CLI server URL override")
    parser.add_argument("--timeout", type=float, default=20.0, help="Copilot timeout in seconds")
    parser.add_argument("--allow-premium", action="store_true", help="Allow premium models")
    return parser.parse_args(argv)


def fix_file(
    fixer: CopilotFixer,
    file_path: Path,
    issue_index: int,
    pylint_args: List[str],
    dry_run: bool,
    verbose: bool,
) -> bool:
    issues = run_pylint(file_path, pylint_args)
    issue = select_issue(issues, issue_index)
    if issue is None:
        logger.debug("No pylint issues for %s", file_path)
        return False

    content = file_path.read_text(encoding="utf-8")
    system, user = build_fix_prompt(str(file_path), issue.to_payload(), content)
    response = fixer.generate_fix(system, user)
    updated = extract_updated_file(response)
    if updated is None:
        logger.warning("Copilot response did not include updated_file for %s", file_path)
        if verbose:
            logger.debug("Copilot response for %s: %s", file_path, response)
        return False

    if updated == content:
        logger.info("Copilot returned unchanged content for %s", file_path)
        return False

    logger.info("Applying fix for %s (%s)", file_path, issue.message_id or issue.symbol)
    if not dry_run:
        file_path.write_text(updated, encoding="utf-8")
    return True


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)

    root = Path(args.path).resolve()
    if not root.exists():
        logger.error("Path does not exist: %s", root)
        return 2

    fixer = CopilotFixer(
        model=args.model,
        timeout=args.timeout,
        cli_url=args.cli_url,
        allow_premium=args.allow_premium,
    )

    files = list(iter_python_files(root, DEFAULT_EXCLUDES))
    if args.max_files:
        files = files[: args.max_files]

    fixes = 0
    for file_path in files:
        if fixes >= args.max_fixes:
            break
        try:
            if fix_file(
                fixer,
                file_path,
                args.issue_index,
                args.pylint_args,
                args.dry_run,
                args.verbose,
            ):
                fixes += 1
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to fix %s: %s", file_path, exc)

    logger.info("Fixes applied: %s", fixes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
