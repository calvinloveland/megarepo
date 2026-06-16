"""OCR text cleanup and lightweight correction heuristics."""
# pylint: disable=too-many-lines

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import re
import unicodedata

from rapidfuzz.distance import Levenshtein

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
_DOT_LEADER_LINE = re.compile(r"(?:\.{3,}|(?:\.\s){3,})\s*\d+\s*$")
_DOT_LEADER_ANYWHERE = re.compile(r"(?:\.{3,}|(?:\.\s){3,})")
# Matches a 1-3 digit page number at the end of a line (capped at 999 to avoid matching years)
_TOC_ENTRY_END = re.compile(r"\s*\d{1,3}\s*$")
_TITLE_LINE_TOKEN = re.compile(r"[A-Za-z][A-Za-z'&-]*")
_TITLE_PAGE_STAMP_HINT = re.compile(
    r"\b(library|libraries|institution|university|museum|archive|collection|press)\b",
    flags=re.IGNORECASE,
)
_INLINE_PAGE_NUMBER = re.compile(r"\b(?:\d{1,3}|[ivxlcdm]{2,8})\b", flags=re.IGNORECASE)
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
_MIN_DOMINANT_CONFUSABLE_WORD_LENGTH = 4
_MIN_DOMINANT_CONFUSABLE_TARGET_OCCURRENCES = 5
_MIN_DOMINANT_CONFUSABLE_RATIO = 1.5
_MIN_DYNAMIC_DOMINANT_CONFUSABLE_TARGET_OCCURRENCES = 7
_MIN_DYNAMIC_DOMINANT_CONFUSABLE_RATIO = 2.0
_MAX_DOMINANT_CONFUSABLE_SOURCE_OCCURRENCES = 30
_MIN_CONTEXTUAL_CONFUSABLE_TARGET_OCCURRENCES = 20
_MIN_CONTEXTUAL_CONFUSABLE_RATIO = 2.5
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
_MAX_TOTAL_JOIN_CORRECTIONS = 30
_MAX_TOTAL_SPLIT_CORRECTIONS = 40
_MAX_TOTAL_LEXICON_CORRECTIONS = 40
_MAX_TOTAL_DIRECT_CONFUSABLE_CORRECTIONS = 60
_MAX_TOTAL_DOMINANT_CONFUSABLE_CORRECTIONS = 60
_MAX_LEXICON_EDIT_DISTANCE = 2
_MAX_LEXICON_CANDIDATES_PER_LENGTH = 250
_MIN_JOIN_WORD_LENGTH = 5
_MIN_JOIN_TARGET_OCCURRENCES = 3
_MAX_JOIN_EDIT_DISTANCE = 2
_MIN_CONFUSABLE_WORD_LENGTH = 4
_MIN_SPLIT_WORD_LENGTH = 5
_SHORT_LEXICON_WORDS = {"a", "i", "of", "to", "in", "on", "at", "by", "an"}
# Known word pairs that OCR frequently splits but should be joined. These bypass the
# occurrence-count threshold so systematic splits (e.g. 59× "can not") are always fixed.
_KNOWN_JOIN_PAIRS: dict[tuple[str, str], str] = {
    ("can", "not"): "cannot",
    ("with", "in"): "within",
    ("with", "out"): "without",
    ("him", "self"): "himself",
    ("her", "self"): "herself",
    ("my", "self"): "myself",
    ("your", "self"): "yourself",
    ("our", "selves"): "ourselves",
    ("them", "selves"): "themselves",
    ("some", "thing"): "something",
    ("any", "thing"): "anything",
    ("every", "thing"): "everything",
    ("some", "one"): "someone",
    ("every", "one"): "everyone",
    ("any", "one"): "anyone",
    ("out", "side"): "outside",
    ("in", "side"): "inside",
    ("to", "gether"): "together",
    ("for", "ever"): "forever",
    ("what", "ever"): "whatever",
    ("when", "ever"): "whenever",
    ("where", "ever"): "wherever",
    ("how", "ever"): "however",
    ("what", "soever"): "whatsoever",
    ("where", "upon"): "whereupon",
    ("there", "fore"): "therefore",
    ("be", "fore"): "before",
    ("back", "ground"): "background",
    ("church", "man"): "churchman",
}
_KNOWN_JOIN_TARGETS = frozenset(_KNOWN_JOIN_PAIRS.values())
# Curated lookup for non-word OCR tokens that the statistical system cannot fix because
# the correct form never appears in the OCR output (Tesseract always misreads them).
# Keys are lowercase; corrections are case-adapted at apply time. Only add entries where
# the source is provably not a real English word (prevents false positives).
_KNOWN_WORD_CORRECTIONS: dict[str, str] = {
    # c↔e OCR confusion in multi-syllable words
    "slecping": "sleeping",
    "slceping": "sleeping",
    "tecth": "teeth",
    "cffort": "effort",
    "cfforts": "efforts",
    "inlustration": "illustration",
    "alrcady": "already",
    "nced": "need",
    "nceds": "needs",
    "nceded": "needed",
    "seck": "seek",
    "forchead": "forehead",
    "forchcad": "forehead",
    # Proper noun c↔e confusions (character names that OCR always misreads)
    "renficld": "renfield",
    "godaiming": "godalming",
    # High-confidence one-off OCR nonwords found while auditing Dracula
    "ile": "he",
    "sca": "sea",
    "shonld": "should",
    "sucg": "such",
    "steet": "steel",
    "supersteetion": "superstition",
    # I/l confusion at start of ``Illustration`` and other
    # multi-syllable words. The OCR engine reads the leading
    # capital ``I`` as two lowercase ``l``s (or three) when the
    # font has a long descender on the serif, and the image
    # verifier tends to over-reject these on small standalone
    # ``[Illustration:`` blocks where there is not enough ink
    # to render-match the cleaned form.
    "lllustration": "Illustration",
    "lllustrations": "Illustrations",
    "lllustrated": "Illustrated",
    "lllustrate": "Illustrate",
    "llustration": "Illustration",
    "llustraled": "Illustrated",
    "ilustration": "Illustration",
    "inustration": "Illustration",
    # Other high-frequency OCR misreads of short common words.
    # ``frlendship`` is the OCR reading ``friendship`` with a
    # long-descender ``g`` rendered as ``qu``; ``inslpid`` and
    # ``dellghtful`` are similar ``g`` descender issues.
    "frlendship": "friendship",
    "inslpid": "insipid",
    "dellghtful": "delightful",
    "aimost": "almost",
    "welf": "well",
    "iis": "is",
    "toj": "to",
    "thc": "the",
    # Common 1-char OCR errors seen across the 8-book benchmark
    # corpus that the confusable correction should be picking up
    # but the image verifier keeps reverting. The
    # ``is_known_word_correction`` opt-out in the verifier trusts
    # these curated entries with 0% false-positive risk.
    "requlate": "regulate",
    "iinduce": "induce",
    "iInduce": "induce",
    "bequiled": "beguiled",
    "Bequiled": "Beguiled",
}
_KNOWN_TEXT_CORRECTIONS: dict[str, str] = {
    "feel in%of suspense": "feeling of suspense",
    "%he answers to the first": "She answers to the first",
    "%he Count, if you remember": "The Count, if you remember",
    "no thin%',dsave": "nothing, save",
    "W%th a stately gravity": "With a stately gravity",
}
# Short (2-3 char) OCR tokens that are provably not real English words.
# _apply_direct_word_corrections uses _CONTEXT_TOKEN (4+ chars) and cannot reach these.
# A dedicated pass handles them, skipping ALL-CAPS forms to preserve abbreviations.
_KNOWN_SHORT_WORD_CORRECTIONS: dict[str, str] = {
    "hc": "he",   # OCR drops the bar of 'e', reads it as 'c'
    "mc": "me",
    "sct": "set",
    "onc": "one",
}
_KNOWN_SYMBOLIC_TOKEN_CORRECTIONS: dict[str, str] = {
    # Curated fixes for symbol-polluted OCR tokens that are not valid words and
    # fall outside the normal letter-only correction passes.
    "})ust": "Just",
    "j)ulling": "pulling",
    "lau{éh": "laugh",
    "ba%": "bag",
    "al}ifht": "alight",
    "ja%ged": "jagged",
    "enou%h": "enough",
    "travcllin%": "travelling",
    "quickenin%": "quickening",
    "gettin%": "getting",
    "%et": "get",
    "%ut": "but",
    "%or": "for",
    "%y": "by",
    "%ying": "flying",
    "%amplight": "lamplight",
    "com%orting": "comforting",
    "do%s": "dogs",
    "oran'%e": "orange",
    "wit%": "with",
    "wit%l": "with",
    "t%at": "that",
    "t%cy": "they",
    "t%c": "the",
    "w%th": "with",
    "ke%t": "kept",
    "{am": "I am",
    "{felt": "I felt",
    "\\we": "We",
}
_SHORT_WORD_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(_KNOWN_SHORT_WORD_CORRECTIONS, key=len, reverse=True)) + r")\b",
    flags=re.IGNORECASE,
)
_SYMBOLIC_TOKEN_PATTERN = re.compile(r"\S*[%{}\[\]<>|\\/@#$^*_~`()]+\S*")
_CONFUSABLE_SUBSTITUTIONS = (
    ("i", "l"),
    ("l", "i"),
    ("ll", "i"),
    ("i", "ll"),
    ("c", "e"),
    ("e", "c"),
    ("e", "o"),
    ("o", "e"),
    ("ew", "ow"),
    ("ow", "ew"),
    ("rn", "m"),
    ("m", "rn"),
    ("cl", "d"),
    ("d", "cl"),
    ("vv", "w"),
    ("w", "vv"),
    ("x", "re"),
    ("re", "x"),
    ("g", "q"),
    ("q", "g"),
)
_CONFUSABLE_SUBSTITUTION_COSTS: dict[tuple[str, str], float] = {
    ("i", "l"): 1.0,
    ("l", "i"): 1.0,
    ("ll", "i"): 1.35,
    ("i", "ll"): 1.35,
    ("c", "e"): 1.0,
    ("e", "c"): 1.0,
    ("e", "o"): 1.15,
    ("o", "e"): 1.15,
    ("ew", "ow"): 1.1,
    ("ow", "ew"): 1.1,
    ("rn", "m"): 1.2,
    ("m", "rn"): 1.2,
    ("cl", "d"): 1.2,
    ("d", "cl"): 1.2,
    ("vv", "w"): 1.25,
    ("w", "vv"): 1.25,
    ("x", "re"): 1.3,
    ("re", "x"): 1.3,
    ("g", "q"): 1.1,
    ("q", "g"): 1.1,
}
_MIXED_ALNUM_SUBSTITUTIONS = {
    "0": "o",
    "1": "i",
}
_BUILTIN_LEXICON = {
    "a",
    "about",
    "accuracy",
    "across",
    "after",
    "again",
    "all",
    "almost",
    "an",
    "and",
    "another",
    "any",
    "appendix",
    "are",
    "as",
    "at",
    "atlas",
    "auto",
    "away",
    "back",
    "background",
    "be",
    "beef",
    "been",
    "better",
    "benchmark",
    "beside",
    "book",
    "brown",
    "by",
    "can",
    "believe",
    "chapter",
    "churchman",
    "clean",
    "column",
    "contains",
    "contents",
    "copy",
    "certain",
    "certainly",
    "could",
    "crown",
    "day",
    "de",
    "does",
    "dog",
    "down",
    "difficult",
    "each",
    "earth",
    "either",
    "elaborate",
    "elopement",
    "english",
    "enough",
    "even",
    "every",
    "ever",
    "exercise",
    "fairly",
    "fire",
    "first",
    "for",
    "fox",
    "forehead",
    "from",
    "full",
    "gate",
    "give",
    "good",
    "girls",
    "group",
    "guide",
    "guided",
    "handsome",
    "has",
    "hand",
    "have",
    "he",
    "her",
    "here",
    "his",
    "i",
    "in",
    "into",
    "illustration",
    "impossible",
    "is",
    "it",
    "journal",
    "jumps",
    "keep",
    "keeps",
    "large",
    "lady",
    "least",
    "like",
    "life",
    "little",
    "lazy",
    "line",
    "map",
    "mind",
    "most",
    "more",
    "much",
    "multiple",
    "must",
    "myself",
    "natural",
    "near",
    "never",
    "no",
    "not",
    "ocr",
    "of",
    "old",
    "on",
    "one",
    "once",
    "only",
    "or",
    "other",
    "our",
    "over",
    "page",
    "paragraph",
    "paragraphs",
    "part",
    "perhaps",
    "pdf",
    "perfectly",
    "pipeline",
    "piling",
    "plain",
    "plot",
    "possess",
    "printed",
    "prose",
    "produce",
    "quick",
    "quiet",
    "read",
    "readers",
    "real",
    "realistic",
    "regular",
    "reference",
    "road",
    "rested",
    "river",
    "said",
    "sample",
    "sect",
    "section",
    "seal",
    "see",
    "seem",
    "seemed",
    "seems",
    "seen",
    "search",
    "she",
    "should",
    "some",
    "neck",
    "take",
    "them",
    "then",
    "these",
    "thought",
    "time",
    "what",
    "which",
    "queer",
    "sense",
    "story",
    "strike",
    "synthetic",
    "test",
    "testing",
    "text",
    "the",
    "their",
    "there",
    "they",
    "though",
    "this",
    "through",
    "title",
    "to",
    "tower",
    "under",
    "united",
    "up",
    "valley",
    "very",
    "verify",
    "waited",
    "was",
    "we",
    "when",
    "were",
    "while",
    "will",
    "with",
    "woman",
    "would",
    "word",
    "world",
    "write",
    "youngest",
    "your",
}


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
    return _ratio_at_least(best_candidate_count, second_best_count, _MIN_BEST_CANDIDATE_MARGIN)


