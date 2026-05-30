#!/usr/bin/env python3
"""Build a staged MkDocs source tree for the megarepo web documentation site."""

from __future__ import annotations

import shutil
import textwrap
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import re

ROOT = Path(__file__).resolve().parents[1]
DOCS_SOURCE = ROOT / "docs"
GENERATED_DOCS = ROOT / ".docs-site"
REPO_URL = "https://github.com/calvinloveland/megarepo"
DEFAULT_BRANCH = "main"
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
    # Runtime data dirs and generated artifacts — not project docs
    "data",
    "artifacts",
    "tests",
}
LINK_PATTERN = re.compile(r"(!?\[[^\]]*\]\()([^\)]+)(\))")


class PageRecord:
    def __init__(self, source_path: Path, output_path: Path, title: str, summary: str) -> None:
        self.source_path = source_path
        self.output_path = output_path
        self.title = title
        self.summary = summary


class SiteManifest:
    def __init__(self) -> None:
        self.page_records: list[PageRecord] = []
        self.alias_map: dict[Path, Path] = {}

    def add_page(self, source_path: Path, output_path: Path, title: str, summary: str) -> None:
        source_path = source_path.resolve()
        output_path = output_path
        self.page_records.append(PageRecord(source_path, output_path, title, summary))
        self.alias_map[source_path] = output_path

    def add_alias(self, source_path: Path, output_path: Path) -> None:
        self.alias_map[source_path.resolve()] = output_path


def is_in_scope(path: Path) -> bool:
    return not any(part in EXCLUDED_PARTS for part in path.parts)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_title(markdown_text: str, fallback: str) -> str:
    for line in markdown_text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback.replace("_", " ").replace("-", " ").strip() or "Documentation"


def extract_summary(markdown_text: str) -> str:
    lines = [line.strip() for line in markdown_text.splitlines()]
    paragraphs: list[str] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                paragraphs.append(" ".join(current).strip())
                current = []
            continue
        if line.startswith("#"):
            continue
        current.append(line)
    if current:
        paragraphs.append(" ".join(current).strip())
    if not paragraphs:
        return ""
    summary = paragraphs[0]
    summary = re.sub(r"!?\[([^\]]+)\]\([^\)]+\)", r"\1", summary)
    return summary


def split_destination_and_title(destination: str) -> tuple[str, str]:
    destination = destination.strip()
    if not destination:
        return destination, ""
    quote_positions = [position for position in (destination.find(' "'), destination.find(" '")) if position != -1]
    if not quote_positions:
        return destination, ""
    split_at = min(quote_positions)
    return destination[:split_at], destination[split_at:]


def github_url_for(path: Path, is_image: bool) -> str:
    relative_path = path.relative_to(ROOT).as_posix()
    if is_image:
        return f"https://raw.githubusercontent.com/calvinloveland/megarepo/{DEFAULT_BRANCH}/{relative_path}"
    return f"{REPO_URL}/blob/{DEFAULT_BRANCH}/{relative_path}"


def github_tree_url_for(path: Path) -> str:
    relative_path = path.relative_to(ROOT).as_posix()
    return f"{REPO_URL}/tree/{DEFAULT_BRANCH}/{relative_path}"


def output_path_to_url(output_path: Path) -> str:
    if output_path.name == "index.md":
        return "/".join(output_path.parent.parts) + "/" if output_path.parent != Path(".") else "./"
    return "/".join(output_path.with_suffix("").parts) + "/"


def relative_site_link(from_output_path: Path, to_output_path: Path) -> str:
    relative_file = Path(shutil.os.path.relpath(to_output_path, start=from_output_path.parent)).as_posix()
    if relative_file == "index.md":
        return "./"
    if relative_file.endswith("/index.md"):
        return relative_file
    if relative_file.endswith(".md"):
        return relative_file
    return relative_file


def rewrite_markdown_links(markdown_text: str, source_path: Path, output_path: Path, alias_map: dict[Path, Path]) -> str:
    def replace(match: re.Match[str]) -> str:
        prefix, destination, suffix = match.groups()
        path_part, title_part = split_destination_and_title(destination)
        if not path_part or path_part.startswith(("http://", "https://", "mailto:", "tel:", "#", "/")):
            return match.group(0)
        parsed = urlsplit(path_part)
        target_path = (source_path.parent / parsed.path).resolve(strict=False)
        fragment = f"#{parsed.fragment}" if parsed.fragment else ""
        query = f"?{parsed.query}" if parsed.query else ""

        aliased_output = alias_map.get(target_path.resolve())
        if aliased_output is not None:
            target_url = relative_site_link(output_path, aliased_output)
            rewritten = target_url + query + fragment + title_part
            return f"{prefix}{rewritten}{suffix}"

        if target_path.exists() and target_path.is_dir() and target_path.is_relative_to(ROOT):
            for candidate in (target_path / "docs" / "index.md", target_path / "README.md"):
                aliased_output = alias_map.get(candidate.resolve(strict=False))
                if aliased_output is not None:
                    target_url = relative_site_link(output_path, aliased_output)
                    rewritten = target_url + query + fragment + title_part
                    return f"{prefix}{rewritten}{suffix}"
            rewritten = github_tree_url_for(target_path) + query + fragment + title_part
            return f"{prefix}{rewritten}{suffix}"

        if target_path.exists() and target_path.is_file() and target_path.is_relative_to(ROOT):
            lower_name = target_path.name.lower()
            is_image = lower_name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"))
            rewritten = github_url_for(target_path, is_image=is_image) + query + fragment + title_part
            return f"{prefix}{rewritten}{suffix}"

        # Target doesn't exist – convert broken link to plain text to avoid
        # mkdocs --strict failures on internal-link warnings.
        # prefix is e.g. "[text](" or "![alt]("; strip the trailing "](".
        inner = prefix[:-2]
        if inner.startswith("!["):
            return inner[2:-1]  # "![alt]" → "alt"
        else:
            return inner[1:-1]  # "[text]" → "text"

    return LINK_PATTERN.sub(replace, markdown_text)


