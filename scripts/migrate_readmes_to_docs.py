#!/usr/bin/env python3
"""Migrate in-scope README files to per-directory docs/index.md pages.

The migration keeps the repo root README as a short landing page, creates
canonical markdown docs next to each project, and rewrites README.md files to
short web-doc stubs.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://calvinloveland.github.io/megarepo"
EXCLUDED_PARTS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    ".pytest_cache",
    "site",
    ".docs-site",
    "dist",
    "build",
    ".next",
    ".cache",
    ".vscode-test",
    "archive",
}
STUB_MARKER = "Canonical docs live at:"
LINK_PATTERN = re.compile(r"(!?\[[^\]]*\]\()([^\)]+)(\))")


def is_in_scope(path: Path) -> bool:
    return not any(part in EXCLUDED_PARTS for part in path.parts)


def iter_readmes() -> list[Path]:
    readmes: list[Path] = []
    for path in ROOT.rglob("README.md"):
        if path == ROOT / "README.md":
            continue
        if not is_in_scope(path):
            continue
        readmes.append(path)
    return sorted(readmes)


def extract_title(markdown_text: str, fallback: str) -> str:
    for line in markdown_text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback.replace("_", " ").replace("-", " ").strip() or "Documentation"


def split_destination_and_title(destination: str) -> tuple[str, str]:
    destination = destination.strip()
    if not destination:
        return destination, ""
    if destination.startswith("<") and destination.endswith(">"):
        return destination, ""
    quote_positions = [position for position in (destination.find(' "'), destination.find(" '")) if position != -1]
    if not quote_positions:
        return destination, ""
    split_at = min(quote_positions)
    return destination[:split_at], destination[split_at:]


def rewrite_relative_links(markdown_text: str, source_path: Path, target_path: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        prefix, destination, suffix = match.groups()
        path_part, title_part = split_destination_and_title(destination)
        if not path_part or path_part.startswith(("http://", "https://", "mailto:", "tel:", "#", "/")):
            return match.group(0)
        if path_part.startswith("<") and path_part.endswith(">"):
            return match.group(0)

        parsed = urlsplit(path_part)
        candidate = (source_path.parent / parsed.path).resolve(strict=False)
        if not candidate.exists() or not is_in_scope(candidate):
            return match.group(0)

        rewritten_path = Path(os.path.relpath(candidate, start=target_path.parent)).as_posix()
        rewritten_destination = urlunsplit(("", "", rewritten_path, parsed.query, parsed.fragment)) + title_part
        return f"{prefix}{rewritten_destination}{suffix}"

    return LINK_PATTERN.sub(replace, markdown_text)


def canonical_doc_path(readme_path: Path) -> Path:
    if readme_path == ROOT / "docs" / "README.md":
        return ROOT / "docs" / "index.md"
    return readme_path.parent / "docs" / "index.md"


def site_url_for_readme(readme_path: Path) -> str:
    if readme_path == ROOT / "docs" / "README.md":
        return f"{SITE_URL}/"
    relative_parent = readme_path.parent.relative_to(ROOT).as_posix()
    return f"{SITE_URL}/projects/{relative_parent}/"


def build_stub(title: str, readme_path: Path) -> str:
    if readme_path == ROOT / "docs" / "README.md":
        local_source = "- `index.md` and sibling markdown files in this directory"
    else:
        local_source = "- `docs/`"
    return (
        f"# {title}\n\n"
        "This directory now uses the web documentation site as its canonical documentation.\n\n"
        "Canonical docs live at:\n"
        f"- {site_url_for_readme(readme_path)}\n\n"
        "Local source docs live in:\n"
        f"{local_source}\n"
    )


def migrate_readme(readme_path: Path) -> tuple[bool, bool]:
    original_text = readme_path.read_text(encoding="utf-8")
    title = extract_title(original_text, readme_path.parent.name)
    doc_path = canonical_doc_path(readme_path)
    doc_created = False

    if readme_path != ROOT / "docs" / "README.md" and not doc_path.exists():
        doc_path.parent.mkdir(parents=True, exist_ok=True)
        migrated_text = rewrite_relative_links(original_text, readme_path, doc_path)
        doc_path.write_text(migrated_text, encoding="utf-8")
        doc_created = True

    stub_text = build_stub(title, readme_path)
    stub_written = original_text != stub_text
    if stub_written:
        readme_path.write_text(stub_text, encoding="utf-8")

    return doc_created, stub_written


def main() -> int:
    doc_creations = 0
    stub_writes = 0
    for readme_path in iter_readmes():
        doc_created, stub_written = migrate_readme(readme_path)
        doc_creations += int(doc_created)
        stub_writes += int(stub_written)

    print(f"Created {doc_creations} docs/index.md files")
    print(f"Rewrote {stub_writes} README.md stubs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