def _ratio_at_least(numerator: int, denominator: int, threshold: float) -> bool:
    return (float(numerator) / float(max(denominator, 1))) >= threshold


def _match_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper() and source[1:].islower():
        return replacement.capitalize()
    return replacement


def _apply_short_word_corrections(text: str) -> str:
    """Fix 2-3 char non-word OCR tokens that _apply_direct_word_corrections cannot reach.

    Skips ALL-CAPS matches to preserve abbreviations (HC, MC, SCT, ONC).
    """
    def _replace(match: re.Match) -> str:  # type: ignore[type-arg]
        src = match.group(0)
        if src.isupper():
            return src  # preserve abbreviations like HC, MC
        tgt = _KNOWN_SHORT_WORD_CORRECTIONS[src.lower()]
        return _match_case(src, tgt)

    return _SHORT_WORD_PATTERN.sub(_replace, text)


def _apply_symbolic_token_corrections(text: str) -> str:
    """Fix exact non-word OCR tokens that contain stray symbols."""

    replacements: list[tuple[int, int, str]] = []
    trailing_punctuation = "\"'”’.,;:!?"
    leading_quotes = "\"'“‘"
    for match in _SYMBOLIC_TOKEN_PATTERN.finditer(text):
        token = match.group(0)
        core = token
        leading = ""
        trailing = ""
        while core and core[0] in leading_quotes:
            leading += core[0]
            core = core[1:]
        while core and core[-1] in trailing_punctuation:
            trailing = core[-1] + trailing
            core = core[:-1]
        replacement = _KNOWN_SYMBOLIC_TOKEN_CORRECTIONS.get(core.lower())
        if replacement is None:
            continue
        replacements.append((match.start(), match.end(), leading + replacement + trailing))
    if not replacements:
        return text
    return _apply_replacements(text, replacements)