def collect_manifest() -> SiteManifest:
    manifest = SiteManifest()

    root_home = DOCS_SOURCE / "index.md"
    root_text = read_text(root_home)
    manifest.add_page(root_home, Path("index.md"), extract_title(root_text, "Megarepo"), extract_summary(root_text))
    docs_readme = DOCS_SOURCE / "README.md"
    if docs_readme.exists():
        manifest.add_alias(docs_readme, Path("index.md"))
    manifest.add_alias(ROOT / "README.md", Path("index.md"))

    repository_index = ROOT / "docs" / "repository-index.generated.md"
    manifest.add_page(repository_index, Path("repository") / "index.md", "Repository Reference", "Repo-wide philosophy, plans, migration notes, and site tooling.")

    for path in sorted(DOCS_SOURCE.rglob("*.md")):
        if path.name in {"README.md", "index.md", "repository-index.generated.md"}:
            continue
        if not is_in_scope(path):
            continue
        relative = path.relative_to(DOCS_SOURCE)
        output_path = Path("repository") / relative
        text = read_text(path)
        manifest.add_page(path, output_path, extract_title(text, path.stem), extract_summary(text))

    for path in (ROOT / "PHILOSOPHY.md", ROOT / "PLAN.md", ROOT / "ISSUES.md"):
        if path.exists():
            text = read_text(path)
            manifest.add_page(path, Path("repository") / path.name.lower(), extract_title(text, path.stem), extract_summary(text))

    projects_index = ROOT / "docs" / "projects-index.generated.md"
    manifest.add_page(projects_index, Path("projects") / "index.md", "Projects", "Browsable index of migrated project and area documentation.")

    for index_path in sorted(ROOT.rglob("docs/index.md")):
        if index_path == DOCS_SOURCE / "index.md":
            continue
        if not is_in_scope(index_path):
            continue
        project_root = index_path.parent.parent
        if project_root == ROOT:
            continue
        for page_path in sorted(index_path.parent.rglob("*.md")):
            if not is_in_scope(page_path):
                continue
            relative_page = page_path.relative_to(index_path.parent)
            output_path = Path("projects") / project_root.relative_to(ROOT) / relative_page
            text = read_text(page_path)
            manifest.add_page(page_path, output_path, extract_title(text, page_path.stem), extract_summary(text))
        readme_path = project_root / "README.md"
        if readme_path.exists():
            manifest.add_alias(readme_path, Path("projects") / project_root.relative_to(ROOT) / "index.md")

    return manifest


def build_repository_index(manifest: SiteManifest) -> str:
    repo_pages = [record for record in manifest.page_records if record.output_path.parts and record.output_path.parts[0] == "repository" and record.output_path.name != "index.md"]
    repo_pages.sort(key=lambda record: record.output_path.as_posix())
    lines = [
        "# Repository Reference",
        "",
        "Repo-wide documentation that explains how this megarepo is organized and how the web docs are built.",
        "",
    ]
    repository_index_path = Path("repository") / "index.md"
    for record in repo_pages:
        url = relative_site_link(repository_index_path, record.output_path)
        summary = f" - {record.summary}" if record.summary else ""
        lines.append(f"- [{record.title}]({url}){summary}")
    lines.append("")
    return "\n".join(lines)


def build_projects_index(manifest: SiteManifest) -> str:
    grouped: dict[str, list[PageRecord]] = defaultdict(list)
    for record in manifest.page_records:
        if len(record.output_path.parts) < 3 or record.output_path.parts[0] != "projects":
            continue
        if record.output_path.name != "index.md":
            continue
        group = record.output_path.parts[1]
        grouped[group].append(record)

    lines = [
        "# Projects",
        "",
        "Canonical project and area documentation migrated from repository READMEs into web docs.",
        "",
    ]
    for group in sorted(grouped):
        lines.append(f"## {group.replace('-', ' ').replace('_', ' ').title()}")
        lines.append("")
        projects_index_path = Path("projects") / "index.md"
        for record in sorted(grouped[group], key=lambda item: item.output_path.as_posix()):
            path_label = "/".join(record.output_path.parts[1:-1])
            url = relative_site_link(projects_index_path, record.output_path)
            summary = f" - {record.summary}" if record.summary else ""
            lines.append(f"- [`{path_label}`]({url}){summary}")
        lines.append("")
    return "\n".join(lines)


def stage_page(record: PageRecord, alias_map: dict[Path, Path]) -> None:
    output_file = GENERATED_DOCS / record.output_path
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if record.source_path.name == "repository-index.generated.md":
        content = build_repository_index(site_manifest)
    elif record.source_path.name == "projects-index.generated.md":
        content = build_projects_index(site_manifest)
    else:
        content = read_text(record.source_path)

    rewritten = rewrite_markdown_links(content, record.source_path, record.output_path, alias_map)
    output_file.write_text(rewritten, encoding="utf-8")


def main() -> int:
    if GENERATED_DOCS.exists():
        shutil.rmtree(GENERATED_DOCS)
    GENERATED_DOCS.mkdir(parents=True, exist_ok=True)

    global site_manifest
    site_manifest = collect_manifest()

    for record in site_manifest.page_records:
        stage_page(record, site_manifest.alias_map)

    generated_count = len(site_manifest.page_records)
    print(f"Generated {generated_count} staged markdown pages in {GENERATED_DOCS}")
    return 0


site_manifest: SiteManifest


if __name__ == "__main__":
    raise SystemExit(main())
