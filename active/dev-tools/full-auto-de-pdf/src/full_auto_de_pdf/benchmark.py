from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
from typing import Any, Callable
from urllib.request import urlopen

from .archive_org import fetch_metadata

ARCHIVE_DOWNLOAD_URL = "https://archive.org/download/{identifier}/{filename}"
GUTENBERG_TEXT_URL = "https://www.gutenberg.org/cache/epub/{gutenberg_id}/pg{gutenberg_id}.txt"


@dataclass(frozen=True)
class BenchmarkBook:
    identifier: str
    title: str
    gutenberg_id: int


BENCHMARK_BOOKS: tuple[BenchmarkBook, ...] = (
    BenchmarkBook("jane-austen_pride-and-prejudice", "Pride and Prejudice", 1342),
    BenchmarkBook("in.ernet.dli.2015.461099", "Moby-Dick; or, The Whale", 2701),
    BenchmarkBook("TheAdventuresOfSherlockHolmes-English", "The Adventures of Sherlock Holmes", 1661),
    BenchmarkBook("frankensteinormo00shel_10", "Frankenstein; or, The Modern Prometheus", 84),
    BenchmarkBook("dracu00stok", "Dracula", 345),
)


def _download_text(url: str, timeout_seconds: int = 60) -> str:
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def _extract_archive_djvu_filename(metadata: dict[str, Any]) -> str:
    files = metadata.get("files")
    if not isinstance(files, list):
        raise ValueError("metadata payload did not include a files list")

    candidates: list[str] = []
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        name = file_entry.get("name")
        if isinstance(name, str) and name.lower().endswith("_djvu.txt"):
            candidates.append(name)
    if not candidates:
        raise ValueError("metadata payload did not include a _djvu.txt file")
    return sorted(candidates, key=len)[0]


def fetch_archive_ocr_text(identifier: str, timeout_seconds: int = 60) -> str:
    metadata = fetch_metadata(identifier, timeout_seconds=timeout_seconds)
    filename = _extract_archive_djvu_filename(metadata)
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    return _download_text(url, timeout_seconds=timeout_seconds)


def fetch_gutenberg_text(gutenberg_id: int, timeout_seconds: int = 60) -> str:
    url = GUTENBERG_TEXT_URL.format(gutenberg_id=gutenberg_id)
    return _download_text(url, timeout_seconds=timeout_seconds)


def strip_gutenberg_boilerplate(text: str) -> str:
    lines = text.splitlines()
    start = 0
    end = len(lines)

    for index, line in enumerate(lines):
        upper = line.upper()
        if "*** START OF THE PROJECT GUTENBERG EBOOK" in upper:
            start = index + 1
            break

    for index in range(len(lines) - 1, -1, -1):
        upper = lines[index].upper()
        if "*** END OF THE PROJECT GUTENBERG EBOOK" in upper:
            end = index
            break

    stripped = "\n".join(lines[start:end]).strip()
    return stripped or text.strip()


def _normalize_for_char_metric(text: str) -> str:
    lower = text.lower()
    return re.sub(r"[^a-z0-9]+", "", lower)


def _normalize_for_word_metric(text: str) -> list[str]:
    lower = text.lower()
    return re.findall(r"[a-z0-9']+", lower)


def _sample_text_edges(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    head = max_length // 2
    tail = max_length - head
    return text[:head] + text[-tail:]


def _sample_list_edges(items: list[str], max_items: int) -> list[str]:
    if len(items) <= max_items:
        return items
    head = max_items // 2
    tail = max_items - head
    return items[:head] + items[-tail:]


def calculate_proxy_accuracy(reference_text: str, hypothesis_text: str) -> dict[str, float | int]:
    ref_chars = _normalize_for_char_metric(reference_text)
    hyp_chars = _normalize_for_char_metric(hypothesis_text)
    ref_words = _normalize_for_word_metric(reference_text)
    hyp_words = _normalize_for_word_metric(hypothesis_text)
    sampled_ref_chars = _sample_text_edges(ref_chars, max_length=30000)
    sampled_hyp_chars = _sample_text_edges(hyp_chars, max_length=30000)
    sampled_ref_words = _sample_list_edges(ref_words, max_items=12000)
    sampled_hyp_words = _sample_list_edges(hyp_words, max_items=12000)

    char_similarity = (
        SequenceMatcher(a=sampled_ref_chars, b=sampled_hyp_chars, autojunk=False).ratio()
        if sampled_ref_chars
        else 0.0
    )
    word_similarity = (
        SequenceMatcher(a=sampled_ref_words, b=sampled_hyp_words, autojunk=False).ratio()
        if sampled_ref_words
        else 0.0
    )

    return {
        "cer_proxy": 1.0 - char_similarity,
        "wer_proxy": 1.0 - word_similarity,
        "char_accuracy_proxy": char_similarity,
        "word_accuracy_proxy": word_similarity,
        "reference_char_count": len(ref_chars),
        "hypothesis_char_count": len(hyp_chars),
        "reference_word_count": len(ref_words),
        "hypothesis_word_count": len(hyp_words),
        "sampled_reference_char_count": len(sampled_ref_chars),
        "sampled_hypothesis_char_count": len(sampled_hyp_chars),
        "sampled_reference_word_count": len(sampled_ref_words),
        "sampled_hypothesis_word_count": len(sampled_hyp_words),
    }


def _load_or_fetch_text(path: Path, fetcher: Callable[[], str]) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def run_archive_benchmark(
    cache_dir: Path,
    timeout_seconds: int = 60,
    books: tuple[BenchmarkBook, ...] = BENCHMARK_BOOKS,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for book in books:
        archive_path = cache_dir / f"{book.identifier}_archive_djvu.txt"
        gutenberg_path = cache_dir / f"pg{book.gutenberg_id}_gutenberg.txt"

        archive_text = _load_or_fetch_text(
            archive_path,
            lambda: fetch_archive_ocr_text(book.identifier, timeout_seconds=timeout_seconds),
        )
        gutenberg_text = _load_or_fetch_text(
            gutenberg_path,
            lambda: fetch_gutenberg_text(book.gutenberg_id, timeout_seconds=timeout_seconds),
        )

        reference_text = strip_gutenberg_boilerplate(gutenberg_text)
        metrics = calculate_proxy_accuracy(reference_text, archive_text)
        results.append(
            {
                "identifier": book.identifier,
                "title": book.title,
                "gutenberg_id": book.gutenberg_id,
                **metrics,
            }
        )

    avg_cer = sum(float(item["cer_proxy"]) for item in results) / len(results)
    avg_wer = sum(float(item["wer_proxy"]) for item in results) / len(results)

    return {
        "metric_note": (
            "CER/WER are proxy values computed from normalized head+tail text samples "
            "and compared against Project Gutenberg references."
        ),
        "books": results,
        "summary": {
            "book_count": len(results),
            "avg_cer_proxy": avg_cer,
            "avg_wer_proxy": avg_wer,
            "avg_char_accuracy_proxy": 1.0 - avg_cer,
            "avg_word_accuracy_proxy": 1.0 - avg_wer,
        },
    }


def write_benchmark_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
