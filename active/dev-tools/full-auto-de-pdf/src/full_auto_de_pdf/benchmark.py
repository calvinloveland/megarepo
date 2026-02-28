from __future__ import annotations

from dataclasses import dataclass
import gzip
import json
from pathlib import Path
import re
from typing import Any, Callable
from urllib.request import urlopen
import xml.etree.ElementTree as ET

from rapidfuzz.distance import Levenshtein

from .archive_org import fetch_metadata
from .ocr_cleanup import cleanup_ocr_text

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


def _download_bytes(url: str, timeout_seconds: int = 60) -> bytes:
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read()


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


def _extract_archive_abbyy_filename(metadata: dict[str, Any]) -> str | None:
    files = metadata.get("files")
    if not isinstance(files, list):
        return None

    candidates: list[str] = []
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        name = file_entry.get("name")
        if isinstance(name, str) and name.lower().endswith("_abbyy.gz"):
            candidates.append(name)
    if not candidates:
        return None
    return sorted(candidates, key=len)[0]


def fetch_archive_ocr_text(identifier: str, timeout_seconds: int = 60) -> str:
    metadata = fetch_metadata(identifier, timeout_seconds=timeout_seconds)
    filename = _extract_archive_djvu_filename(metadata)
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    return _download_text(url, timeout_seconds=timeout_seconds)


def fetch_gutenberg_text(gutenberg_id: int, timeout_seconds: int = 60) -> str:
    url = GUTENBERG_TEXT_URL.format(gutenberg_id=gutenberg_id)
    return _download_text(url, timeout_seconds=timeout_seconds)


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", maxsplit=1)[1]
    return tag


def parse_abbyy_xml_text(xml_text: str) -> str:
    root = ET.fromstring(xml_text)
    lines: list[str] = []
    for line_element in root.iter():
        if _local_name(line_element.tag) != "line":
            continue
        line_chars: list[str] = []
        for char_element in line_element.iter():
            if _local_name(char_element.tag) != "charParams":
                continue
            if char_element.text:
                line_chars.append(char_element.text)
        line_text = "".join(line_chars).strip()
        if line_text:
            lines.append(line_text)
    return "\n".join(lines)


def fetch_archive_abbyy_text(identifier: str, timeout_seconds: int = 60) -> str | None:
    metadata = fetch_metadata(identifier, timeout_seconds=timeout_seconds)
    filename = _extract_archive_abbyy_filename(metadata)
    if filename is None:
        return None
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    compressed = _download_bytes(url, timeout_seconds=timeout_seconds)
    xml_payload = gzip.decompress(compressed).decode("utf-8", errors="replace")
    return parse_abbyy_xml_text(xml_payload)


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


def _align_text_by_shared_ngrams(
    reference_text: str,
    hypothesis_text: str,
    ngram_size: int = 12,
    window_words: int = 50000,
    min_aligned_words: int = 5000,
) -> tuple[str, str, bool]:
    reference_words = _normalize_for_word_metric(reference_text)
    hypothesis_words = _normalize_for_word_metric(hypothesis_text)
    if len(reference_words) < ngram_size or len(hypothesis_words) < ngram_size:
        return reference_text, hypothesis_text, False

    hypothesis_index: dict[tuple[str, ...], int] = {}
    for index in range(len(hypothesis_words) - ngram_size + 1):
        ngram = tuple(hypothesis_words[index : index + ngram_size])
        hypothesis_index.setdefault(ngram, index)

    start_anchor: tuple[int, int] | None = None
    start_search_limit = min(window_words, len(reference_words) - ngram_size + 1)
    for index in range(start_search_limit):
        ngram = tuple(reference_words[index : index + ngram_size])
        hypothesis_index_value = hypothesis_index.get(ngram)
        if hypothesis_index_value is not None:
            start_anchor = (index, hypothesis_index_value)
            break

    end_anchor: tuple[int, int] | None = None
    end_search_start = max(0, len(reference_words) - ngram_size - window_words)
    for index in range(len(reference_words) - ngram_size, end_search_start - 1, -1):
        ngram = tuple(reference_words[index : index + ngram_size])
        hypothesis_index_value = hypothesis_index.get(ngram)
        if hypothesis_index_value is not None:
            end_anchor = (index + ngram_size, hypothesis_index_value + ngram_size)
            break

    if start_anchor is None or end_anchor is None:
        return reference_text, hypothesis_text, False

    ref_start, hyp_start = start_anchor
    ref_end, hyp_end = end_anchor
    if ref_end <= ref_start or hyp_end <= hyp_start:
        return reference_text, hypothesis_text, False
    if (ref_end - ref_start) < min_aligned_words or (hyp_end - hyp_start) < min_aligned_words:
        return reference_text, hypothesis_text, False

    aligned_reference = " ".join(reference_words[ref_start:ref_end])
    aligned_hypothesis = " ".join(hypothesis_words[hyp_start:hyp_end])
    return aligned_reference, aligned_hypothesis, True


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