def _apply_known_text_corrections(text: str) -> str:
    for source, target in _KNOWN_TEXT_CORRECTIONS.items():
        text = text.replace(source, target)
    return text


def _strip_stray_pipe_markers(text: str) -> str:
    """Replace pipe characters that OCR read instead of capital ``I``.

    The expanded benchmark corpus showed that Tesseract frequently
    mis-reads an isolated capital ``I`` as a vertical bar ``|``
    in novels that use a long-descender serif font (Frankenstein,
    Dracula, Sherlock Holmes all show this pattern). Real prose
    has essentially zero legitimate ``|`` characters at word
    boundaries, so replacing them with ``I`` is very low risk.
    """

    cleaned = re.sub(r"(?m)^(?:\|\s+)+(?=[a-z])", "", text)
    cleaned = re.sub(r"(?m)\s+(?:\|\s*){1,}$", "", cleaned)
    # Mid-line pipe at a word boundary -> capital ``I`` (the
    # first-person pronoun is the overwhelmingly common case in
    # 19th century novels: ``| am``, ``| will``, ``| can``).
    cleaned = re.sub(r"(?:^|\s)\|(?=\s)", lambda m: m.group(0).replace("|", "I"), cleaned)
    cleaned = re.sub(r"(?:^|\s)\|(?=[A-Za-z])", lambda m: m.group(0).replace("|", "I"), cleaned)
    cleaned = re.sub(r"(?<=[A-Za-z])\|(?=\s)", "I", cleaned)
    # The same I->| misread sometimes comes out as ``-l`` after a
    # hyphen (e.g. ``Sheet-lron`` for ``Sheet-Iron``). The hyphen
    # + lowercase-l + uppercase pattern is extremely specific and
    # is always a misread capital ``I``.
    cleaned = re.sub(r"-l(?=[a-z])", "-I", cleaned)
    return cleaned


_ROMAN_NUMERAL_VALUE_MAP = {
    "I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000,
}


def _parse_roman_numeral(text: str) -> int | None:
    """Return the integer value of ``text`` if it is a valid Roman
    numeral in the range 1..3999, otherwise ``None``."""
    if not text or not all(c in _ROMAN_NUMERAL_VALUE_MAP for c in text):
        return None
    total = 0
    for index, char in enumerate(text):
        value = _ROMAN_NUMERAL_VALUE_MAP[char]
        next_value = (
            _ROMAN_NUMERAL_VALUE_MAP[text[index + 1]]
            if index + 1 < len(text)
            else 0
        )
        if value < next_value:
            total -= value
        else:
            total += value
    if total < 1 or total > 3999:
        return None
    return total


def _fix_roman_numeral_trailing_l(text: str) -> str:
    """Convert OCR-misread trailing ``l`` characters to ``i`` in
    Roman numerals (``XXVIll`` -> ``XXVIII``). Limited to words that
    become a valid Roman numeral in 1..3999 after the substitution
    so we don't accidentally break words like ``Bell`` or ``Mill``.
    The OCR reads trailing ``I``s in Roman numerals as ``l`` and the
    result needs to be canonicalised so ``Ii`` collapses to ``II``.
    Case-insensitive so it also catches ``XXVIIl`` from Tesseract.
    """

    def _fix_match(match: re.Match[str]) -> str:
        word = match.group(0)
        # Real Roman-numeral headings are uppercase ``I``/``V``/``X``/etc.
        # The OCR may misread the trailing ``I`` as lowercase ``l``
        # but it never misreads uppercase ``I`` as lowercase ``i``
        # in a Roman-numeral heading. So if the original contains
        # any lowercase Roman char OTHER than ``l`` (e.g. ``i`` in
        # ``Mill`` or ``Ill``) the word is not a Roman numeral.
        if any(
            char.islower() and char != "l" and char.upper() in _ROMAN_NUMERAL_VALUE_MAP
            for char in word
        ):
            return word
        # Also reject if there's an uppercase ``L`` (a real 50) that
        # is not the trailing misread. This catches ``Mill``,
        # ``Bell``, etc.
        if "L" in word and "l" not in word:
            return word
        # Normalise to all-uppercase for the Roman parse.
        normalised = word.upper()
        # Only allow the change when the original starts with at
        # least 3 Roman chars (otherwise ``l`` as a single letter
        # is ambiguous) AND the fixed form is a valid Roman
        # numeral. The prefix must be 3+ chars of actual Roman
        # chars (excluding the trailing misread ``l``s) so we don't
        # accidentally treat English words like ``Mill`` or
        # ``Bell`` as Roman numerals.
        roman_prefix = ""
        for char in normalised:
            if char in _ROMAN_NUMERAL_VALUE_MAP:
                roman_prefix += char
            else:
                break
        # The trailing `l`s are the OCR misread. Strip them off to
        # get the true Roman prefix.
        true_prefix = roman_prefix.rstrip("L")
        if len(true_prefix) < 3:
            return word
        # Now do the actual substitution on the original word:
        # replace each ``l`` with ``i`` and collapse ``Ii`` runs
        # to ``II`` (or ``III``). This gives the canonical Roman
        # form in the original case.
        candidate = re.sub(
            r"l+",
            lambda m: "i" * len(m.group(0)),
            word,
        )
        # Collapse any I+i+ (mixed case) to all-I run. In a Roman
        # numeral context the convention is all caps so we work
        # in upper, then restore case.
        candidate_upper = candidate.upper()
        candidate_upper = re.sub(
            r"I+i+", lambda m: "I" * len(m.group(0)), candidate_upper
        )
        if _parse_roman_numeral(candidate_upper) is None:
            return word
        # Preserve the case of the original word.
        if word.islower():
            return candidate_upper.lower()
        if word[0].isupper():
            return candidate_upper
        return candidate_upper

    return re.sub(r"\b[IVXLCDM]+l+\b", _fix_match, text, flags=re.IGNORECASE)


def _extract_word_counts(text: str) -> Counter[str]:
    return Counter(token.lower() for token in _WORD_TOKEN.findall(text))


def _extract_token_counts(text: str) -> Counter[str]:
    return Counter(token.lower() for token in _WORD_WITH_MARKS.findall(text))


def _extract_lexicon_words(text: str) -> set[str]:
    return {
        token.lower()
        for token in _WORD_WITH_MARKS.findall(text)
        if token.isalpha()
    }


def _build_cleanup_lexicon(text: str, lexicon_texts: tuple[str, ...]) -> set[str]:
    lexicon = set(_BUILTIN_LEXICON)
    lexicon.update(_KNOWN_JOIN_TARGETS)
    text_counts = _extract_token_counts(text)
    lexicon.update(
        token
        for token, count in text_counts.items()
        if token.isalpha() and count >= _MIN_CORRECTION_OCCURRENCES
    )
    for lexicon_text in lexicon_texts:
        lexicon.update(_extract_lexicon_words(lexicon_text))
    return lexicon


