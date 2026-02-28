from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any
from urllib.request import urlopen


ARCHIVE_DETAILS_URL = "https://archive.org/details/{identifier}"
ARCHIVE_METADATA_URL = "https://archive.org/metadata/{identifier}"


@dataclass(frozen=True)
class StarterBook:
    identifier: str
    title: str


STARTER_BOOKS: tuple[StarterBook, ...] = (
    StarterBook("prideprejudice00austiala", "Pride and Prejudice"),
    StarterBook("mobydickorwhale00melvuoft", "Moby-Dick; or, The Whale"),
    StarterBook("adventuresofsher00doyliala", "The Adventures of Sherlock Holmes"),
    StarterBook("frankensteinor00sheluoft", "Frankenstein; or, The Modern Prometheus"),
    StarterBook("dracula00bramuoft", "Dracula"),
)


def fetch_metadata(identifier: str, timeout_seconds: int = 30) -> dict[str, Any]:
    url = ARCHIVE_METADATA_URL.format(identifier=identifier)
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        payload = response.read().decode("utf-8")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError(f"archive.org metadata for {identifier!r} was not an object")
    return data


def _extract_str(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, list):
        for item in value:
            candidate = _extract_str(item)
            if candidate:
                return candidate
    return None


def _extract_languages(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        languages: list[str] = []
        for item in value:
            if isinstance(item, str) and item:
                languages.append(item)
        return languages
    return []


def _normalize_files(files: Any) -> list[dict[str, Any]]:
    if not isinstance(files, list):
        return []
    normalized: list[dict[str, Any]] = []
    for file_entry in files:
        if isinstance(file_entry, dict):
            normalized.append(file_entry)
    return normalized


def _has_suffix(files: list[dict[str, Any]], suffix: str) -> bool:
    lowered = suffix.lower()
    for file_entry in files:
        name = file_entry.get("name")
        if isinstance(name, str) and name.lower().endswith(lowered):
            return True
    return False


def build_manifest_entry(book: StarterBook, metadata: dict[str, Any]) -> dict[str, Any]:
    md = metadata.get("metadata")
    md_obj = md if isinstance(md, dict) else {}
    files = _normalize_files(metadata.get("files"))

    return {
        "identifier": book.identifier,
        "book_title": book.title,
        "archive_title": _extract_str(md_obj.get("title")),
        "details_url": ARCHIVE_DETAILS_URL.format(identifier=book.identifier),
        "metadata_url": ARCHIVE_METADATA_URL.format(identifier=book.identifier),
        "language": _extract_languages(md_obj.get("language")),
        "year": _extract_str(md_obj.get("date")),
        "ocr_assets": {
            "djvu_txt": _has_suffix(files, "_djvu.txt"),
            "abbyy_gz": _has_suffix(files, "_abbyy.gz"),
            "scandata_xml": _has_suffix(files, "_scandata.xml"),
        },
        "scan_assets": {
            "pdf": _has_suffix(files, ".pdf"),
            "jp2_zip": _has_suffix(files, "_jp2.zip"),
        },
        "file_count": len(files),
    }


def build_manifest(timeout_seconds: int = 30) -> list[dict[str, Any]]:
    manifest: list[dict[str, Any]] = []
    for book in STARTER_BOOKS:
        metadata = fetch_metadata(book.identifier, timeout_seconds=timeout_seconds)
        manifest.append(build_manifest_entry(book, metadata))
    return manifest


def write_manifest(path: Path, manifest: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"books": manifest}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
