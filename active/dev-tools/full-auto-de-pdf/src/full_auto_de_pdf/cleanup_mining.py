"""Automated synthetic cleanup mining for OCR-like text corruptions."""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import re
from typing import Any

from .ocr_cleanup import (
    _BUILTIN_LEXICON,
    _CONFUSABLE_SUBSTITUTIONS,
    _KNOWN_JOIN_PAIRS,
    _KNOWN_JOIN_TARGETS,
    cleanup_ocr_text,
)

_WORD_RE = re.compile(r"\b[A-Za-z']+\b")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _match_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper():
        return replacement.capitalize()
    return replacement


def _replace_match(text: str, match: re.Match[str], replacement: str) -> str:
    return text[: match.start()] + replacement + text[match.end() :]


def _is_likely_proper_noun(
    word: str,
    *,
    token_index: int,
    lowercase_words: set[str],
) -> bool:
    if not word[:1].isupper():
        return False
    if word.isupper():
        return True
    if token_index != 0:
        return True
    return word.lower() not in lowercase_words


def _iter_sentence_cases(
    sentence: str,
    *,
    max_words_per_sentence: int,
) -> list[dict[str, Any]]:
    matches = list(_WORD_RE.finditer(sentence))
    words = [match.group(0) for match in matches]
    lowered = [word.lower() for word in words]
    cases: list[dict[str, Any]] = []

    seen_join_targets: set[str] = set()
    for index, lowered_word in enumerate(lowered):
        pair = _JOIN_TARGET_TO_PAIR.get(lowered_word)
        if pair is None or lowered_word in seen_join_targets:
            continue
        seen_join_targets.add(lowered_word)
        replacement = _match_case(words[index], f"{pair[0]} {pair[1]}")
        corrupted = _replace_match(sentence, matches[index], replacement)
        cases.append(
            {
                "case_type": "join",
                "rule": "known-join",
                "target": lowered_word,
                "corrupted_word": replacement,
                "corrupted_text": corrupted,
                "source_word": words[index],
                "token_index": index,
            }
        )

    for token_index, (match, word) in enumerate(list(zip(matches, words))[:max_words_per_sentence]):
        lowered_word = word.lower().strip("'")
        if len(lowered_word) < 4 or not lowered_word.isalpha():
            continue
        for original, replacement in _CONFUSABLE_SUBSTITUTIONS:
            replace_index = lowered_word.find(original)
            if replace_index < 0:
                continue
            corrupted_word = (
                lowered_word[:replace_index]
                + replacement
                + lowered_word[replace_index + len(original) :]
            )
            if corrupted_word == lowered_word or not corrupted_word.isalpha():
                continue
            corrupted = _replace_match(sentence, match, _match_case(word, corrupted_word))
            cases.append(
                {
                    "case_type": "confusable",
                    "rule": f"{original}->{replacement}",
                    "target": lowered_word,
                    "corrupted_word": corrupted_word,
                    "corrupted_text": corrupted,
                    "source_word": word,
                    "token_index": token_index,
                }
            )
            break
    return cases


def _rule_rows(counter: Counter[str], *, max_rows: int) -> list[dict[str, Any]]:
    return [{"rule": rule, "count": count} for rule, count in counter.most_common(max_rows)]


def _summary_rows_from_target_counter(counter: Counter[str], *, max_rows: int) -> list[dict[str, Any]]:
    return [{"target": target, "count": count} for target, count in counter.most_common(max_rows)]


def _load_cached_books(cache_dir: Path, *, max_books: int | None) -> list[Path]:
    if not cache_dir.exists():
        raise FileNotFoundError(f"Cache directory not found: {cache_dir}")
    cached_books = sorted(cache_dir.glob("pg*_gutenberg.txt"))
    if not cached_books:
        raise FileNotFoundError(f"No cached Gutenberg texts found under {cache_dir}")
    if max_books is not None:
        return cached_books[:max_books]
    return cached_books