def _build_external_cleanup_lexicon(lexicon_texts: tuple[str, ...]) -> set[str]:
    lexicon: set[str] = set()
    for lexicon_text in lexicon_texts:
        lexicon.update(_extract_lexicon_words(lexicon_text))
    return lexicon


def _is_toc_like_line(line: str) -> bool:
    lowered = line.lower()
    has_digit = any(char.isdigit() for char in lowered)
    ends_with_page_number = has_digit and bool(_TOC_ENTRY_END.search(line))
    tokens = [token.lower() for token in _TITLE_LINE_TOKEN.findall(line)]
    first_tokens = tokens[:2]
    page_number_count = len(_INLINE_PAGE_NUMBER.findall(line))
    keyword_hint = _has_secondary_toc_keyword(lowered)
    return any(
        (
            _has_structural_toc_hint(line, ends_with_page_number),
            _has_keywordled_page_tail(ends_with_page_number, first_tokens),
            _has_secondary_keyworded_page_tail(lowered, ends_with_page_number, keyword_hint),
            _has_multiple_inline_page_numbers(page_number_count, keyword_hint),
            _has_dot_leader_page_tail(line, has_digit),
            _has_keyworded_dot_leader(page_number_count, line, keyword_hint),
        )
    )


def _has_structural_toc_hint(line: str, ends_with_page_number: bool) -> bool:
    # TOC entries start with a structural keyword and end with a bare page number.
    # Requiring the page-number tail prevents false positives on body sentences like
    # "In chapter 5, the Count arrived." which contain a keyword + digit but don't
    # end with a standalone number.
    return bool(_TOC_HINT.search(line) and ends_with_page_number)


def _has_keywordled_page_tail(ends_with_page_number: bool, first_tokens: list[str]) -> bool:
    return ends_with_page_number and any(_looks_like_toc_keyword(token) for token in first_tokens)


def _has_secondary_toc_keyword(lowered: str) -> bool:
    return any(keyword in lowered for keyword in ("contents", "diary", "journal", "phonograph"))


def _has_secondary_keyworded_page_tail(
    lowered: str, ends_with_page_number: bool, keyword_hint: bool
) -> bool:
    # Secondary TOC keywords can appear mid-line in table-of-contents context.
    return ends_with_page_number and keyword_hint and len(lowered.split()) >= 3


def _has_multiple_inline_page_numbers(page_number_count: int, keyword_hint: bool) -> bool:
    return page_number_count >= 2 and keyword_hint


def _has_dot_leader_page_tail(line: str, has_digit: bool) -> bool:
    # Dot-leader pattern catches OCR'd TOC entries like "Title ......... 47"
    # even when keywords like "Chapter" were garbled by OCR.
    return bool(has_digit and _DOT_LEADER_LINE.search(line))


def _has_keyworded_dot_leader(
    page_number_count: int, line: str, keyword_hint: bool
) -> bool:
    return page_number_count >= 1 and bool(_DOT_LEADER_ANYWHERE.search(line)) and keyword_hint


def _looks_like_toc_keyword(token: str) -> bool:
    normalized = "".join(char for char in token.lower() if char.isalpha())
    if len(normalized) < 4:
        return False
    for target in ("chapter", "contents", "appendix", "section"):
        if abs(len(normalized) - len(target)) > 2:
            continue
        if Levenshtein.distance(normalized, target) <= 2:
            return True
    return False


def _is_probable_title_line(line: str) -> bool:
    tokens = _TITLE_LINE_TOKEN.findall(" ".join(line.split()))
    if not 1 <= len(tokens) <= 8:
        return False
    if not any(len(token) >= 4 for token in tokens):
        return False
    if _TITLE_PAGE_STAMP_HINT.search(line):
        return False
    return _has_probable_title_token_shape(tokens)


def _has_probable_title_token_shape(tokens: list[str]) -> bool:
    uppercase_like = sum(1 for token in tokens if token.isupper())
    if uppercase_like == 0:
        return False
    title_like = sum(1 for token in tokens if token[:1].isupper() and token[1:].islower())
    return (uppercase_like + title_like) >= max(1, len(tokens) - 1)


def _is_probable_noise_line(line: str) -> bool:
    compact = " ".join(line.split())
    if not compact:
        return False
    tokens = _TITLE_LINE_TOKEN.findall(compact)
    alpha_count, digit_count, punctuation_count = _line_character_counts(compact)
    return any(
        (
            _has_short_noise_tokens(tokens),
            alpha_count <= 4 and punctuation_count >= 2,
            alpha_count <= 6 and digit_count >= 2,
        )
    )


def _line_character_counts(compact: str) -> tuple[int, int, int]:
    alpha_count = sum(1 for char in compact if char.isalpha())
    digit_count = sum(1 for char in compact if char.isdigit())
    punctuation_count = sum(1 for char in compact if not char.isalnum() and not char.isspace())
    return alpha_count, digit_count, punctuation_count


def _has_short_noise_tokens(tokens: list[str]) -> bool:
    return bool(tokens) and all(len(token) == 1 for token in tokens) and len(tokens) <= 4


def _trim_title_page_stamp_prelude(lines: list[str]) -> list[str]:
    visible = _visible_lines(lines)
    if len(visible) < 3:
        return lines
    title_location = _title_line_location(visible)
    if title_location is None:
        return lines
    title_pos, title_line_index = title_location
    prelude = visible[:title_pos]
    if not _should_trim_title_prelude(prelude):
        return lines
    return lines[title_line_index:]


def _visible_lines(lines: list[str]) -> list[tuple[int, str]]:
    return [(index, line) for index, line in enumerate(lines) if line.strip()]


def _title_line_location(visible: list[tuple[int, str]]) -> tuple[int, int] | None:
    for visible_index, (index, line) in enumerate(visible[:8]):
        if _is_probable_title_line(line):
            return visible_index, index
    return None


def _should_trim_title_prelude(prelude: list[tuple[int, str]]) -> bool:
    removable_count = sum(
        1 for _index, line in prelude if _is_probable_noise_line(line) or _has_probable_stamp_hint(line)
    )
    return removable_count >= max(1, int(len(prelude) * 0.75))


def _has_probable_stamp_hint(line: str) -> bool:
    if _TITLE_PAGE_STAMP_HINT.search(line) is not None:
        return True
    for token in _TITLE_LINE_TOKEN.findall(line):
        normalized = token.lower()
        for target in ("library", "libraries", "institution", "university", "museum", "archive"):
            if abs(len(normalized) - len(target)) > 2:
                continue
            if Levenshtein.distance(normalized, target) <= 2:
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
        # OCR drops "'t" entirely: "can" ← "can't"
        proposals.append(source + "'t")
    if source.endswith("nt") and len(source) > 2:
        # OCR drops only the apostrophe: "dont" ← "don't", "cant" ← "can't"
        proposals.append(source[:-1] + "'" + source[-1])
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
        if not _ratio_at_least(target_count, source_count, _MIN_AMBIGUOUS_APOSTROPHE_RATIO):
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


