"""Archive/Gutenberg OCR benchmarking utilities."""

from __future__ import annotations

import csv
from dataclasses import dataclass
import gzip
import json
from pathlib import Path
import re
from typing import Any
from urllib.request import urlopen
import xml.etree.ElementTree as ET

from rapidfuzz.distance import Levenshtein

from .archive_org import fetch_metadata
from .ocr_cleanup import cleanup_ocr_text
from .text_cache import load_or_fetch_optional_text, load_or_fetch_text

ARCHIVE_DOWNLOAD_URL = "https://archive.org/download/{identifier}/{filename}"
GUTENBERG_TEXT_URL = (
    "https://www.gutenberg.org/cache/epub/{gutenberg_id}/pg{gutenberg_id}.txt"
)


@dataclass(frozen=True)
class BenchmarkBook:
    """Archive/Gutenberg pairing used for OCR quality benchmarking."""

    identifier: str
    title: str
    gutenberg_id: int


@dataclass(frozen=True)
class _BookPaths:
    archive_path: Path
    abbyy_path: Path
    gutenberg_path: Path


@dataclass(frozen=True)
class _SampledMetricsInput:
    sampled_ref_chars: str
    sampled_hyp_chars: str
    sampled_ref_words: list[str]
    sampled_hyp_words: list[str]
    reference: _TextMetrics
    hypothesis: _TextMetrics


@dataclass(frozen=True)
class _TextMetrics:
    chars: str
    words: list[str]


BENCHMARK_BOOKS: tuple[BenchmarkBook, ...] = (
    BenchmarkBook("jane-austen_pride-and-prejudice", "Pride and Prejudice", 1342),
    BenchmarkBook("in.ernet.dli.2015.461099", "Moby-Dick; or, The Whale", 2701),
    BenchmarkBook(
        "TheAdventuresOfSherlockHolmes-English",
        "The Adventures of Sherlock Holmes",
        1661,
    ),
    BenchmarkBook(
        "frankensteinormo00shel_10",
        "Frankenstein; or, The Modern Prometheus",
        84,
    ),
    BenchmarkBook("dracu00stok", "Dracula", 345),
)


def _download_text(url: str, timeout_seconds: int = 60) -> str:
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def _download_bytes(url: str, timeout_seconds: int = 60) -> bytes:
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read()


def _extract_filename_by_suffix(
    metadata: dict[str, Any],
    suffix: str,
    *,
    required: bool,
) -> str | None:
    files = metadata.get("files")
    if not isinstance(files, list):
        if required:
            raise ValueError("metadata payload did not include a files list")
        return None
    candidates: list[str] = []
    lowered_suffix = suffix.lower()
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        name = file_entry.get("name")
        if isinstance(name, str) and name.lower().endswith(lowered_suffix):
            candidates.append(name)
    if candidates:
        return sorted(candidates, key=len)[0]
    if required:
        raise ValueError(f"metadata payload did not include a {suffix} file")
    return None


def _extract_archive_djvu_filename(metadata: dict[str, Any]) -> str:
    filename = _extract_filename_by_suffix(metadata, "_djvu.txt", required=True)
    if filename is None:
        raise ValueError("metadata payload did not include a _djvu.txt file")
    return filename


def _extract_archive_abbyy_filename(metadata: dict[str, Any]) -> str | None:
    return _extract_filename_by_suffix(metadata, "_abbyy.gz", required=False)


def fetch_archive_ocr_text(identifier: str, timeout_seconds: int = 60) -> str:
    """Fetch archive.org DJVU OCR text for a book identifier."""

    metadata = fetch_metadata(identifier, timeout_seconds=timeout_seconds)
    filename = _extract_archive_djvu_filename(metadata)
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    return _download_text(url, timeout_seconds=timeout_seconds)


