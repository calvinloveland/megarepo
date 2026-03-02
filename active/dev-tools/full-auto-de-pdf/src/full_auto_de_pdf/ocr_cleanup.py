"""OCR text cleanup and lightweight correction heuristics."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import re
import unicodedata

_UNICODE_REPLACEMENTS = {
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬀ": "ff",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "’": "'",
    "‘": "'",
    "“": '"',
    "”": '"',
    "—": "-",
    "–": "-",
    "…": "...",
}

_PAGE_NUMBER_LINE = re.compile(r"^[\s\divxlcdmIVXLCDM\-\.\[\]\(\)]{1,12}$")
_LINE_ART_LINE = re.compile(r"^[\s\\/_|+=*#~`^]{3,}$")
_BROKEN_HYPHEN = re.compile(r"([A-Za-z])-\n([a-z])")
_WORD_TOKEN = re.compile(r"\b[A-Za-z]{4,}\b")
_WORD_WITH_MARKS = re.compile(r"[A-Za-z0-9']+")
_CONTEXT_TOKEN = _WORD_WITH_MARKS
_HARD_CONTEXT_BREAK = re.compile(r"[.!?;:\n]")
_ROMAN_WORD = re.compile(r"^[ivxlcdm]+$")
_LOWER_ALPHA = "abcdefghijklmnopqrstuvwxyz"
_TOC_HINT = re.compile(r"^\s*(contents?|chapter|book|appendix|part)\b", flags=re.IGNORECASE)
_MIN_ERROR_OCCURRENCES = 2
_MAX_ERROR_OCCURRENCES = 2
_MIN_CORRECTION_OCCURRENCES = 5
_MIN_CORRECTION_RATIO = 2.5
_MIN_BEST_CANDIDATE_MARGIN = 1.5
_MIN_DISTINCT_WORDS_PER_CHAR = 3
_MIN_DISTINCT_WORDS_PER_SIGNATURE = 1
_MAX_TOTAL_CORRECTIONS = 30
_CONTEXT_MIN_TARGET_SCORE = 2
_CONTEXT_REQUIRED_MARGIN = 0
_MIN_APOSTROPHE_ERROR_OCCURRENCES = 1
_MAX_TOTAL_APOSTROPHE_CORRECTIONS = 20
_AMBIGUOUS_APOSTROPHE_TARGETS = {
    "can": "can't",
}
_MIN_AMBIGUOUS_APOSTROPHE_TARGET_OCCURRENCES = 5
_MIN_AMBIGUOUS_APOSTROPHE_RATIO = 0.5
_MAX_AMBIGUOUS_APOSTROPHE_SOURCE_LENGTH = 5
_MIN_DIGIT_ERROR_OCCURRENCES = 1
_MAX_TOTAL_DIGIT_CORRECTIONS = 3


@dataclass(frozen=True)
class _MissingCharSupport:
    provisional: dict[str, tuple[str, str, tuple[str, str, str], float]]
    char_word_support: dict[str, set[str]]
    signature_word_support: dict[tuple[str, str, str], set[str]]


@dataclass(frozen=True)
class _ContextWindow:
    text: str
    matches: list[re.Match[str]]
    words: list[str]
    bigram_counts: Counter[tuple[str, str]]


def _candidate_insertions(word: str) -> list[tuple[int, str, str]]:
    candidates: list[tuple[int, str, str]] = []
    for index in range(1, len(word)):
        for char in _LOWER_ALPHA:
            candidate = word[:index] + char + word[index:]
            candidates.append((index, char, candidate))
    return candidates


def _acceptable_missing_char_candidate(source_word: str, candidate: str) -> bool:
    return candidate[:1] == source_word[:1] and candidate[-2:] == source_word[-2:]


def _should_consider_missing_char_word(word: str, word_count: int) -> bool:
    if _ROMAN_WORD.fullmatch(word):
        return False
    if word_count < _MIN_ERROR_OCCURRENCES:
        return False
    return word_count <= _MAX_ERROR_OCCURRENCES


def _passes_missing_char_thresholds(
    word_count: int,
    best_candidate_count: int,
    second_best_count: int,
) -> bool:
    if best_candidate_count < int(word_count * _MIN_CORRECTION_RATIO):
        return False
    if second_best_count == 0:
        return True
    ratio = best_candidate_count / second_best_count
    return ratio >= _MIN_BEST_CANDIDATE_MARGIN


def _match_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper() and source[1:].islower():
        return replacement.capitalize()
    return replacement


def _extract_word_counts(text: str) -> Counter[str]:
    return Counter(token.lower() for token in _WORD_TOKEN.findall(text))


def _extract_token_counts(text: str) -> Counter[str]:
    return Counter(token.lower() for token in _WORD_WITH_MARKS.findall(text))


def _is_toc_like_line(line: str) -> bool:
    lowered = line.lower()
    has_digit = any(char.isdigit() for char in lowered)
    chapter_hits = lowered.count("chapter")
    if _TOC_HINT.search(line) and has_digit:
        return True
    if chapter_hits >= 1 and has_digit:
        return True
    if has_digit and ("contents" in lowered or "diary" in lowered) and len(lowered.split()) >= 3:
        return True
    return False


def _best_missing_char_variant(
    word: str, word_count: int, counts: Counter[str]
) -> tuple[str, str, int, int] | None:
    best_candidate: str | None = None
    best_candidate_count = 0
    second_best_count = 0
    best_missing_char = ""
    best_index = -1
    for index, char, candidate in _candidate_insertions(word):
        if not _acceptable_missing_char_candidate(word, candidate):
            continue
        candidate_count = counts.get(candidate, 0)
        if candidate_count < _MIN_CORRECTION_OCCURRENCES:
            continue
        if candidate_count > best_candidate_count:
            second_best_count = best_candidate_count
            best_candidate = candidate
            best_candidate_count = candidate_count
            best_missing_char = char
            best_index = index
        elif candidate_count > second_best_count:
            second_best_count = candidate_count
    if best_candidate is None:
        return None
    if not _passes_missing_char_thresholds(word_count, best_candidate_count, second_best_count):
        return None
    return best_candidate, best_missing_char, best_index, best_candidate_count


def _insertion_signature(
    source_word: str,
    insertion_index: int,
    missing_char: str,
) -> tuple[str, str, str]:
    previous_char = source_word[insertion_index - 1] if insertion_index > 0 else "^"
    next_char = source_word[insertion_index] if insertion_index < len(source_word) else "$"
    return missing_char, previous_char, next_char


def _infer_missing_char_corrections(text: str) -> dict[str, str]:
    counts = _extract_word_counts(text)
    support = _collect_missing_char_support(counts)
    supported_chars = _supported_missing_chars(support.char_word_support)
    if not supported_chars:
        return {}
    ranked_candidates = _rank_missing_char_candidates(support, supported_chars)
    if not ranked_candidates:
        return {}
    return _top_corrections(ranked_candidates, _MAX_TOTAL_CORRECTIONS)


def _supported_missing_chars(char_word_support: dict[str, set[str]]) -> set[str]:
    return {
        char
        for char, words in char_word_support.items()
        if len(words) >= _MIN_DISTINCT_WORDS_PER_CHAR
    }


def _rank_missing_char_candidates(
    support: _MissingCharSupport,
    supported_chars: set[str],
) -> list[tuple[str, str, float]]:
    ranked_candidates: list[tuple[str, str, float]] = []
    for source, (corrected, missing_char, signature, score) in support.provisional.items():
        if missing_char not in supported_chars:
            continue
        signature_support = len(support.signature_word_support[signature])
        if signature_support < _MIN_DISTINCT_WORDS_PER_SIGNATURE:
            continue
        char_support = len(support.char_word_support[missing_char])
        total_score = score + (float(char_support) * 25.0) + (float(signature_support) * 60.0)
        ranked_candidates.append((source, corrected, total_score))
    return ranked_candidates


def _top_corrections(
    ranked_candidates: list[tuple[str, str, float]],
    limit: int,
) -> dict[str, str]:
    ranked_candidates.sort(key=lambda item: item[2], reverse=True)
    selected = ranked_candidates[:limit]
    return {source: corrected for source, corrected, _score in selected}


def _collect_missing_char_support(counts: Counter[str]) -> _MissingCharSupport:
    provisional: dict[str, tuple[str, str, tuple[str, str, str], float]] = {}
    char_word_support: dict[str, set[str]] = defaultdict(set)
    signature_word_support: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for word, word_count in counts.items():
        if not _should_consider_missing_char_word(word, word_count):
            continue
        variant = _best_missing_char_variant(word, word_count, counts)
        if variant is None:
            continue
        corrected_word, missing_char, insertion_index, corrected_count = variant
        signature = _insertion_signature(word, insertion_index, missing_char)
        score = (
            (float(corrected_count) / float(max(word_count, 1))) * 1000.0
            + float(corrected_count)
        )
        provisional[word] = (corrected_word, missing_char, signature, score)
        char_word_support[missing_char].add(word)
        signature_word_support[signature].add(word)
    return _MissingCharSupport(
        provisional=provisional,
        char_word_support=char_word_support,
        signature_word_support=signature_word_support,
    )


def _infer_apostrophe_corrections(text: str) -> dict[str, str]:
    counts = _extract_token_counts(text)
    candidates: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if "'" in source:
            continue
        if source_count < _MIN_APOSTROPHE_ERROR_OCCURRENCES:
            continue
        if source_count > _MAX_ERROR_OCCURRENCES:
            continue
        best_target, best_target_count = _best_apostrophe_target(source, counts)
        if not best_target:
            continue
        if best_target_count < int(source_count * _MIN_CORRECTION_RATIO):
            continue
        score = (
            (float(best_target_count) / float(source_count)) * 1000.0
            + float(best_target_count)
        )
        candidates.append((source, best_target, score))

    candidates.sort(key=lambda item: item[2], reverse=True)
    selected = candidates[:_MAX_TOTAL_APOSTROPHE_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _apostrophe_proposals(source: str) -> list[str]:
    proposals = [
        source + "'s",
        source + "'d",
        source + "'re",
        source + "'ll",
        source + "'ve",
        source + "'m",
    ]
    if source.endswith("n"):
        proposals.append(source + "'t")
    return proposals


def _best_apostrophe_target(source: str, counts: Counter[str]) -> tuple[str, int]:
    best_target = ""
    best_target_count = 0
    for target in _apostrophe_proposals(source):
        target_count = counts.get(target, 0)
        if target_count < _MIN_CORRECTION_OCCURRENCES:
            continue
        if target_count > best_target_count:
            best_target = target
            best_target_count = target_count
    return best_target, best_target_count


def _infer_contextual_apostrophe_corrections(text: str) -> dict[str, str]:
    counts = _extract_token_counts(text)
    corrections: dict[str, str] = {}
    for source, target in _AMBIGUOUS_APOSTROPHE_TARGETS.items():
        if len(source) > _MAX_AMBIGUOUS_APOSTROPHE_SOURCE_LENGTH:
            continue
        source_count = counts.get(source, 0)
        target_count = counts.get(target, 0)
        if source_count < _MIN_APOSTROPHE_ERROR_OCCURRENCES:
            continue
        if target_count < _MIN_AMBIGUOUS_APOSTROPHE_TARGET_OCCURRENCES:
            continue
        ratio = float(target_count) / float(max(source_count, 1))
        if ratio < _MIN_AMBIGUOUS_APOSTROPHE_RATIO:
            continue
        corrections[source] = target
    return corrections


def _infer_digit_letter_corrections(text: str) -> dict[str, str]:
    counts = _extract_token_counts(text)
    corrections: dict[str, str] = {}
    digit_one_count = counts.get("1", 0)
    letter_i_count = counts.get("i", 0)
    if (
        digit_one_count >= _MIN_DIGIT_ERROR_OCCURRENCES
        and letter_i_count >= _MIN_CORRECTION_OCCURRENCES
    ):
        corrections["1"] = "i"
    if len(corrections) > _MAX_TOTAL_DIGIT_CORRECTIONS:
        return {}
    return corrections


def _apply_word_corrections(text: str, corrections: dict[str, str]) -> str:
    if not corrections:
        return text
    matches = list(_CONTEXT_TOKEN.finditer(text))
    if not matches:
        return text

    words = [match.group(0).lower() for match in matches]
    bigram_counts: Counter[tuple[str, str]] = Counter(zip(words, words[1:]))
    context = _ContextWindow(
        text=text,
        matches=matches,
        words=words,
        bigram_counts=bigram_counts,
    )
    replacements = _collect_contextual_replacements(context, corrections)

    if not replacements:
        return text

    return _apply_replacements(text, replacements)


def _collect_contextual_replacements(
    context: _ContextWindow,
    corrections: dict[str, str],
) -> list[tuple[int, int, str]]:
    replacements: list[tuple[int, int, str]] = []
    for index, match in enumerate(context.matches):
        source_word = context.words[index]
        target_word = corrections.get(source_word)
        if target_word is None:
            continue
        source_score, target_score = _context_scores(
            context,
            index,
            source_word,
            target_word,
        )
        if not _should_replace_from_scores(source_score, target_score):
            continue
        replacement = _match_case(match.group(0), target_word)
        replacements.append((match.start(), match.end(), replacement))
    return replacements


def _context_scores(
    context: _ContextWindow,
    index: int,
    source_word: str,
    target_word: str,
) -> tuple[int, int]:
    source_score = 0
    target_score = 0
    if index > 0:
        between_prev = context.text[
            context.matches[index - 1].end() : context.matches[index].start()
        ]
        if not _HARD_CONTEXT_BREAK.search(between_prev):
            previous_word = context.words[index - 1]
            source_score += context.bigram_counts[(previous_word, source_word)]
            target_score += context.bigram_counts[(previous_word, target_word)]
    if index + 1 < len(context.words):
        between_next = context.text[
            context.matches[index].end() : context.matches[index + 1].start()
        ]
        if not _HARD_CONTEXT_BREAK.search(between_next):
            next_word = context.words[index + 1]
            source_score += context.bigram_counts[(source_word, next_word)]
            target_score += context.bigram_counts[(target_word, next_word)]
    return source_score, target_score


def _should_replace_from_scores(source_score: int, target_score: int) -> bool:
    if source_score == 0 and target_score == 0:
        return False
    if target_score < _CONTEXT_MIN_TARGET_SCORE:
        return False
    return target_score >= source_score + _CONTEXT_REQUIRED_MARGIN


def _apply_replacements(text: str, replacements: list[tuple[int, int, str]]) -> str:
    chunks: list[str] = []
    cursor = 0
    for start, end, replacement in replacements:
        chunks.append(text[cursor:start])
        chunks.append(replacement)
        cursor = end
    chunks.append(text[cursor:])
    return "".join(chunks)


def cleanup_ocr_text(text: str) -> str:
    """Normalize OCR text and apply conservative word-level corrections."""

    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    for original, replacement in _UNICODE_REPLACEMENTS.items():
        cleaned = cleaned.replace(original, replacement)

    cleaned = _BROKEN_HYPHEN.sub(r"\1\2", cleaned)
    cleaned_lines: list[str] = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append("")
            continue
        if _PAGE_NUMBER_LINE.fullmatch(stripped):
            continue
        if _LINE_ART_LINE.fullmatch(stripped):
            continue
        if _is_toc_like_line(stripped):
            continue
        cleaned_lines.append(stripped)

    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    corrections = {}
    corrections.update(_infer_missing_char_corrections(cleaned))
    corrections.update(_infer_apostrophe_corrections(cleaned))
    corrections.update(_infer_contextual_apostrophe_corrections(cleaned))
    corrections.update(_infer_digit_letter_corrections(cleaned))
    cleaned = _apply_word_corrections(cleaned, corrections)
    return cleaned.strip()