def mine_cleanup_corpus(
    cache_dir: Path,
    output_report_path: Path,
    *,
    max_books: int | None = None,
    max_sentences_per_book: int = 120,
    sentence_min_chars: int = 40,
    sentence_max_chars: int = 180,
    max_words_per_sentence: int = 8,
    max_examples: int = 50,
    candidate_min_failures: int = 2,
) -> dict[str, Any]:
    """Mine OCR cleanup misses from cached public-domain corpus text."""

    if max_sentences_per_book <= 0:
        raise ValueError("max_sentences_per_book must be greater than 0")
    if sentence_min_chars <= 0:
        raise ValueError("sentence_min_chars must be greater than 0")
    if sentence_max_chars < sentence_min_chars:
        raise ValueError("sentence_max_chars must be at least sentence_min_chars")
    if max_words_per_sentence <= 0:
        raise ValueError("max_words_per_sentence must be greater than 0")
    if max_examples <= 0:
        raise ValueError("max_examples must be greater than 0")
    if candidate_min_failures <= 0:
        raise ValueError("candidate_min_failures must be greater than 0")

    books = _load_cached_books(cache_dir, max_books=max_books)
    all_cases = 0
    failure_count = 0
    join_case_count = 0
    confusable_case_count = 0
    join_failure_count = 0
    confusable_failure_count = 0
    lowercase_failure_count = 0
    proper_noun_failure_count = 0
    failure_rules = Counter[str]()
    failure_targets = Counter[str]()
    lowercase_failure_targets = Counter[str]()
    proper_noun_failure_targets = Counter[str]()
    sample_failures: list[dict[str, Any]] = []

    for book_path in books:
        text = book_path.read_text(encoding="utf-8", errors="ignore")
        lowercase_words = {
            match.group(0)
            for match in _WORD_RE.finditer(text)
            if match.group(0).islower()
        }
        sentences = [
            sentence.strip().replace("\n", " ")
            for sentence in _SENTENCE_SPLIT_RE.split(text)
            if sentence_min_chars <= len(sentence.strip()) <= sentence_max_chars
        ][:max_sentences_per_book]
        for sentence in sentences:
            for case in _iter_sentence_cases(sentence, max_words_per_sentence=max_words_per_sentence):
                all_cases += 1
                if case["case_type"] == "join":
                    join_case_count += 1
                else:
                    confusable_case_count += 1
                cleaned = cleanup_ocr_text(str(case["corrupted_text"]))
                cleaned_tokens = {token.lower() for token in _WORD_RE.findall(cleaned)}
                target = str(case["target"])
                if target in cleaned_tokens:
                    continue
                failure_count += 1
                if case["case_type"] == "join":
                    join_failure_count += 1
                else:
                    confusable_failure_count += 1
                proper_noun = _is_likely_proper_noun(
                    str(case["source_word"]),
                    token_index=int(case["token_index"]),
                    lowercase_words=lowercase_words,
                )
                if proper_noun:
                    proper_noun_failure_count += 1
                    proper_noun_failure_targets[target] += 1
                else:
                    lowercase_failure_count += 1
                    lowercase_failure_targets[target] += 1
                failure_rules[str(case["rule"])] += 1
                failure_targets[target] += 1
                if len(sample_failures) < max_examples:
                    sample_failures.append(
                        {
                            "case_type": case["case_type"],
                            "rule": case["rule"],
                            "target": target,
                            "corrupted_word": case["corrupted_word"],
                            "source_word": case["source_word"],
                            "proper_noun": proper_noun,
                            "source_book": book_path.name,
                            "sentence": sentence,
                            "corrupted_text": case["corrupted_text"],
                            "cleaned_text": cleaned,
                        }
                    )

    candidate_builtin_lexicon_additions = [
        target
        for target, count in lowercase_failure_targets.most_common()
        if count >= candidate_min_failures and target not in _BUILTIN_LEXICON and target not in _KNOWN_JOIN_TARGETS
    ]

    report = {
        "cache_dir": str(cache_dir),
        "config": {
            "max_books": max_books,
            "max_sentences_per_book": max_sentences_per_book,
            "sentence_min_chars": sentence_min_chars,
            "sentence_max_chars": sentence_max_chars,
            "max_words_per_sentence": max_words_per_sentence,
            "max_examples": max_examples,
            "candidate_min_failures": candidate_min_failures,
        },
        "books": [str(book_path.name) for book_path in books],
        "summary": {
            "book_count": len(books),
            "case_count": all_cases,
            "failure_count": failure_count,
            "join_case_count": join_case_count,
            "confusable_case_count": confusable_case_count,
            "join_failure_count": join_failure_count,
            "confusable_failure_count": confusable_failure_count,
            "lowercase_failure_count": lowercase_failure_count,
            "proper_noun_failure_count": proper_noun_failure_count,
            "top_failure_rules": _rule_rows(failure_rules, max_rows=20),
            "top_failure_targets": _summary_rows_from_target_counter(failure_targets, max_rows=20),
            "top_lowercase_failure_targets": _summary_rows_from_target_counter(
                lowercase_failure_targets,
                max_rows=20,
            ),
            "top_proper_noun_failure_targets": _summary_rows_from_target_counter(
                proper_noun_failure_targets,
                max_rows=20,
            ),
            "candidate_builtin_lexicon_additions": candidate_builtin_lexicon_additions,
        },
        "sample_failures": sample_failures,
    }
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


_JOIN_TARGET_TO_PAIR = {target: pair for pair, target in _KNOWN_JOIN_PAIRS.items()}
