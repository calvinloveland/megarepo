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
    cases = _join_sentence_cases(sentence, matches, words, lowered)
    cases.extend(
        _confusable_sentence_cases(
            sentence,
            matches,
            words,
            max_words_per_sentence=max_words_per_sentence,
        )
    )
    return cases


def _join_sentence_cases(
    sentence: str,
    matches: list[re.Match[str]],
    words: list[str],
    lowered: list[str],
) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    seen_join_targets: set[str] = set()
    for index, lowered_word in enumerate(lowered):
        pair = _JOIN_TARGET_TO_PAIR.get(lowered_word)
        if pair is None or lowered_word in seen_join_targets:
            continue
        seen_join_targets.add(lowered_word)
        replacement = _match_case(words[index], f"{pair[0]} {pair[1]}")
        cases.append(
            _sentence_case(
                case_type="join",
                rule="known-join",
                target=lowered_word,
                corrupted_word=replacement,
                corrupted_text=_replace_match(sentence, matches[index], replacement),
                source_word=words[index],
                token_index=index,
            )
        )
    return cases


def _confusable_sentence_cases(
    sentence: str,
    matches: list[re.Match[str]],
    words: list[str],
    *,
    max_words_per_sentence: int,
) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for token_index, (match, word) in enumerate(list(zip(matches, words))[:max_words_per_sentence]):
        candidate = _confusable_sentence_case(sentence, match, word, token_index=token_index)
        if candidate is not None:
            cases.append(candidate)
    return cases


def _confusable_sentence_case(
    sentence: str,
    match: re.Match[str],
    word: str,
    *,
    token_index: int,
) -> dict[str, Any] | None:
    lowered_word = word.lower().strip("'")
    if len(lowered_word) < 4 or not lowered_word.isalpha():
        return None
    for original, replacement in _CONFUSABLE_SUBSTITUTIONS:
        corrupted_word = _confusable_replacement(lowered_word, original, replacement)
        if corrupted_word is None:
            continue
        return _sentence_case(
            case_type="confusable",
            rule=f"{original}->{replacement}",
            target=lowered_word,
            corrupted_word=corrupted_word,
            corrupted_text=_replace_match(sentence, match, _match_case(word, corrupted_word)),
            source_word=word,
            token_index=token_index,
        )
    return None


def _confusable_replacement(
    lowered_word: str,
    original: str,
    replacement: str,
) -> str | None:
    replace_index = lowered_word.find(original)
    if replace_index < 0:
        return None
    candidate = (
        lowered_word[:replace_index]
        + replacement
        + lowered_word[replace_index + len(original) :]
    )
    if candidate == lowered_word or not candidate.isalpha():
        return None
    return candidate


def _sentence_case(
    *,
    case_type: str,
    rule: str,
    target: str,
    corrupted_word: str,
    corrupted_text: str,
    source_word: str,
    token_index: int,
) -> dict[str, Any]:
    return {
        "case_type": case_type,
        "rule": rule,
        "target": target,
        "corrupted_word": corrupted_word,
        "corrupted_text": corrupted_text,
        "source_word": source_word,
        "token_index": token_index,
    }


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


def _validate_mining_args(
    *,
    max_sentences_per_book: int,
    sentence_min_chars: int,
    sentence_max_chars: int,
    max_words_per_sentence: int,
    max_examples: int,
    candidate_min_failures: int,
) -> None:
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


def _lowercase_words(text: str) -> set[str]:
    return {
        match.group(0)
        for match in _WORD_RE.finditer(text)
        if match.group(0).islower()
    }


def _candidate_sentences(
    text: str,
    *,
    sentence_min_chars: int,
    sentence_max_chars: int,
    max_sentences_per_book: int,
) -> list[str]:
    return [
        sentence.strip().replace("\n", " ")
        for sentence in _SENTENCE_SPLIT_RE.split(text)
        if sentence_min_chars <= len(sentence.strip()) <= sentence_max_chars
    ][:max_sentences_per_book]


def _empty_mining_counters() -> dict[str, Any]:
    return {
        "all_cases": 0,
        "failure_count": 0,
        "join_case_count": 0,
        "confusable_case_count": 0,
        "join_failure_count": 0,
        "confusable_failure_count": 0,
        "lowercase_failure_count": 0,
        "proper_noun_failure_count": 0,
        "failure_rules": Counter[str](),
        "failure_targets": Counter[str](),
        "lowercase_failure_targets": Counter[str](),
        "proper_noun_failure_targets": Counter[str](),
        "sample_failures": [],
    }


def _process_mining_case(
    *,
    case: dict[str, Any],
    sentence: str,
    book_path: Path,
    lowercase_words: set[str],
    max_examples: int,
    counters: dict[str, Any],
) -> None:
    counters["all_cases"] += 1
    _increment_case_type_count(counters, str(case["case_type"]))
    cleaned = cleanup_ocr_text(str(case["corrupted_text"]))
    target = str(case["target"])
    cleaned_tokens = {token.lower() for token in _WORD_RE.findall(cleaned)}
    if target in cleaned_tokens:
        return
    counters["failure_count"] += 1
    _increment_failure_case_type_count(counters, str(case["case_type"]))
    proper_noun = _is_likely_proper_noun(
        str(case["source_word"]),
        token_index=int(case["token_index"]),
        lowercase_words=lowercase_words,
    )
    _record_failure_target(counters, target, proper_noun=proper_noun)
    counters["failure_rules"][str(case["rule"])] += 1
    counters["failure_targets"][target] += 1
    _append_sample_failure(
        counters["sample_failures"],
        case=case,
        sentence=sentence,
        cleaned=cleaned,
        source_book=book_path.name,
        proper_noun=proper_noun,
        max_examples=max_examples,
    )


