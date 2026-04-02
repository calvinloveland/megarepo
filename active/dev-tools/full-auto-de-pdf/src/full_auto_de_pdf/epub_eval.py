"""EPUB structure evaluation helpers."""

from __future__ import annotations

from difflib import SequenceMatcher
import posixpath
from pathlib import Path
from typing import Any
import shutil
import subprocess
import zipfile
import xml.etree.ElementTree as ET

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


def _extract_headings(xhtml_text: str) -> list[str]:
    root = ET.fromstring(xhtml_text)
    headings: list[str] = []
    for element in root.iter():
        local = _local_name(element.tag).lower()
        if local not in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            continue
        text = "".join(element.itertext()).strip()
        if text:
            headings.append(text)
    return headings


def _normalize_heading(text: str) -> str:
    normalized = " ".join(text.lower().split())
    return "".join(ch for ch in normalized if ch.isalnum() or ch.isspace())


def _load_reference_headings(reference_headings_path: Path) -> list[str]:
    lines = reference_headings_path.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip()]


def _evaluate_heading_sequence(
    extracted: list[str],
    reference: list[str],
) -> dict[str, float | int]:
    extracted_norm = [
        normalized
        for value in extracted
        if (normalized := _normalize_heading(value))
    ]
    reference_norm = [
        normalized
        for value in reference
        if (normalized := _normalize_heading(value))
    ]
    matcher = SequenceMatcher(a=reference_norm, b=extracted_norm, autojunk=False)
    matched_count = sum(block.size for block in matcher.get_matching_blocks())
    precision = (matched_count / len(extracted_norm)) if extracted_norm else 0.0
    recall = (matched_count / len(reference_norm)) if reference_norm else 0.0
    return {
        "reference_count": len(reference_norm),
        "extracted_count": len(extracted_norm),
        "matched_count": matched_count,
        "sequence_ratio": matcher.ratio(),
        "precision_proxy": precision,
        "recall_proxy": recall,
    }


def _epubcheck_result(
    command: str,
    status: str,
    *,
    return_code: int | None = None,
    output: str = "",
) -> dict[str, Any]:
    result: dict[str, Any] = {"status": status, "command": command}
    if return_code is not None:
        result["return_code"] = return_code
    if output:
        result["output"] = output
    return result