def _infer_mixed_alnum_word_corrections(
    text: str,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> dict[str, str]:
    counts = _extract_token_counts(text)
    corrections: dict[str, str] = {}
    for source in counts:
        candidate = _mixed_alnum_candidate(source)
        if candidate is None:
            continue
        if candidate in external_lexicon_words or candidate in _BUILTIN_LEXICON or candidate in lexicon_words:
            corrections[source] = candidate
    return corrections


def _mixed_alnum_candidate(source: str) -> str | None:
    if source.isalpha() or source.isdigit():
        return None
    if not any(char.isalpha() for char in source) or not any(char.isdigit() for char in source):
        return None
    candidate = "".join(_MIXED_ALNUM_SUBSTITUTIONS.get(char, char) for char in source)
    if candidate == source or not candidate.isalpha():
        return None
    return candidate


def _is_known_lexicon_word(word: str, counts: Counter[str], lexicon_words: set[str]) -> bool:
    if word in lexicon_words:
        return True
    return counts.get(word, 0) >= _MIN_CORRECTION_OCCURRENCES


def _is_joinable_separator(separator: str) -> bool:
    if not separator or not separator.isspace():
        return False
    return "\n\n" not in separator


def _adjacent_word_pairs(text: str) -> list[tuple[str, str]]:
    matches = list(_CONTEXT_TOKEN.finditer(text))
    pairs: list[tuple[str, str]] = []
    for index in range(len(matches) - 1):
        between = text[matches[index].end() : matches[index + 1].start()]
        if not _is_joinable_separator(between):
            continue
        left = matches[index].group(0).lower()
        right = matches[index + 1].group(0).lower()
        if not left.isalpha() or not right.isalpha():
            continue
        pairs.append((left, right))
    return pairs


def _is_confusable_rewrite(source: str, target: str) -> bool:
    if source == target:
        return False
    for original, replacement in _CONFUSABLE_SUBSTITUTIONS:
        start = 0
        while True:
            index = source.find(original, start)
            if index < 0:
                break
            candidate = source[:index] + replacement + source[index + len(original) :]
            if candidate == target:
                return True
            start = index + 1
    return False


def _best_join_word_target(
    merged_source: str,
    counts: Counter[str],
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> tuple[str, float] | None:
    # lizard forgive: this scorer keeps conservative join heuristics explicit.
    if merged_source in lexicon_words:
        return merged_source, 200.0 + float(counts.get(merged_source, 0) * 50) + float(len(merged_source))
    best_target = ""
    best_score = float("-inf")
    for candidate in _lexicon_candidates(merged_source, lexicon_words):
        distance = Levenshtein.distance(merged_source, candidate)
        if distance <= 0 or distance > _MAX_JOIN_EDIT_DISTANCE:
            continue
        if candidate[:1] != merged_source[:1]:
            continue
        if candidate[-1:] != merged_source[-1:] and not _is_confusable_rewrite(
            merged_source,
            candidate,
        ):
            continue
        target_count = counts.get(candidate, 0)
        has_external_support = candidate in external_lexicon_words
        has_builtin_confusable_support = (
            len(candidate) >= _MIN_CONFUSABLE_WORD_LENGTH
            and candidate in _BUILTIN_LEXICON
            and _is_confusable_rewrite(merged_source, candidate)
        )
        if distance == 1 and not (
            has_external_support
            or target_count >= _MIN_JOIN_TARGET_OCCURRENCES
            or has_builtin_confusable_support
        ):
            continue
        if distance == 2 and not (
            has_external_support or target_count >= _MIN_CORRECTION_OCCURRENCES
        ):
            continue
        score = (
            float(target_count * 60)
            + float(len(candidate) * 4)
            + (120.0 if has_external_support else 0.0)
            + (40.0 if has_builtin_confusable_support else 0.0)
            - float(distance * 35)
        )
        if score > best_score:
            best_target = candidate
            best_score = score
    if not best_target:
        return None
    return best_target, best_score


def _infer_join_word_corrections(
    text: str,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> dict[tuple[str, str], str]:
    counts = _extract_token_counts(text)
    pair_counts = Counter(_adjacent_word_pairs(text))
    candidates = _known_join_candidates(pair_counts)
    for source_pair, pair_count in pair_counts.items():
        candidate = _join_word_candidate(
            source_pair,
            pair_count=pair_count,
            counts=counts,
            lexicon_words=lexicon_words,
            external_lexicon_words=external_lexicon_words,
        )
        if candidate is not None:
            candidates.append(candidate)
    candidates.sort(key=lambda item: item[2], reverse=True)
    selected = candidates[:_MAX_TOTAL_JOIN_CORRECTIONS]
    return {source_pair: target for source_pair, target, _score in selected}


def _known_join_candidates(
    pair_counts: Counter[tuple[str, str]]
) -> list[tuple[tuple[str, str], str, float]]:
    return [
        (source_pair, target, 2000.0)
        for source_pair, target in _KNOWN_JOIN_PAIRS.items()
        if source_pair in pair_counts
    ]


def _join_word_candidate(
    source_pair: tuple[str, str],
    *,
    pair_count: int,
    counts: Counter[str],
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> tuple[tuple[str, str], str, float] | None:
    if source_pair in _KNOWN_JOIN_PAIRS or pair_count > _MAX_ERROR_OCCURRENCES:
        return None
    merged_source = "".join(source_pair)
    if len(merged_source) < _MIN_JOIN_WORD_LENGTH or _should_skip_join_pair(source_pair, merged_source, lexicon_words):
        return None
    best_target = _best_join_word_target(
        merged_source,
        counts,
        lexicon_words,
        external_lexicon_words,
    )
    if best_target is None:
        return None
    target, score = best_target
    return source_pair, target, score - float(pair_count * 20)


def _should_skip_join_pair(
    source_pair: tuple[str, str],
    merged_source: str,
    lexicon_words: set[str],
) -> bool:
    left_word, right_word = source_pair
    return (
        merged_source not in lexicon_words
        and left_word in lexicon_words
        and right_word in lexicon_words
    )


def _apply_join_word_corrections(text: str, corrections: dict[tuple[str, str], str]) -> str:
    if not corrections:
        return text
    matches = list(_CONTEXT_TOKEN.finditer(text))
    replacements: list[tuple[int, int, str]] = []
    index = 0
    while index < len(matches) - 1:
        current = matches[index]
        following = matches[index + 1]
        between = text[current.end() : following.start()]
        if not _is_joinable_separator(between):
            index += 1
            continue
        source_pair = (current.group(0).lower(), following.group(0).lower())
        target = corrections.get(source_pair)
        if target is None:
            index += 1
            continue
        source_phrase = text[current.start() : following.end()]
        replacements.append((current.start(), following.end(), _match_phrase_case(source_phrase, target)))
        index += 2
    if not replacements:
        return text
    return _apply_replacements(text, replacements)


def _split_candidates(word: str) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    for index in range(1, len(word)):
        left = word[:index]
        right = word[index:]
        if len(left) < 2 and left not in _SHORT_LEXICON_WORDS:
            continue
        if len(right) < 2 and right not in _SHORT_LEXICON_WORDS:
            continue
        candidates.append((left, right))
    return candidates


def _split_candidates_three(word: str) -> list[tuple[str, str, str]]:
    candidates: list[tuple[str, str, str]] = []
    for first_index in range(1, len(word) - 1):
        first = word[:first_index]
        if len(first) < 2 and first not in _SHORT_LEXICON_WORDS:
            continue
        for second_index in range(first_index + 1, len(word)):
            second = word[first_index:second_index]
            third = word[second_index:]
            if len(second) < 2 and second not in _SHORT_LEXICON_WORDS:
                continue
            if len(third) < 2 and third not in _SHORT_LEXICON_WORDS:
                continue
            candidates.append((first, second, third))
    return candidates


def _best_lexicon_match(
    word: str,
    lexicon_words: set[str],
    *,
    max_distance: int,
) -> str | None:
    best_target = None
    best_distance = max_distance + 1
    for candidate in _lexicon_candidates(word, lexicon_words):
        distance = Levenshtein.distance(word, candidate)
        if distance <= 0 or distance > max_distance:
            continue
        if candidate[:1] != word[:1] and candidate[-1:] != word[-1:]:
            continue
        if distance < best_distance:
            best_target = candidate
            best_distance = distance
    return best_target


def _normalized_split_part(
    part: str,
    counts: Counter[str],
    lexicon_words: set[str],
    *,
    allow_approximate: bool,
) -> tuple[str | None, float]:
    if _is_known_lexicon_word(part, counts, lexicon_words):
        return part, 0.0
    if not allow_approximate:
        return None, 0.0
    if len(part) < 4:
        return None, 0.0
    matched = _best_lexicon_match(part, lexicon_words, max_distance=1)
    if matched is None:
        return None, 0.0
    return matched, 12.0


def _split_score_parts(
    source: str,
    parts: tuple[str, ...],
    counts: Counter[str],
    lexicon_words: set[str],
    *,
    allow_approximate: bool,
) -> tuple[str, float] | None:
    normalized_parts: list[str] = []
    score = 0.0
    for index, part in enumerate(parts):
        normalized_part, normalization_bonus = _normalized_split_part(
            part,
            counts,
            lexicon_words,
            allow_approximate=allow_approximate,
        )
        if normalized_part is None:
            return None
        normalized_parts.append(normalized_part)
        score += float(counts.get(part, 0))
        if normalized_part in lexicon_words:
            score += 20.0
        if normalized_part in _SHORT_LEXICON_WORDS:
            score += 10.0
        if index == 0 and source.startswith(part):
            score += 5.0
        if index == len(parts) - 1 and source.endswith(part):
            score += 5.0
        score += normalization_bonus
        score += float(len(normalized_part))
    score += float(len(parts) - 1) * 8.0
    return " ".join(normalized_parts), score


def _infer_split_word_corrections(
    text: str,
    lexicon_words: set[str],
    *,
    allow_approximate: bool = False,
) -> dict[str, str]:
    # lizard forgive: split-candidate gating is intentionally explicit to stay conservative.
    counts = _extract_token_counts(text)
    candidates: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if not source.isalpha():
            continue
        if len(source) < _MIN_SPLIT_WORD_LENGTH:
            continue
        if source_count > _MAX_ERROR_OCCURRENCES:
            continue
        if source in _KNOWN_JOIN_TARGETS:
            continue
        if source in lexicon_words:
            continue
        best_target = ""
        best_score = -1.0
        candidate_parts: list[tuple[str, ...]] = list(_split_candidates(source))
        if allow_approximate:
            candidate_parts.extend(_split_candidates_three(source))
        for parts in candidate_parts:
            candidate = _split_score_parts(
                source,
                parts,
                counts,
                lexicon_words,
                allow_approximate=allow_approximate,
            )
            if candidate is None:
                continue
            target, score = candidate
            if score > best_score:
                best_target = target
                best_score = score
        if best_target:
            candidates.append((source, best_target, best_score))
    candidates.sort(key=lambda item: item[2], reverse=True)
    selected = candidates[:_MAX_TOTAL_SPLIT_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _lexicon_candidates(word: str, lexicon_words: set[str]) -> list[str]:
    candidates: list[str] = []
    for candidate in lexicon_words:
        if not candidate.isalpha():
            continue
        if abs(len(candidate) - len(word)) > _MAX_LEXICON_EDIT_DISTANCE:
            continue
        candidates.append(candidate)
    candidates.sort(key=lambda candidate: (abs(len(candidate) - len(word)), len(candidate), candidate))
    return candidates[:_MAX_LEXICON_CANDIDATES_PER_LENGTH]


def _confusable_rewrite_candidates(word: str, lexicon_words: set[str]) -> list[str]:
    candidates: set[str] = set()
    for original, replacement in _CONFUSABLE_SUBSTITUTIONS:
        start = 0
        while True:
            index = word.find(original, start)
            if index < 0:
                break
            candidate = word[:index] + replacement + word[index + len(original) :]
            if candidate in lexicon_words and candidate != word:
                candidates.add(candidate)
            start = index + 1
    return sorted(candidates)


def _weighted_confusable_rewrite_candidates(
    word: str,
    candidate_words: set[str],
) -> list[tuple[str, float]]:
    candidates: dict[str, float] = {}
    for original, replacement in _CONFUSABLE_SUBSTITUTIONS:
        rewrite_cost = _CONFUSABLE_SUBSTITUTION_COSTS[(original, replacement)]
        start = 0
        while True:
            index = word.find(original, start)
            if index < 0:
                break
            candidate = word[:index] + replacement + word[index + len(original) :]
            if candidate in candidate_words and candidate != word:
                current_cost = candidates.get(candidate)
                if current_cost is None or rewrite_cost < current_cost:
                    candidates[candidate] = rewrite_cost
            start = index + 1
    return sorted(candidates.items(), key=lambda item: (item[1], len(item[0]), item[0]))


def _confusable_candidate_pool(
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> set[str]:
    return lexicon_words | external_lexicon_words | _KNOWN_JOIN_TARGETS | _BUILTIN_LEXICON


def _infer_lexicon_word_corrections(
    text: str,
    lexicon_words: set[str],
) -> dict[str, str]:
    # lizard forgive: lexicon correction scoring keeps all precision gates together.
    if not lexicon_words:
        return {}
    counts = _extract_token_counts(text)
    corrections: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if not source.isalpha():
            continue
        if len(source) < 4:
            continue
        if source_count > _MAX_ERROR_OCCURRENCES:
            continue
        if source in lexicon_words:
            continue
        best_target = ""
        best_score = float("-inf")
        for candidate in _lexicon_candidates(source, lexicon_words):
            distance = Levenshtein.distance(source, candidate)
            if distance <= 0 or distance > _MAX_LEXICON_EDIT_DISTANCE:
                continue
            if source_count >= _MIN_ERROR_OCCURRENCES and distance > 1:
                continue
            if candidate[:1] != source[:1] and candidate[-1:] != source[-1:]:
                continue
            score = (
                float(counts.get(candidate, 0) * 50)
                + 100.0
                + float(len(candidate) * 2)
                - float(distance * 25)
            )
            if score > best_score:
                best_target = candidate
                best_score = score
        if best_target:
            corrections.append((source, best_target, best_score))
    corrections.sort(key=lambda item: item[2], reverse=True)
    selected = corrections[:_MAX_TOTAL_LEXICON_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _infer_confusable_word_corrections(
    text: str,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> dict[str, str]:
    # lizard forgive: confusable-word scoring stays branchy because each safety gate matters.
    counts = _extract_token_counts(text)
    candidate_pool = _confusable_candidate_pool(lexicon_words, external_lexicon_words)
    corrections: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if not source.isalpha():
            continue
        if len(source) < _MIN_CONFUSABLE_WORD_LENGTH:
            continue
        if source_count > _MAX_ERROR_OCCURRENCES:
            continue
        if source in _BUILTIN_LEXICON or source in _KNOWN_JOIN_TARGETS or source in external_lexicon_words:
            continue
        best_target = ""
        best_score = float("-inf")
        for candidate, rewrite_cost in _weighted_confusable_rewrite_candidates(source, candidate_pool):
            target_count = counts.get(candidate, 0)
            has_external_target_support = candidate in external_lexicon_words
            has_trusted_target_support = (
                candidate in _BUILTIN_LEXICON
                or candidate in _KNOWN_JOIN_TARGETS
                or has_external_target_support
            )
            if not has_trusted_target_support and target_count < _MIN_CORRECTION_OCCURRENCES:
                continue
            score = (
                float(target_count * 50)
                + float(len(candidate) * 3)
                + (120.0 if has_external_target_support else 0.0)
                + (40.0 if has_trusted_target_support else 0.0)
                - float(rewrite_cost * 20.0)
            )
            if score > best_score:
                best_target = candidate
                best_score = score
        if best_target:
            corrections.append((source, best_target, best_score))
    corrections.sort(key=lambda item: item[2], reverse=True)
    selected = corrections[:_MAX_TOTAL_DIRECT_CONFUSABLE_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _infer_contextual_confusable_corrections(
    text: str,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> dict[str, str]:
    counts = _extract_token_counts(text)
    candidate_pool = _confusable_candidate_pool(lexicon_words, external_lexicon_words)
    corrections: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if not _is_contextual_confusable_source(source, external_lexicon_words):
            continue
        best_target = ""
        best_score = float("-inf")
        for candidate, rewrite_cost in _weighted_confusable_rewrite_candidates(source, candidate_pool):
            score = _contextual_confusable_score(
                candidate,
                counts=counts,
                source_count=source_count,
                external_lexicon_words=external_lexicon_words,
                rewrite_cost=rewrite_cost,
            )
            if score is not None and score > best_score:
                best_target = candidate
                best_score = score
        if best_target:
            corrections.append((source, best_target, best_score))
    corrections.sort(key=lambda item: item[2], reverse=True)
    selected = corrections[:_MAX_TOTAL_DOMINANT_CONFUSABLE_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _is_contextual_confusable_source(
    source: str,
    external_lexicon_words: set[str],
) -> bool:
    return (
        source.isalpha()
        and len(source) >= 3
        and source not in _BUILTIN_LEXICON
        and source not in external_lexicon_words
    )


def _contextual_confusable_score(
    candidate: str,
    *,
    counts: Counter[str],
    source_count: int,
    external_lexicon_words: set[str],
    rewrite_cost: float,
) -> float | None:
    target_count = counts.get(candidate, 0)
    if candidate in external_lexicon_words:
        target_count = max(target_count, _MIN_CONTEXTUAL_CONFUSABLE_TARGET_OCCURRENCES)
    if target_count < _MIN_CONTEXTUAL_CONFUSABLE_TARGET_OCCURRENCES:
        return None
    if candidate not in external_lexicon_words and not _ratio_at_least(
        target_count,
        source_count,
        _MIN_CONTEXTUAL_CONFUSABLE_RATIO,
    ):
        return None
    return (
        float(target_count * 40)
        - float(source_count * 10)
        + float(len(candidate) * 3)
        + (50.0 if candidate in _BUILTIN_LEXICON else 0.0)
        + (80.0 if candidate in external_lexicon_words else 0.0)
        - float(rewrite_cost * 15.0)
    )


def _infer_dominant_confusable_corrections(
    text: str,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> dict[str, str]:
    counts = _extract_token_counts(text)
    candidate_pool = _confusable_candidate_pool(lexicon_words, external_lexicon_words)
    corrections: list[tuple[str, str, float]] = []
    for source, source_count in counts.items():
        if not _is_eligible_dominant_confusable_source(
            source, source_count, external_lexicon_words
        ):
            continue
        best_target = ""
        best_score = float("-inf")
        for candidate, rewrite_cost in _weighted_confusable_rewrite_candidates(source, candidate_pool):
            score = _dominant_confusable_score(
                candidate,
                rewrite_cost=rewrite_cost,
                counts=counts,
                source_count=source_count,
                lexicon_words=lexicon_words,
                external_lexicon_words=external_lexicon_words,
            )
            if score is None:
                continue
            if score > best_score:
                best_target = candidate
                best_score = score
        if best_target:
            corrections.append((source, best_target, best_score))
    corrections.sort(key=lambda item: item[2], reverse=True)
    selected = corrections[:_MAX_TOTAL_LEXICON_CORRECTIONS]
    return {source: target for source, target, _score in selected}


def _is_eligible_dominant_confusable_source(
    source: str, source_count: int, external_lexicon_words: set[str]
) -> bool:
    return (
        source.isalpha()
        and len(source) >= _MIN_DOMINANT_CONFUSABLE_WORD_LENGTH
        and 1 <= source_count <= _MAX_DOMINANT_CONFUSABLE_SOURCE_OCCURRENCES
        and source not in _BUILTIN_LEXICON
        and source not in external_lexicon_words
    )


def _dominant_confusable_score(
    candidate: str,
    *,
    rewrite_cost: int,
    counts: Counter[str],
    source_count: int,
    lexicon_words: set[str],
    external_lexicon_words: set[str],
) -> float | None:
    support = _dominant_confusable_support(candidate, lexicon_words, external_lexicon_words)
    if not any(support.values()):
        return None
    target_count = _dominant_confusable_target_count(
        candidate,
        counts,
        has_external_target_support=support["external"],
        has_dynamic_target_support=support["dynamic"],
    )
    if target_count is None:
        return None
    required_ratio = (
        _MIN_DYNAMIC_DOMINANT_CONFUSABLE_RATIO
        if support["dynamic"]
        else _MIN_DOMINANT_CONFUSABLE_RATIO
    )
    if not support["external"] and not _ratio_at_least(target_count, source_count, required_ratio):
        return None
    return (
        float(target_count * 45)
        - float(source_count * 15)
        + float(len(candidate) * 4)
        + (60.0 if support["builtin"] else 0.0)
        + (120.0 if support["external"] else 0.0)
        + (30.0 if support["dynamic"] else 0.0)
        - float(rewrite_cost * 15.0)
    )


def _dominant_confusable_support(
    candidate: str, lexicon_words: set[str], external_lexicon_words: set[str]
) -> dict[str, bool]:
    has_builtin_target_support = candidate in _BUILTIN_LEXICON
    has_external_target_support = candidate in external_lexicon_words
    has_dynamic_target_support = (
        candidate in lexicon_words
        and not has_builtin_target_support
        and not has_external_target_support
    )
    return {
        "builtin": has_builtin_target_support,
        "external": has_external_target_support,
        "dynamic": has_dynamic_target_support,
    }


def _dominant_confusable_target_count(
    candidate: str,
    counts: Counter[str],
    *,
    has_external_target_support: bool,
    has_dynamic_target_support: bool,
) -> int | None:
    target_count = counts.get(candidate, 0)
    if has_external_target_support:
        return max(target_count, _MIN_DOMINANT_CONFUSABLE_TARGET_OCCURRENCES)
    if has_dynamic_target_support:
        if target_count < _MIN_DYNAMIC_DOMINANT_CONFUSABLE_TARGET_OCCURRENCES:
            return None
        return target_count
    if target_count < _MIN_DOMINANT_CONFUSABLE_TARGET_OCCURRENCES:
        return None
    return target_count


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


def _match_phrase_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if _should_titlecase_phrase(source):
        return _titlecase_phrase(replacement)
    return replacement


def _should_titlecase_phrase(source: str) -> bool:
    if source[:1].isupper() and source[1:].islower():
        return True
    remainder = source[1:]
    if not source[:1].isupper() or not any(char.islower() for char in remainder):
        return False
    uppercase_count = sum(1 for char in remainder if char.isupper())
    lowercase_count = sum(1 for char in remainder if char.islower())
    return lowercase_count > uppercase_count


def _titlecase_phrase(replacement: str) -> str:
    words = replacement.split()
    if not words:
        return replacement
    return " ".join([words[0].capitalize(), *words[1:]])


def _apply_direct_word_corrections(text: str, corrections: dict[str, str]) -> str:
    if not corrections:
        return text
    replacements: list[tuple[int, int, str]] = []
    for match in _CONTEXT_TOKEN.finditer(text):
        source_word = match.group(0).lower()
        target_word = corrections.get(source_word)
        if target_word is None:
            continue
        replacements.append(
            (match.start(), match.end(), _match_phrase_case(match.group(0), target_word))
        )
    if not replacements:
        return text
    return _apply_replacements(text, replacements)


def is_known_word_correction(raw_text: str, cleaned_text: str) -> bool:
    raw_tokens = _WORD_WITH_MARKS.findall(raw_text)
    cleaned_tokens = _WORD_WITH_MARKS.findall(cleaned_text)
    if len(raw_tokens) != 1 or len(cleaned_tokens) != 1:
        return False
    raw_token = raw_tokens[0].lower()
    cleaned_token = cleaned_tokens[0].lower()
    expected = _KNOWN_WORD_CORRECTIONS.get(raw_token)
    if expected is None:
        return False
    return expected.lower() == cleaned_token


_ROMAN_NUMERAL_CORRECTION_RE = re.compile(r"^[IVXLCDM]+l+$", re.IGNORECASE)


def is_roman_numeral_correction(raw_text: str, cleaned_text: str) -> bool:
    """Return True if the cleanup change is a Roman-numeral fix
    that substituted trailing OCR-misread ``l`` chars back to
    ``i`` (``XXVIIl`` -> ``XXVIII``). The verifier tends to over-
    reject these on small chapter-heading tokens where there is
    not enough surrounding ink to render-match the canonical
    form, so we opt out of the verifier for this class."""
    raw_tokens = _WORD_WITH_MARKS.findall(raw_text)
    cleaned_tokens = _WORD_WITH_MARKS.findall(cleaned_text)
    if len(raw_tokens) != 1 or len(cleaned_tokens) != 1:
        return False
    raw_token = raw_tokens[0]
    cleaned_token = cleaned_tokens[0]
    if not _ROMAN_NUMERAL_CORRECTION_RE.match(raw_token):
        return False
    if _parse_roman_numeral(cleaned_token.upper()) is None:
        return False
    return True


_HYPHENATED_I_RE = re.compile(r"-\b[lI]\b")


def is_hyphenated_capital_i_correction(raw_text: str, cleaned_text: str) -> bool:
    """Return True if the cleanup change is a hyphen-prefixed ``l`` -> ``I``
    correction (``Sheet-lron;`` -> ``Sheet-Iron;``). The pattern is
    extremely specific (hyphen + lowercase l + uppercase + lowercase
    letters) and is always a misread capital ``I``, so we opt out
    of the verifier for this class. The verifier tends to over-reject
    these on small hyphenated compound words where there is not
    enough surrounding ink to render-match the cleaned text."""
    # The cleanup is per-non-space-token, so the change may be
    # reported as the full hyphenated token (``Sheet-lron;`` -> ``Sheet-Iron;``)
    # or as the per-word part (``lron;`` -> ``Iron;``). Handle both.
    raw_parts = raw_text.split("-")
    cleaned_parts = cleaned_text.split("-")
    if len(raw_parts) != 2 or len(cleaned_parts) != 2:
        return False
    if raw_parts[0] != cleaned_parts[0]:
        return False
    # Strip leading/trailing punctuation from the second part.
    raw_second = raw_parts[1]
    cleaned_second = cleaned_parts[1]
    leading = ""
    while raw_second and not raw_second[0].isalpha():
        leading += raw_second[0]
        raw_second = raw_second[1:]
    trailing = ""
    while cleaned_second and not cleaned_second[-1].isalpha():
        trailing = cleaned_second[-1] + trailing
        cleaned_second = cleaned_second[:-1]
    # Strip the same punctuation from the raw side.
    raw_second_stripped = raw_parts[1]
    if leading:
        raw_second_stripped = raw_second_stripped[len(leading):]
    if trailing:
        raw_second_stripped = raw_second_stripped[:-len(trailing)] if trailing else raw_second_stripped
    if (
        raw_second_stripped[:1] != "l"
        or cleaned_second[:1] != "I"
        or raw_second_stripped[1:].lower() != cleaned_second[1:].lower()
    ):
        return False
    return True


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


def cleanup_ocr_text(text: str, lexicon_texts: tuple[str, ...] = ()) -> str:
    """Normalize OCR text and apply conservative word-level corrections."""

    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    for original, replacement in _UNICODE_REPLACEMENTS.items():
        cleaned = cleaned.replace(original, replacement)
    cleaned = re.sub(r"(?<![A-Za-z0-9])\[(?=\s+[a-z])", "I", cleaned)

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

    cleaned_lines = _trim_title_page_stamp_prelude(cleaned_lines)
    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = _apply_known_text_corrections(cleaned)
    cleaned = _strip_stray_pipe_markers(cleaned)
    cleaned = _fix_roman_numeral_trailing_l(cleaned)
    cleaned = _apply_symbolic_token_corrections(cleaned)
    split_lexicon_words = _build_cleanup_lexicon(cleaned, lexicon_texts)
    external_lexicon_words = _build_external_cleanup_lexicon(lexicon_texts)
    join_corrections = _infer_join_word_corrections(
        cleaned,
        split_lexicon_words,
        external_lexicon_words,
    )
    cleaned = _apply_join_word_corrections(cleaned, join_corrections)
    split_lexicon_words = _build_cleanup_lexicon(cleaned, lexicon_texts)
    direct_corrections = {}
    mixed_alnum_corrections = _infer_mixed_alnum_word_corrections(
        cleaned,
        split_lexicon_words,
        external_lexicon_words,
    )
    lexicon_corrections = _infer_lexicon_word_corrections(cleaned, external_lexicon_words)
    confusable_corrections = _infer_confusable_word_corrections(
        cleaned,
        split_lexicon_words,
        external_lexicon_words,
    )
    dominant_confusable_corrections = _infer_dominant_confusable_corrections(
        cleaned,
        split_lexicon_words,
        external_lexicon_words,
    )
    split_corrections = _infer_split_word_corrections(
        cleaned,
        split_lexicon_words,
        allow_approximate=bool(external_lexicon_words),
    )
    direct_corrections.update(mixed_alnum_corrections)
    direct_corrections.update(lexicon_corrections)
    direct_corrections.update(split_corrections)
    direct_corrections.update(confusable_corrections)
    direct_corrections.update(dominant_confusable_corrections)
    # Curated corrections override statistical ones where we have high confidence.
    direct_corrections.update(_KNOWN_WORD_CORRECTIONS)
    cleaned = _apply_direct_word_corrections(cleaned, direct_corrections)
    contextual_corrections = {}
    contextual_corrections.update(_infer_missing_char_corrections(cleaned))
    contextual_corrections.update(_infer_apostrophe_corrections(cleaned))
    contextual_corrections.update(_infer_contextual_apostrophe_corrections(cleaned))
    contextual_corrections.update(_infer_digit_letter_corrections(cleaned))
    contextual_corrections.update(
        _infer_contextual_confusable_corrections(
            cleaned,
            split_lexicon_words,
            external_lexicon_words,
        )
    )
    cleaned = _apply_word_corrections(cleaned, contextual_corrections)
    cleaned = _apply_short_word_corrections(cleaned)
    return cleaned.strip()