def _increment_case_type_count(counters: dict[str, Any], case_type: str) -> None:
    if case_type == "join":
        counters["join_case_count"] += 1
    else:
        counters["confusable_case_count"] += 1


def _increment_failure_case_type_count(counters: dict[str, Any], case_type: str) -> None:
    if case_type == "join":
        counters["join_failure_count"] += 1
    else:
        counters["confusable_failure_count"] += 1


def _record_failure_target(
    counters: dict[str, Any],
    target: str,
    *,
    proper_noun: bool,
) -> None:
    if proper_noun:
        counters["proper_noun_failure_count"] += 1
        counters["proper_noun_failure_targets"][target] += 1
        return
    counters["lowercase_failure_count"] += 1
    counters["lowercase_failure_targets"][target] += 1


def _append_sample_failure(
    sample_failures: list[dict[str, Any]],
    *,
    case: dict[str, Any],
    sentence: str,
    cleaned: str,
    source_book: str,
    proper_noun: bool,
    max_examples: int,
) -> None:
    if len(sample_failures) >= max_examples:
        return
    sample_failures.append(
        {
            "case_type": case["case_type"],
            "rule": case["rule"],
            "target": case["target"],
            "corrupted_word": case["corrupted_word"],
            "source_word": case["source_word"],
            "proper_noun": proper_noun,
            "source_book": source_book,
            "sentence": sentence,
            "corrupted_text": case["corrupted_text"],
            "cleaned_text": cleaned,
        }
    )


def _candidate_builtin_lexicon_additions(
    lowercase_failure_targets: Counter[str],
    *,
    candidate_min_failures: int,
) -> list[str]:
    return [
        target
        for target, count in lowercase_failure_targets.most_common()
        if count >= candidate_min_failures and target not in _BUILTIN_LEXICON and target not in _KNOWN_JOIN_TARGETS
    ]


def _build_mining_report(
    *,
    cache_dir: Path,
    books: list[Path],
    max_books: int | None,
    max_sentences_per_book: int,
    sentence_min_chars: int,
    sentence_max_chars: int,
    max_words_per_sentence: int,
    max_examples: int,
    candidate_min_failures: int,
    counters: dict[str, Any],
) -> dict[str, Any]:
    return {
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
            "case_count": counters["all_cases"],
            "failure_count": counters["failure_count"],
            "join_case_count": counters["join_case_count"],
            "confusable_case_count": counters["confusable_case_count"],
            "join_failure_count": counters["join_failure_count"],
            "confusable_failure_count": counters["confusable_failure_count"],
            "lowercase_failure_count": counters["lowercase_failure_count"],
            "proper_noun_failure_count": counters["proper_noun_failure_count"],
            "top_failure_rules": _rule_rows(counters["failure_rules"], max_rows=20),
            "top_failure_targets": _summary_rows_from_target_counter(
                counters["failure_targets"], max_rows=20
            ),
            "top_lowercase_failure_targets": _summary_rows_from_target_counter(
                counters["lowercase_failure_targets"],
                max_rows=20,
            ),
            "top_proper_noun_failure_targets": _summary_rows_from_target_counter(
                counters["proper_noun_failure_targets"],
                max_rows=20,
            ),
            "candidate_builtin_lexicon_additions": _candidate_builtin_lexicon_additions(
                counters["lowercase_failure_targets"],
                candidate_min_failures=candidate_min_failures,
            ),
        },
        "sample_failures": counters["sample_failures"],
    }


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

    _validate_mining_args(
        max_sentences_per_book=max_sentences_per_book,
        sentence_min_chars=sentence_min_chars,
        sentence_max_chars=sentence_max_chars,
        max_words_per_sentence=max_words_per_sentence,
        max_examples=max_examples,
        candidate_min_failures=candidate_min_failures,
    )

    books = _load_cached_books(cache_dir, max_books=max_books)
    counters = _empty_mining_counters()

    for book_path in books:
        text = book_path.read_text(encoding="utf-8", errors="ignore")
        lowercase_words = _lowercase_words(text)
        sentences = _candidate_sentences(
            text,
            sentence_min_chars=sentence_min_chars,
            sentence_max_chars=sentence_max_chars,
            max_sentences_per_book=max_sentences_per_book,
        )
        for sentence in sentences:
            for case in _iter_sentence_cases(sentence, max_words_per_sentence=max_words_per_sentence):
                _process_mining_case(
                    case=case,
                    sentence=sentence,
                    book_path=book_path,
                    lowercase_words=lowercase_words,
                    max_examples=max_examples,
                    counters=counters,
                )

    report = _build_mining_report(
        cache_dir=cache_dir,
        books=books,
        max_books=max_books,
        max_sentences_per_book=max_sentences_per_book,
        sentence_min_chars=sentence_min_chars,
        sentence_max_chars=sentence_max_chars,
        max_words_per_sentence=max_words_per_sentence,
        max_examples=max_examples,
        candidate_min_failures=candidate_min_failures,
        counters=counters,
    )
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


_JOIN_TARGET_TO_PAIR = {target: pair for pair, target in _KNOWN_JOIN_PAIRS.items()}