def _run_epubcheck(epub_path: Path, epubcheck_cmd: str) -> dict[str, Any]:
    if shutil.which(epubcheck_cmd) is None:
        return _epubcheck_result(epubcheck_cmd, "unavailable")
    completed = subprocess.run(
        [epubcheck_cmd, str(epub_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    output = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
    return _epubcheck_result(
        epubcheck_cmd,
        "pass" if completed.returncode == 0 else "fail",
        return_code=completed.returncode,
        output=output.strip(),
    )


def _extract_opf_path(epub_zip: zipfile.ZipFile) -> str:
    container_text = epub_zip.read("META-INF/container.xml").decode("utf-8")
    container_root = ET.fromstring(container_text)
    for node in container_root.iter():
        if _local_name(node.tag) != "rootfile":
            continue
        opf_path = node.attrib.get("full-path")
        if opf_path:
            return opf_path
    raise ValueError("EPUB container did not specify OPF rootfile")


def _parse_manifest_and_spine(
    opf_root: ET.Element,
    opf_path: str,
) -> tuple[dict[str, dict[str, str]], list[str]]:
    manifest_items: dict[str, dict[str, str]] = {}
    spine_ids: list[str] = []
    for element in opf_root.iter():
        local = _local_name(element.tag)
        if local == "item":
            _add_manifest_item(manifest_items, element, opf_path)
            continue
        if local == "itemref":
            ref_id = element.attrib.get("idref")
            if ref_id:
                spine_ids.append(ref_id)
    return manifest_items, spine_ids


def _add_manifest_item(
    manifest_items: dict[str, dict[str, str]],
    element: ET.Element,
    opf_path: str,
) -> None:
    item_id = element.attrib.get("id")
    href = element.attrib.get("href")
    if not item_id or not href:
        return
    manifest_items[item_id] = {
        "href": _resolve_zip_path(opf_path, href),
        "media_type": element.attrib.get("media-type", ""),
        "properties": element.attrib.get("properties", ""),
    }


def _collect_nav_count(
    epub_zip: zipfile.ZipFile,
    names: set[str],
    nav_items: list[dict[str, str]],
) -> int:
    if not nav_items:
        return 0
    nav_path = nav_items[0]["href"]
    if nav_path not in names:
        return 0
    return _count_toc_entries(epub_zip.read(nav_path).decode("utf-8"))


def _collect_headings(
    epub_zip: zipfile.ZipFile,
    names: set[str],
    xhtml_items: list[dict[str, str]],
) -> tuple[int, list[str]]:
    heading_count = 0
    extracted_headings: list[str] = []
    for item in xhtml_items:
        xhtml_path = item["href"]
        if xhtml_path not in names:
            continue
        xhtml_text = epub_zip.read(xhtml_path).decode("utf-8")
        heading_count += _count_headings(xhtml_text)
        extracted_headings.extend(_extract_headings(xhtml_text))
    return heading_count, extracted_headings


def _read_epub_contents(epub_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(epub_path) as epub_zip:
        names = set(epub_zip.namelist())
        opf_path = _extract_opf_path(epub_zip)
        opf_text = epub_zip.read(opf_path).decode("utf-8")
        opf_root = ET.fromstring(opf_text)
        manifest_items, spine_ids = _parse_manifest_and_spine(opf_root, opf_path)
        xhtml_items = [
            item
            for item in manifest_items.values()
            if item["media_type"] == "application/xhtml+xml"
        ]
        nav_items = [item for item in xhtml_items if "nav" in item.get("properties", "")]
        nav_entry_count = _collect_nav_count(epub_zip, names, nav_items)
        heading_count, extracted_headings = _collect_headings(epub_zip, names, xhtml_items)
    spine_paths = [manifest_items.get(item_id, {}).get("href") for item_id in spine_ids]
    reading_order_valid = all(path is not None and path in names for path in spine_paths)
    return {
        "names": names,
        "opf_path": opf_path,
        "manifest_items": manifest_items,
        "spine_ids": spine_ids,
        "xhtml_items": xhtml_items,
        "nav_items": nav_items,
        "nav_entry_count": nav_entry_count,
        "heading_count": heading_count,
        "extracted_headings": extracted_headings,
        "reading_order_valid": reading_order_valid,
        "has_mimetype": "mimetype" in names,
        "has_container": "META-INF/container.xml" in names,
    }


def _structure_score(contents: dict[str, Any]) -> float:
    checks = [
        bool(contents["has_mimetype"]),
        bool(contents["has_container"]),
        str(contents["opf_path"]) in contents["names"],
        bool(contents["nav_items"]),
        bool(contents["reading_order_valid"]),
        int(contents["nav_entry_count"]) > 0,
        int(contents["heading_count"]) > 0,
    ]
    return sum(1 for check in checks if check) / len(checks)


def _build_structure_report(epub_path: Path, contents: dict[str, Any]) -> dict[str, Any]:
    score = _structure_score(contents)
    return {
        "epub_path": str(epub_path),
        "checks": {
            "has_mimetype": contents["has_mimetype"],
            "has_container": contents["has_container"],
            "has_opf": str(contents["opf_path"]) in contents["names"],
            "has_nav_item": bool(contents["nav_items"]),
            "reading_order_valid": contents["reading_order_valid"],
            "has_toc_entries": int(contents["nav_entry_count"]) > 0,
            "has_headings": int(contents["heading_count"]) > 0,
        },
        "metrics": {
            "manifest_item_count": len(contents["manifest_items"]),
            "spine_item_count": len(contents["spine_ids"]),
            "xhtml_item_count": len(contents["xhtml_items"]),
            "toc_entry_count": contents["nav_entry_count"],
            "heading_count": contents["heading_count"],
            "structure_score": score,
        },
    }


def evaluate_epub_structure(
    epub_path: Path,
    run_epubcheck: bool = True,
    epubcheck_cmd: str = "epubcheck",
    reference_headings_path: Path | None = None,
) -> dict[str, Any]:
    """Evaluate EPUB structure quality and optional heading-order similarity."""

    contents = _read_epub_contents(epub_path)
    report = _build_structure_report(epub_path, contents)
    report["epubcheck"] = (
        _run_epubcheck(epub_path, epubcheck_cmd)
        if run_epubcheck
        else {"status": "skipped"}
    )
    if reference_headings_path is not None:
        reference_headings = _load_reference_headings(reference_headings_path)
        report["reference_headings_path"] = str(reference_headings_path)
        report["heading_sequence_eval"] = _evaluate_heading_sequence(
            extracted=contents["extracted_headings"],
            reference=reference_headings,
        )
    return report