def calculate_accuracy_metrics(reference_text: str, hypothesis_text: str) -> dict[str, float | int]:
    ref_chars = _normalize_for_char_metric(reference_text)
    hyp_chars = _normalize_for_char_metric(hypothesis_text)
    ref_words = _normalize_for_word_metric(reference_text)
    hyp_words = _normalize_for_word_metric(hypothesis_text)
    sampled_ref_chars = _sample_text_edges(ref_chars, max_length=30000)
    sampled_hyp_chars = _sample_text_edges(hyp_chars, max_length=30000)
    sampled_ref_words = _sample_list_edges(ref_words, max_items=12000)
    sampled_hyp_words = _sample_list_edges(hyp_words, max_items=12000)

    char_distance = Levenshtein.distance(sampled_ref_chars, sampled_hyp_chars)
    word_distance = Levenshtein.distance(sampled_ref_words, sampled_hyp_words)
    cer = (
        float(char_distance) / float(len(sampled_ref_chars))
        if sampled_ref_chars
        else 0.0
    )
    wer = (
        float(word_distance) / float(len(sampled_ref_words))
        if sampled_ref_words
        else 0.0
    )
    char_accuracy = max(0.0, 1.0 - cer)
    word_accuracy = max(0.0, 1.0 - wer)

    return {
        "cer": cer,
        "wer": wer,
        "char_accuracy": char_accuracy,
        "word_accuracy": word_accuracy,
        # Backward-compatible aliases
        "cer_proxy": cer,
        "wer_proxy": wer,
        "char_accuracy_proxy": char_accuracy,
        "word_accuracy_proxy": word_accuracy,
        "char_edit_distance": int(char_distance),
        "word_edit_distance": int(word_distance),
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


def _load_or_fetch_optional_text(path: Path, fetcher: Callable[[], str | None]) -> str | None:
    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher()
    if text is None:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def _score_source(reference_text: str, source_text: str) -> tuple[dict[str, float | int], bool]:
    cleaned_source_text = cleanup_ocr_text(source_text)
    aligned_reference_text, aligned_source_text, alignment_applied = _align_text_by_shared_ngrams(
        reference_text,
        cleaned_source_text,
    )
    return calculate_accuracy_metrics(aligned_reference_text, aligned_source_text), alignment_applied


def run_archive_benchmark(
    cache_dir: Path,
    timeout_seconds: int = 60,
    books: tuple[BenchmarkBook, ...] = BENCHMARK_BOOKS,
    source_mode: str = "djvu",
) -> dict[str, Any]:
    if source_mode not in {"djvu", "abbyy", "best"}:
        raise ValueError("source_mode must be one of: djvu, abbyy, best")

    results: list[dict[str, Any]] = []
    for book in books:
        archive_path = cache_dir / f"{book.identifier}_archive_djvu.txt"
        abbyy_path = cache_dir / f"{book.identifier}_archive_abbyy.txt"
        gutenberg_path = cache_dir / f"pg{book.gutenberg_id}_gutenberg.txt"

        djvu_text = _load_or_fetch_text(
            archive_path,
            lambda: fetch_archive_ocr_text(book.identifier, timeout_seconds=timeout_seconds),
        )
        abbyy_text = _load_or_fetch_optional_text(
            abbyy_path,
            lambda: fetch_archive_abbyy_text(book.identifier, timeout_seconds=timeout_seconds),
        )
        gutenberg_text = _load_or_fetch_text(
            gutenberg_path,
            lambda: fetch_gutenberg_text(book.gutenberg_id, timeout_seconds=timeout_seconds),
        )

        reference_text = strip_gutenberg_boilerplate(gutenberg_text)
        raw_metrics = calculate_accuracy_metrics(reference_text, djvu_text)
        djvu_metrics, djvu_aligned = _score_source(reference_text, djvu_text)
        source_metrics: dict[str, dict[str, float | int | bool]] = {
            "djvu": {
                **djvu_metrics,
                "alignment_applied": djvu_aligned,
            }
        }
        if abbyy_text:
            abbyy_metrics, abbyy_aligned = _score_source(reference_text, abbyy_text)
            source_metrics["abbyy"] = {
                **abbyy_metrics,
                "alignment_applied": abbyy_aligned,
            }

        if source_mode == "best":
            selected_source, selected_metrics = min(
                source_metrics.items(),
                key=lambda item: (
                    float(item[1]["wer"]),
                    float(item[1]["cer"]),
                ),
            )
        elif source_mode == "abbyy":
            if "abbyy" not in source_metrics:
                raise ValueError(
                    f"source_mode='abbyy' requested but no ABBYY OCR is available for {book.identifier}"
                )
            selected_source = "abbyy"
            selected_metrics = source_metrics["abbyy"]
        else:
            selected_source = "djvu"
            selected_metrics = source_metrics["djvu"]

        results.append(
            {
                "identifier": book.identifier,
                "title": book.title,
                "gutenberg_id": book.gutenberg_id,
                "selected_source": selected_source,
                "alignment_applied": bool(selected_metrics["alignment_applied"]),
                "source_metrics": source_metrics,
                "raw_cer": raw_metrics["cer"],
                "raw_wer": raw_metrics["wer"],
                "raw_char_accuracy": raw_metrics["char_accuracy"],
                "raw_word_accuracy": raw_metrics["word_accuracy"],
                "raw_char_accuracy_proxy": raw_metrics["char_accuracy_proxy"],
                "raw_word_accuracy_proxy": raw_metrics["word_accuracy_proxy"],
                "raw_cer_proxy": raw_metrics["cer_proxy"],
                "raw_wer_proxy": raw_metrics["wer_proxy"],
                **selected_metrics,
            }
        )

    avg_cer = sum(float(item["cer"]) for item in results) / len(results)
    avg_wer = sum(float(item["wer"]) for item in results) / len(results)
    avg_raw_cer = sum(float(item["raw_cer"]) for item in results) / len(results)
    avg_raw_wer = sum(float(item["raw_wer"]) for item in results) / len(results)
    source_counts: dict[str, int] = {}
    for item in results:
        selected_source_name = str(item["selected_source"])
        source_counts[selected_source_name] = source_counts.get(selected_source_name, 0) + 1

    return {
        "metric_note": (
            "CER/WER are true edit-distance scores on normalized text samples. "
            "Benchmark applies OCR cleanup and shared-ngram alignment against "
            "Project Gutenberg references; source selection is controlled by source_mode."
        ),
        "books": results,
        "summary": {
            "book_count": len(results),
            "source_mode": source_mode,
            "selected_source_counts": source_counts,
            "avg_cer": avg_cer,
            "avg_wer": avg_wer,
            "avg_char_accuracy": max(0.0, 1.0 - avg_cer),
            "avg_word_accuracy": max(0.0, 1.0 - avg_wer),
            "avg_raw_cer": avg_raw_cer,
            "avg_raw_wer": avg_raw_wer,
            "avg_raw_char_accuracy": max(0.0, 1.0 - avg_raw_cer),
            "avg_raw_word_accuracy": max(0.0, 1.0 - avg_raw_wer),
            # Backward-compatible aliases
            "avg_cer_proxy": avg_cer,
            "avg_wer_proxy": avg_wer,
            "avg_char_accuracy_proxy": max(0.0, 1.0 - avg_cer),
            "avg_word_accuracy_proxy": max(0.0, 1.0 - avg_wer),
            "avg_raw_cer_proxy": avg_raw_cer,
            "avg_raw_wer_proxy": avg_raw_wer,
            "avg_raw_char_accuracy_proxy": max(0.0, 1.0 - avg_raw_cer),
            "avg_raw_word_accuracy_proxy": max(0.0, 1.0 - avg_raw_wer),
        },
    }


def write_benchmark_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
