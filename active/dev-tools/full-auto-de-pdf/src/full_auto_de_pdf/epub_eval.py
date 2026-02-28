from __future__ import annotations

import posixpath
from pathlib import Path
from typing import Any
import zipfile
import xml.etree.ElementTree as ET
import shutil
import subprocess


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", maxsplit=1)[1]
    return tag


def _resolve_zip_path(base_path: str, relative_path: str) -> str:
    base_dir = posixpath.dirname(base_path)
    combined = posixpath.normpath(posixpath.join(base_dir, relative_path))
    return combined.lstrip("./")


def _count_toc_entries(nav_text: str) -> int:
    root = ET.fromstring(nav_text)
    for element in root.iter():
        if _local_name(element.tag) == "nav":
            links = [node for node in element.iter() if _local_name(node.tag) == "a"]
            if links:
                return len(links)
    return 0


def _count_headings(xhtml_text: str) -> int:
    root = ET.fromstring(xhtml_text)
    count = 0
    for element in root.iter():
        local = _local_name(element.tag).lower()
        if local in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            count += 1
    return count


def _run_epubcheck(epub_path: Path, epubcheck_cmd: str) -> dict[str, Any]:
    if shutil.which(epubcheck_cmd) is None:
        return {"status": "unavailable", "command": epubcheck_cmd}
    completed = subprocess.run(
        [epubcheck_cmd, str(epub_path)],
        capture_output=True,
        text=True,
    )
    output = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
    return {
        "status": "pass" if completed.returncode == 0 else "fail",
        "command": epubcheck_cmd,
        "return_code": completed.returncode,
        "output": output.strip(),
    }


def evaluate_epub_structure(
    epub_path: Path,
    run_epubcheck: bool = True,
    epubcheck_cmd: str = "epubcheck",
) -> dict[str, Any]:
    with zipfile.ZipFile(epub_path) as epub_zip:
        names = set(epub_zip.namelist())
        has_mimetype = "mimetype" in names
        has_container = "META-INF/container.xml" in names
        container_text = epub_zip.read("META-INF/container.xml").decode("utf-8")
        container_root = ET.fromstring(container_text)
        opf_path = None
        for node in container_root.iter():
            if _local_name(node.tag) == "rootfile":
                opf_path = node.attrib.get("full-path")
                if opf_path:
                    break
        if not opf_path:
            raise ValueError("EPUB container did not specify OPF rootfile")

        opf_text = epub_zip.read(opf_path).decode("utf-8")
        opf_root = ET.fromstring(opf_text)
        manifest_items: dict[str, dict[str, str]] = {}
        spine_ids: list[str] = []

        for element in opf_root.iter():
            local = _local_name(element.tag)
            if local == "item":
                item_id = element.attrib.get("id")
                href = element.attrib.get("href")
                media_type = element.attrib.get("media-type", "")
                properties = element.attrib.get("properties", "")
                if item_id and href:
                    manifest_items[item_id] = {
                        "href": _resolve_zip_path(opf_path, href),
                        "media_type": media_type,
                        "properties": properties,
                    }
            elif local == "itemref":
                ref_id = element.attrib.get("idref")
                if ref_id:
                    spine_ids.append(ref_id)

        spine_paths = [manifest_items.get(item_id, {}).get("href") for item_id in spine_ids]
        reading_order_valid = all(path is not None and path in names for path in spine_paths)
        xhtml_items = [
            item
            for item in manifest_items.values()
            if item["media_type"] == "application/xhtml+xml"
        ]
        nav_items = [item for item in xhtml_items if "nav" in item.get("properties", "")]
        nav_entry_count = 0
        if nav_items:
            nav_path = nav_items[0]["href"]
            if nav_path in names:
                nav_entry_count = _count_toc_entries(epub_zip.read(nav_path).decode("utf-8"))

        heading_count = 0
        for item in xhtml_items:
            xhtml_path = item["href"]
            if xhtml_path in names:
                heading_count += _count_headings(epub_zip.read(xhtml_path).decode("utf-8"))

        checks = [
            has_mimetype,
            has_container,
            opf_path in names,
            bool(nav_items),
            reading_order_valid,
            nav_entry_count > 0,
            heading_count > 0,
        ]
        structure_score = sum(1 for check in checks if check) / len(checks)

    report: dict[str, Any] = {
        "epub_path": str(epub_path),
        "checks": {
            "has_mimetype": has_mimetype,
            "has_container": has_container,
            "has_opf": opf_path in names,
            "has_nav_item": bool(nav_items),
            "reading_order_valid": reading_order_valid,
            "has_toc_entries": nav_entry_count > 0,
            "has_headings": heading_count > 0,
        },
        "metrics": {
            "manifest_item_count": len(manifest_items),
            "spine_item_count": len(spine_ids),
            "xhtml_item_count": len(xhtml_items),
            "toc_entry_count": nav_entry_count,
            "heading_count": heading_count,
            "structure_score": structure_score,
        },
    }
    report["epubcheck"] = _run_epubcheck(epub_path, epubcheck_cmd) if run_epubcheck else {"status": "skipped"}
    return report
