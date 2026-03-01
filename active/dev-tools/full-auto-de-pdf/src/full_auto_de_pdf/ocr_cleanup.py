from __future__ import annotations

from collections import Counter, defaultdict
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
_MIN_DIGIT_ERROR_OCCURRENCES = 1
_MAX_TOTAL_DIGIT_CORRECTIONS = 3


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
    for index in range(1, len(word)):
        for char in _LOWER_ALPHA:
            candidate = word[:index] + char + word[index:]
            if candidate[:1] != word[:1] or candidate[-2:] != word[-2:]:
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
    if best_candidate_count < int(word_count * _MIN_CORRECTION_RATIO):
        return None
    if second_best_count and (best_candidate_count / second_best_count) < _MIN_BEST_CANDIDATE_MARGIN:
        return None
    return best_candidate, best_missing_char, best_index, best_candidate_count


def _insertion_signature(source_word: str, insertion_index: int, missing_char: str) -> tuple[str, str, str]:
    previous_char = source_word[insertion_index - 1] if insertion_index > 0 else "^"
    next_char = source_word[insertion_index] if insertion_index < len(source_word) else "$"
    return missing_char, previous_char, next_char


def _infer_missing_char_corrections(text: str) -> dict[str, str]:
    counts = _extract_word_counts(text)
    provisional: dict[str, tuple[str, str, tuple[str, str, str], float]] = {}
    char_word_support: dict[str, set[str]] = defaultdict(set)
    signature_word_support: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for word, word_count in counts.items():
        if _ROMAN_WORD.fullmatch(word):
            continue
        if word_count < _MIN_ERROR_OCCURRENCES:
            continue
        if word_count > _MAX_ERROR_OCCURRENCES:
            continue
        variant = _best_missing_char_variant(word, word_count, counts)
        if variant is None:
            continue
        corrected_word, missing_char, insertion_index, corrected_count = variant
        signature = _insertion_signature(word, insertion_index, missing_char)
        score = (float(corrected_count) / float(max(word_count, 1))) * 1000.0 + float(corrected_count)
        provisional[word] = (corrected_word, missing_char, signature, score)
        char_word_support[missing_char].add(word)
        signature_word_support[signature].add(word)

    supported_chars = {
        char
        for char, words in char_word_support.items()
        if len(words) >= _MIN_DISTINCT_WORDS_PER_CHAR
    }
    if not supported_chars:
        return {}
    ranked_candidates: list[tuple[str, str, float]] = []
    for source, (corrected, missing_char, signature, score) in provisional.items():
        if missing_char not in supported_chars:
            continue
        signature_support = len(signature_word_support[signature])
        if signature_support < _MIN_DISTINCT_WORDS_PER_SIGNATURE:
            continue
        char_support = len(char_word_support[missing_char])
        total_score = score + (float(char_support) * 25.0) + (float(signature_support) * 60.0)
        ranked_candidates.append((source, corrected, total_score))

    if not ranked_candidates:
        return {}
    ranked_candidates.sort(key=lambda item: item[2], reverse=True)
    selected = ranked_candidates[:_MAX_TOTAL_CORRECTIONS]
    return {source: corrected for source, corrected, _score in selected}


def _infer_apostrophe_corrections(text: str) -> dict[str, str]:
    counts = _extract_token_counts(text)
    candidates: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if "'" in source:
            continue
        if source_count < _MIN_APOSTROPHE_ERROR_OCCURRENCES or source_count > _MAX_ERROR_OCCURRENCES:
            continue
        proposal_list = [
            source + "'s",
            source + "'d",
            source + "'re",
            source + "'ll",
            source + "'ve",
            source + "'m",
        ]
        if source.endswith("n"):
            proposal_list.append(source + "'t")
        best_target = ""
        best_target_count = 0
        for target in proposal_list:
            target_count = counts.get(target, 0)
            if target_count < _MIN_CORRECTION_OCCURRENCES:
                continue
            if target_count > best_target_count:
                best_target = target
                best_target_count = target_count
        if not best_target:
            continue
        if best_target_count < int(source_count * _MIN_CORRECTION_RATIO):
            continue
        score = (float(best_target_count) / float(source_count)) * 1000.0 + float(best_target_count)
        candidates.append((source, best_target, score))

    candidates.sort(key=lambda item: item[2], reverse=True)
    selected = candidates[:_MAX_TOTAL_APOSTROPHE_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _infer_digit_letter_corrections(text: str) -> dict[str, str]:
    counts = _extract_token_counts(text)
    corrections: dict[str, str] = {}
    if counts.get("1", 0) >= _MIN_DIGIT_ERROR_OCCURRENCES and counts.get("i", 0) >= _MIN_CORRECTION_OCCURRENCES:
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
    replacements: list[tuple[int, int, str]] = []
    for index, match in enumerate(matches):
        source_word = words[index]
        target_word = corrections.get(source_word)
        if target_word is None:
            continue
        source_score = 0
        target_score = 0
        if index > 0:
            between_prev = text[matches[index - 1].end() : match.start()]
            if not _HARD_CONTEXT_BREAK.search(between_prev):
                previous_word = words[index - 1]
                source_score += bigram_counts[(previous_word, source_word)]
                target_score += bigram_counts[(previous_word, target_word)]
        if index + 1 < len(words):
            between_next = text[match.end() : matches[index + 1].start()]
            if not _HARD_CONTEXT_BREAK.search(between_next):
                next_word = words[index + 1]
                source_score += bigram_counts[(source_word, next_word)]
                target_score += bigram_counts[(target_word, next_word)]
        if source_score == 0 and target_score == 0:
            continue
        if target_score < _CONTEXT_MIN_TARGET_SCORE:
            continue
        if target_score < source_score + _CONTEXT_REQUIRED_MARGIN:
            continue
        replacement = _match_case(match.group(0), target_word)
        replacements.append((match.start(), match.end(), replacement))

    if not replacements:
        return text

    chunks: list[str] = []
    cursor = 0
    for start, end, replacement in replacements:
        chunks.append(text[cursor:start])
        chunks.append(replacement)
        cursor = end
    chunks.append(text[cursor:])
    return "".join(chunks)


def cleanup_ocr_text(text: str) -> str:
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
    corrections.update(_infer_digit_letter_corrections(cleaned))
    cleaned = _apply_word_corrections(cleaned, corrections)
    return cleaned.strip()
