#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from typing import Iterable

BASE = "https://pi.dev"

CARD_RE = re.compile(r'<article[^>]*data-package-card="true"[^>]*>(.*?)</article>', re.DOTALL)
ATTR_RE = re.compile(r'([\w:-]+)="([^"]*)"')
META_RE = re.compile(r'<div class="packages-meta">(.*?)</div>', re.DOTALL)
SPAN_RE = re.compile(r'<span>(.*?)</span>', re.DOTALL)
DESC_RE = re.compile(r'<p class="packages-desc">(.*?)</p>', re.DOTALL)
LINK_RE = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
INSTALL_RE = re.compile(r'pi install ([^<\n]+)')
TAG_RE = re.compile(r'<[^>]+>')


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "pi-package-gallery-skill/1.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def strip_tags(value: str) -> str:
    value = TAG_RE.sub("", value)
    return html.unescape(" ".join(value.split()))


def parse_meta(card_html: str) -> tuple[str | None, str | None, str | None]:
    m = META_RE.search(card_html)
    if not m:
        return None, None, None
    spans = [strip_tags(s) for s in SPAN_RE.findall(m.group(1))]
    author = spans[0] if len(spans) > 0 else None
    downloads = spans[1] if len(spans) > 1 else None
    updated = spans[2] if len(spans) > 2 else None
    return author, downloads, updated


def parse_links(card_html: str) -> tuple[str | None, str | None, str | None]:
    npm = None
    repo = None
    package_path = None
    for href, label_html in LINK_RE.findall(card_html):
        label = strip_tags(label_html).lower()
        if href.startswith("/packages/") and package_path is None:
            package_path = href
        elif label == "npm" and npm is None:
            npm = href
        elif label == "repo" and repo is None:
            repo = href
    return package_path, npm, repo


def parse_page(page_html: str) -> list[dict]:
    items: list[dict] = []
    for match in CARD_RE.finditer(page_html):
        full = match.group(0)
        inner = match.group(1)
        attrs = dict(ATTR_RE.findall(full.split(">", 1)[0]))
        name = html.unescape(attrs.get("data-package-name", "")).strip()
        pkg_types = html.unescape(attrs.get("data-package-types", "")).strip() or "package"
        search_text = html.unescape(attrs.get("data-package-search", "")).strip()
        desc_match = DESC_RE.search(inner)
        desc = strip_tags(desc_match.group(1)) if desc_match else ""
        author, downloads, updated = parse_meta(inner)
        package_path, npm, repo = parse_links(inner)
        install_match = INSTALL_RE.search(inner)
        install = install_match.group(1).strip() if install_match else None
        items.append(
            {
                "name": name,
                "types": [t for t in pkg_types.split() if t] or ["package"],
                "description": desc,
                "author": author,
                "downloads": downloads,
                "updated": updated,
                "packageUrl": f"{BASE}{package_path}" if package_path else None,
                "npmUrl": npm,
                "repoUrl": repo,
                "install": f"pi install {install}" if install else None,
                "searchText": search_text,
            }
        )
    return items


def collect_pages(max_pages: int) -> list[dict]:
    all_items: list[dict] = []
    for page in range(1, max_pages + 1):
        url = f"{BASE}/packages" if page == 1 else f"{BASE}/packages?page={page}"
        page_html = fetch(url)
        items = parse_page(page_html)
        if not items:
            break
        all_items.extend(items)
        if f'/packages?page={page + 1}' not in page_html:
            break
    return all_items


def filter_items(items: Iterable[dict], package_type: str | None, query: str | None) -> list[dict]:
    result = list(items)
    if package_type:
        pt = package_type.lower()
        result = [item for item in result if pt in [t.lower() for t in item["types"]]]
    if query:
        q = query.lower()
        result = [
            item
            for item in result
            if q in item["name"].lower()
            or q in item["description"].lower()
            or q in item["searchText"].lower()
            or (item["author"] and q in item["author"].lower())
        ]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch pi.dev package gallery entries")
    parser.add_argument("--type", choices=["extension", "skill", "prompt", "theme", "package"], help="Filter by package type")
    parser.add_argument("--search", help="Case-insensitive search string")
    parser.add_argument("--pages", type=int, default=5, help="Maximum pages to fetch (default: 5)")
    parser.add_argument("--limit", type=int, default=20, help="Maximum rows to print (default: 20)")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    args = parser.parse_args()

    items = collect_pages(max_pages=args.pages)
    filtered = filter_items(items, args.type, args.search)

    if args.json:
        json.dump(filtered[: args.limit if args.limit > 0 else None], sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    shown = filtered[: args.limit if args.limit > 0 else None]
    if not shown:
        print("No matching packages found.")
        return 0

    for item in shown:
        types = ",".join(item["types"])
        print(f"- {item['name']} [{types}]")
        if item["description"]:
            print(f"  desc: {item['description']}")
        meta = []
        if item["author"]:
            meta.append(f"author: {item['author']}")
        if item["downloads"]:
            meta.append(f"downloads: {item['downloads']}")
        if item["updated"]:
            meta.append(f"updated: {item['updated']}")
        if meta:
            print(f"  {' | '.join(meta)}")
        if item["install"]:
            print(f"  install: {item['install']}")
        if item["packageUrl"]:
            print(f"  page: {item['packageUrl']}")
        if item["repoUrl"]:
            print(f"  repo: {item['repoUrl']}")
        if item["npmUrl"]:
            print(f"  npm: {item['npmUrl']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