def fetch_gutenberg_text(gutenberg_id: int, timeout_seconds: int = 60) -> str:
    """Fetch plain text from Project Gutenberg for a Gutenberg ID."""

    url = GUTENBERG_TEXT_URL.format(gutenberg_id=gutenberg_id)
    return _download_text(url, timeout_seconds=timeout_seconds)


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", maxsplit=1)[1]
    return tag


def parse_abbyy_xml_text(xml_text: str) -> str:
    """Extract text lines from ABBYY FineReader XML output."""

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
    """Fetch and decode archive.org ABBYY OCR XML text when available."""

    metadata = fetch_metadata(identifier, timeout_seconds=timeout_seconds)
    filename = _extract_archive_abbyy_filename(metadata)
    if filename is None:
        return None
    url = ARCHIVE_DOWNLOAD_URL.format(identifier=identifier, filename=filename)
    compressed = _download_bytes(url, timeout_seconds=timeout_seconds)
    xml_payload = gzip.decompress(compressed).decode("utf-8", errors="replace")
    return parse_abbyy_xml_text(xml_payload)


def strip_gutenberg_boilerplate(text: str) -> str:
    """Trim standard Gutenberg START/END wrappers when present."""

    lines = text.splitlines()
    start = _find_gutenberg_start(lines)
    end = _find_gutenberg_end(lines)
    stripped = "\n".join(lines[start:end]).strip()
    return stripped or text.strip()


def _find_gutenberg_start(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if "*** START OF THE PROJECT GUTENBERG EBOOK" in line.upper():
            return index + 1
    return 0


def _find_gutenberg_end(lines: list[str]) -> int:
    for index in range(len(lines) - 1, -1, -1):
        if "*** END OF THE PROJECT GUTENBERG EBOOK" in lines[index].upper():
            return index
    return len(lines)


def _normalize_for_char_metric(text: str) -> str:
    lower = text.lower()
    return re.sub(r"[^a-z0-9]+", "", lower)


def _normalize_for_word_metric(text: str) -> list[str]:
    lower = text.lower()
    return re.findall(r"[a-z0-9']+", lower)


def _build_hypothesis_index(words: list[str], ngram_size: int) -> dict[tuple[str, ...], int]:
    index_by_ngram: dict[tuple[str, ...], int] = {}
    for index in range(len(words) - ngram_size + 1):
        ngram = tuple(words[index : index + ngram_size])
        index_by_ngram.setdefault(ngram, index)
    return index_by_ngram


def _find_start_anchor(
    reference_words: list[str],
    hypothesis_index: dict[tuple[str, ...], int],
    ngram_size: int,
    window_words: int,
) -> tuple[int, int] | None:
    limit = min(window_words, len(reference_words) - ngram_size + 1)
    for index in range(limit):
        ngram = tuple(reference_words[index : index + ngram_size])
        hypothesis_index_value = hypothesis_index.get(ngram)
        if hypothesis_index_value is not None:
            return index, hypothesis_index_value
    return None


def _find_end_anchor(
    reference_words: list[str],
    hypothesis_index: dict[tuple[str, ...], int],
    ngram_size: int,
    window_words: int,
) -> tuple[int, int] | None:
    search_start = max(0, len(reference_words) - ngram_size - window_words)
    for index in range(len(reference_words) - ngram_size, search_start - 1, -1):
        ngram = tuple(reference_words[index : index + ngram_size])
        hypothesis_index_value = hypothesis_index.get(ngram)
        if hypothesis_index_value is not None:
            return index + ngram_size, hypothesis_index_value + ngram_size
    return None


def _alignment_is_valid(
    start_anchor: tuple[int, int] | None,
    end_anchor: tuple[int, int] | None,
    min_aligned_words: int,
) -> bool:
    if start_anchor is None or end_anchor is None:
        return False
    ref_start, hyp_start = start_anchor
    ref_end, hyp_end = end_anchor
    if ref_end <= ref_start or hyp_end <= hyp_start:
        return False
    return (ref_end - ref_start) >= min_aligned_words and (hyp_end - hyp_start) >= min_aligned_words


def _aligned_text_slices(
    reference_words: list[str],
    hypothesis_words: list[str],
    start_anchor: tuple[int, int],
    end_anchor: tuple[int, int],
) -> tuple[str, str]:
    ref_start, hyp_start = start_anchor
    ref_end, hyp_end = end_anchor
    aligned_reference = " ".join(reference_words[ref_start:ref_end])
    aligned_hypothesis = " ".join(hypothesis_words[hyp_start:hyp_end])
    return aligned_reference, aligned_hypothesis


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

    hypothesis_index = _build_hypothesis_index(hypothesis_words, ngram_size)
    start_anchor = _find_start_anchor(reference_words, hypothesis_index, ngram_size, window_words)
    end_anchor = _find_end_anchor(reference_words, hypothesis_index, ngram_size, window_words)
    if not _alignment_is_valid(start_anchor, end_anchor, min_aligned_words):
        return reference_text, hypothesis_text, False

    if start_anchor is None or end_anchor is None:
        return reference_text, hypothesis_text, False
    aligned_reference, aligned_hypothesis = _aligned_text_slices(
        reference_words,
        hypothesis_words,
        start_anchor,
        end_anchor,
    )
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


def _prepare_metrics_input(reference_text: str, hypothesis_text: str) -> _SampledMetricsInput:
    ref_chars = _normalize_for_char_metric(reference_text)
    hyp_chars = _normalize_for_char_metric(hypothesis_text)
    ref_words = _normalize_for_word_metric(reference_text)
    hyp_words = _normalize_for_word_metric(hypothesis_text)
    return _SampledMetricsInput(
        sampled_ref_chars=_sample_text_edges(ref_chars, max_length=30000),
        sampled_hyp_chars=_sample_text_edges(hyp_chars, max_length=30000),
        sampled_ref_words=_sample_list_edges(ref_words, max_items=12000),
        sampled_hyp_words=_sample_list_edges(hyp_words, max_items=12000),
        reference=_TextMetrics(chars=ref_chars, words=ref_words),
        hypothesis=_TextMetrics(chars=hyp_chars, words=hyp_words),
    )


def _safe_ratio(numerator: int, denominator: int) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def calculate_accuracy_metrics(reference_text: str, hypothesis_text: str) -> dict[str, float | int]:
    """Calculate CER/WER-style distance metrics on normalized text samples."""

    metric_input = _prepare_metrics_input(reference_text, hypothesis_text)
    char_distance = Levenshtein.distance(
        metric_input.sampled_ref_chars,
        metric_input.sampled_hyp_chars,
    )
    word_distance = Levenshtein.distance(
        metric_input.sampled_ref_words,
        metric_input.sampled_hyp_words,
    )
    cer = _safe_ratio(char_distance, len(metric_input.sampled_ref_chars))
    wer = _safe_ratio(word_distance, len(metric_input.sampled_ref_words))
    char_accuracy = max(0.0, 1.0 - cer)
    word_accuracy = max(0.0, 1.0 - wer)
    return {
        "cer": cer,
        "wer": wer,
        "char_accuracy": char_accuracy,
        "word_accuracy": word_accuracy,
        "cer_proxy": cer,
        "wer_proxy": wer,
        "char_accuracy_proxy": char_accuracy,
        "word_accuracy_proxy": word_accuracy,
        "char_edit_distance": int(char_distance),
        "word_edit_distance": int(word_distance),
        "reference_char_count": len(metric_input.reference.chars),
        "hypothesis_char_count": len(metric_input.hypothesis.chars),
        "reference_word_count": len(metric_input.reference.words),
        "hypothesis_word_count": len(metric_input.hypothesis.words),
        "sampled_reference_char_count": len(metric_input.sampled_ref_chars),
        "sampled_hypothesis_char_count": len(metric_input.sampled_hyp_chars),
        "sampled_reference_word_count": len(metric_input.sampled_ref_words),
        "sampled_hypothesis_word_count": len(metric_input.sampled_hyp_words),
    }


def _count_row_values(rows: list[dict[str, str]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        value = row.get(key, "").strip()
        if not value:
            continue
        counts[value] = counts.get(value, 0) + 1
    return counts


def _unique_nonempty_values(rows: list[dict[str, str]], key: str) -> int:
    return len({row.get(key, "").strip() for row in rows if row.get(key, "").strip()})


def _read_parallel_text_rows(
    corpus_path: Path,
    *,
    reference_column: str,
    hypothesis_column: str,
    domains: tuple[str, ...],
    row_limit: int | None,
) -> list[dict[str, str]]:
    # lizard forgive: TSV validation and row filtering are intentionally kept together.
    with corpus_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        fieldnames = tuple(reader.fieldnames or ())
        missing_columns = [
            column
            for column in (reference_column, hypothesis_column)
            if column not in fieldnames
        ]
        if missing_columns:
            raise ValueError(
                "parallel corpus TSV is missing required columns: "
                + ", ".join(missing_columns)
            )
        selected_domains = {domain.strip() for domain in domains if domain.strip()}
        rows: list[dict[str, str]] = []
        for raw_row in reader:
            if not isinstance(raw_row, dict):
                continue
            domain_value = str(raw_row.get("domain", "")).strip()
            if selected_domains and domain_value not in selected_domains:
                continue
            reference_text = str(raw_row.get(reference_column, "")).strip()
            hypothesis_text = str(raw_row.get(hypothesis_column, "")).strip()
            if not reference_text or not hypothesis_text:
                continue
            rows.append(
                {
                    "domain": domain_value,
                    "gid": str(raw_row.get("gid", "")).strip(),
                    "hid": str(raw_row.get("hid", "")).strip(),
                    "reference_text": reference_text,
                    "hypothesis_text": hypothesis_text,
                }
            )
            if row_limit is not None and len(rows) >= row_limit:
                break
    if not rows:
        raise ValueError("parallel corpus TSV did not yield any usable rows")
    return rows


def run_parallel_text_benchmark(
    corpus_path: Path,
    output_report_path: Path,
    *,
    reference_column: str = "gsent",
    hypothesis_column: str = "hsent",
    domains: tuple[str, ...] = (),
    row_limit: int | None = None,
    include_reference_lexicon_cleanup: bool = False,
) -> dict[str, Any]:
    """Benchmark a local aligned OCR/proofread TSV corpus."""

    rows = _read_parallel_text_rows(
        corpus_path,
        reference_column=reference_column,
        hypothesis_column=hypothesis_column,
        domains=domains,
        row_limit=row_limit,
    )
    reference_text = "\n".join(row["reference_text"] for row in rows)
    hypothesis_text = "\n".join(row["hypothesis_text"] for row in rows)
    cleaned_hypothesis_text = cleanup_ocr_text(hypothesis_text)

    summary: dict[str, Any] = {
        "row_count": len(rows),
        "raw_metrics": calculate_accuracy_metrics(reference_text, hypothesis_text),
        "cleaned_metrics": calculate_accuracy_metrics(reference_text, cleaned_hypothesis_text),
    }
    if include_reference_lexicon_cleanup:
        reference_guided_hypothesis = cleanup_ocr_text(
            hypothesis_text,
            lexicon_texts=(reference_text,),
        )
        summary["reference_lexicon_metrics"] = calculate_accuracy_metrics(
            reference_text,
            reference_guided_hypothesis,
        )

    report = {
        "corpus_path": str(corpus_path),
        "corpus_type": "aligned-parallel-text-tsv",
        "reference_column": reference_column,
        "hypothesis_column": hypothesis_column,
        "selected_domains": [domain for domain in domains if domain.strip()],
        "row_limit": row_limit,
        "domain_counts": _count_row_values(rows, "domain"),
        "gutenberg_id_count": _unique_nonempty_values(rows, "gid"),
        "hathitrust_id_count": _unique_nonempty_values(rows, "hid"),
        "metric_note": (
            "Raw metrics score the selected OCR sentences exactly as supplied. "
            "Cleaned metrics score the same corpus after applying cleanup_ocr_text to the "
            "joined OCR text. Reference-lexicon metrics, when enabled, are oracle-style "
            "and should not be treated as deployable accuracy."
        ),
        "summary": summary,
    }
    write_benchmark_report(output_report_path, report)
    return report


def _book_paths(cache_dir: Path, book: BenchmarkBook) -> _BookPaths:
    return _BookPaths(
        archive_path=cache_dir / f"{book.identifier}_archive_djvu.txt",
        abbyy_path=cache_dir / f"{book.identifier}_archive_abbyy.txt",
        gutenberg_path=cache_dir / f"pg{book.gutenberg_id}_gutenberg.txt",
    )


def _fetch_djvu_text(book: BenchmarkBook, timeout_seconds: int) -> str:
    return fetch_archive_ocr_text(book.identifier, timeout_seconds=timeout_seconds)


def _fetch_abbyy_text(book: BenchmarkBook, timeout_seconds: int) -> str | None:
    return fetch_archive_abbyy_text(book.identifier, timeout_seconds=timeout_seconds)


def _fetch_gutenberg(book: BenchmarkBook, timeout_seconds: int) -> str:
    return fetch_gutenberg_text(book.gutenberg_id, timeout_seconds=timeout_seconds)


def _score_source(reference_text: str, source_text: str) -> tuple[dict[str, float | int], bool]:
    cleaned_source_text = cleanup_ocr_text(source_text)
    aligned_reference, aligned_source, alignment_applied = _align_text_by_shared_ngrams(
        reference_text,
        cleaned_source_text,
    )
    return calculate_accuracy_metrics(aligned_reference, aligned_source), alignment_applied


def _collect_source_metrics(
    reference_text: str,
    djvu_text: str,
    abbyy_text: str | None,
) -> dict[str, dict[str, float | int | bool]]:
    djvu_metrics, djvu_aligned = _score_source(reference_text, djvu_text)
    source_metrics: dict[str, dict[str, float | int | bool]] = {
        "djvu": {**djvu_metrics, "alignment_applied": djvu_aligned}
    }
    if abbyy_text:
        abbyy_metrics, abbyy_aligned = _score_source(reference_text, abbyy_text)
        source_metrics["abbyy"] = {**abbyy_metrics, "alignment_applied": abbyy_aligned}
    return source_metrics


def _select_source_metrics(
    source_mode: str,
    source_metrics: dict[str, dict[str, float | int | bool]],
    identifier: str,
) -> tuple[str, dict[str, float | int | bool]]:
    if source_mode == "best":
        return min(
            source_metrics.items(),
            key=lambda item: (float(item[1]["wer"]), float(item[1]["cer"])),
        )
    if source_mode == "abbyy":
        if "abbyy" not in source_metrics:
            raise ValueError(
                "source_mode='abbyy' requested but no ABBYY OCR is available for "
                f"{identifier}"
            )
        return "abbyy", source_metrics["abbyy"]
    return "djvu", source_metrics["djvu"]


def _build_book_result(
    book: BenchmarkBook,
    raw_metrics: dict[str, float | int],
    source_metrics: dict[str, dict[str, float | int | bool]],
    selected_source: str,
    selected_metrics: dict[str, float | int | bool],
) -> dict[str, Any]:
    return {
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


def _average_metric(results: list[dict[str, Any]], key: str) -> float:
    return sum(float(item[key]) for item in results) / len(results)


def _count_selected_sources(results: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in results:
        name = str(item["selected_source"])
        counts[name] = counts.get(name, 0) + 1
    return counts


def _build_summary(results: list[dict[str, Any]], source_mode: str) -> dict[str, Any]:
    avg_cer = _average_metric(results, "cer")
    avg_wer = _average_metric(results, "wer")
    avg_raw_cer = _average_metric(results, "raw_cer")
    avg_raw_wer = _average_metric(results, "raw_wer")
    return {
        "book_count": len(results),
        "source_mode": source_mode,
        "selected_source_counts": _count_selected_sources(results),
        "avg_cer": avg_cer,
        "avg_wer": avg_wer,
        "avg_char_accuracy": max(0.0, 1.0 - avg_cer),
        "avg_word_accuracy": max(0.0, 1.0 - avg_wer),
        "avg_raw_cer": avg_raw_cer,
        "avg_raw_wer": avg_raw_wer,
        "avg_raw_char_accuracy": max(0.0, 1.0 - avg_raw_cer),
        "avg_raw_word_accuracy": max(0.0, 1.0 - avg_raw_wer),
        "avg_cer_proxy": avg_cer,
        "avg_wer_proxy": avg_wer,
        "avg_char_accuracy_proxy": max(0.0, 1.0 - avg_cer),
        "avg_word_accuracy_proxy": max(0.0, 1.0 - avg_wer),
        "avg_raw_cer_proxy": avg_raw_cer,
        "avg_raw_wer_proxy": avg_raw_wer,
        "avg_raw_char_accuracy_proxy": max(0.0, 1.0 - avg_raw_cer),
        "avg_raw_word_accuracy_proxy": max(0.0, 1.0 - avg_raw_wer),
    }


def run_archive_benchmark(
    cache_dir: Path,
    timeout_seconds: int = 60,
    books: tuple[BenchmarkBook, ...] = BENCHMARK_BOOKS,
    source_mode: str = "djvu",
) -> dict[str, Any]:
    """Run OCR-vs-reference metrics for curated books and return a report payload."""

    if source_mode not in {"djvu", "abbyy", "best"}:
        raise ValueError("source_mode must be one of: djvu, abbyy, best")

    results = [
        _benchmark_book(book, cache_dir, timeout_seconds, source_mode)
        for book in books
    ]

    summary = _build_summary(results, source_mode)
    return {
        "metric_note": (
            "CER/WER are true edit-distance scores on normalized text samples. "
            "Benchmark applies OCR cleanup and shared-ngram alignment against "
            "Project Gutenberg references; source selection is controlled by source_mode."
        ),
        "books": results,
        "summary": summary,
    }


def _benchmark_book(
    book: BenchmarkBook,
    cache_dir: Path,
    timeout_seconds: int,
    source_mode: str,
) -> dict[str, Any]:
    paths = _book_paths(cache_dir, book)
    djvu_text = load_or_fetch_text(
        paths.archive_path,
        lambda book=book: _fetch_djvu_text(book, timeout_seconds),
    )
    abbyy_text = load_or_fetch_optional_text(
        paths.abbyy_path,
        lambda book=book: _fetch_abbyy_text(book, timeout_seconds),
    )
    gutenberg_text = load_or_fetch_text(
        paths.gutenberg_path,
        lambda book=book: _fetch_gutenberg(book, timeout_seconds),
    )
    reference_text = strip_gutenberg_boilerplate(gutenberg_text)
    raw_metrics = calculate_accuracy_metrics(reference_text, djvu_text)
    source_metrics = _collect_source_metrics(reference_text, djvu_text, abbyy_text)
    selected_source, selected_metrics = _select_source_metrics(
        source_mode,
        source_metrics,
        book.identifier,
    )
    return _build_book_result(
        book,
        raw_metrics,
        source_metrics,
        selected_source,
        selected_metrics,
    )


def write_benchmark_report(path: Path, report: dict[str, Any]) -> None:
    """Write benchmark report JSON to disk."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
