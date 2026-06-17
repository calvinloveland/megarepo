"""Shared optional word-frequency imports for OCR scoring and cleanup.

The pipeline prefers a real word frequency signal over a tiny hard-coded
common-words list when ranking OCR candidates and gating cleanup
corrections. ``wordfreq`` (Zipf frequencies) and ``nltk.corpus.words``
(a 200k+ English word list) are both used as soft optional dependencies.

When neither is installed, the helpers fall back to a length-based proxy
that still penalizes obvious garbage tokens.
"""

# pylint: disable=unused-import,too-many-return-statements

from __future__ import annotations

from functools import lru_cache
import math
from typing import Any, Callable


try:  # pragma: no cover - optional import
    from wordfreq import word_frequency as _word_frequency
except ImportError:  # pragma: no cover - exercised on systems without wordfreq
    _word_frequency = None


try:  # pragma: no cover - optional import
    from nltk.corpus import words as _nltk_words
except ImportError:  # pragma: no cover - exercised on systems without nltk
    _nltk_words = None


# Frequency above which a token is treated as "a real English word"
# for the purposes of OCR scoring. The wordfreq Zipf scale runs roughly
# 0 (extremely rare / OOV) to 8 (very common). A real English word for
# which wordfreq has any data almost always sits above ~1e-7; OCR
# garbage tokens that happen to share a substring with a known word
# typically return values much lower than that.
_DEFAULT_MIN_REAL_WORD_FREQUENCY = 1e-7
# Stricter cutoff used by the cleanup gate before it accepts a
# correction. The cleanup should only introduce tokens that look like
# words the OCR system itself could have produced, so we require a
# higher floor.
_CLEANUP_MIN_REAL_WORD_FREQUENCY = 1e-6
# Threshold below which the NLTK fallback is consulted. We use NLTK as
# the primary "is a real English word" check because wordfreq's
# wordlist is too permissive (it includes learned typos like "worid"),
# but we use wordfreq's frequency for ranking and for the
# proper-noun / case-sensitive path.
_NLTK_FALLBACK_FREQUENCY = 1e-7


@lru_cache(maxsize=1)
def get_word_frequency_lookup() -> Callable[[str], float] | None:
    """Return a ``word -> Zipf frequency`` callable, or ``None``.

    The result is cached because the wrapper has to do an attribute
    lookup that is otherwise repeated on every token.
    """
    if _word_frequency is None:
        return None
    lookup = _word_frequency

    def _lookup(token: str) -> float:
        try:
            return float(lookup(token, "en"))
        except (TypeError, ValueError):  # pragma: no cover - defensive
            return 0.0

    return _lookup


@lru_cache(maxsize=1)
def get_nltk_word_set() -> frozenset[str] | None:
    """Return the NLTK English word set, or ``None`` if NLTK is not installed.

    The NLTK corpus is only loaded once because its ``words()`` call
    parses a 200k+ line file and would otherwise dominate candidate
    scoring time.
    """
    if _nltk_words is None:
        return None
    try:
        raw_words: Any = _nltk_words.words()
    except LookupError:  # pragma: no cover - corpus download not run
        return None
    return frozenset(word.strip().lower() for word in raw_words if word and word.isalpha())


def has_real_word_signal() -> bool:
    """Return True if any real-word signal is available."""

    return get_word_frequency_lookup() is not None or get_nltk_word_set() is not None


def real_word_frequency(token: str) -> float:
    """Return a Zipf frequency for ``token`` when wordfreq is available.

    Returns 0.0 when the dependency is missing or the token is empty.
    """
    lookup = get_word_frequency_lookup()
    if lookup is None or not token:
        return 0.0
    return lookup(token)


def is_in_nltk_word_list(token: str) -> bool | None:
    """Return True/False if the token is in the NLTK word list, ``None`` if NLTK is missing."""

    word_set = get_nltk_word_set()
    if word_set is None:
        return None
    return token in word_set


def _short_word_ok(token: str) -> bool:
    """Return True for short tokens that should not be gated on word lists.

    Common 1-2 letter words ("a", "an", "of", "to", "in", "on", "at",
    "by", "he", "it", "is", "as", "be", "we", "my", "me", "us", "so",
    "do", "no") almost always OCR cleanly and any garbage of the
    same length is too ambiguous to gate on.
    """
    if len(token) > 2:
        return False
    if not token.isalpha():
        return False
    return True


def _core_alpha_part(token: str) -> str:
    """Return the alpha-only core of a token for dictionary lookup.

    Contractions like ``don't`` and ``it's`` should still pass the
    gate when the bare ``don``/``it`` part is a real word, so we strip
    apostrophes before consulting the frequency / NLTK checks.
    """
    if not token:
        return ""
    return "".join(char for char in token if char.isalpha())


def is_probable_real_word(
    token: str,
    *,
    min_frequency: float = _DEFAULT_MIN_REAL_WORD_FREQUENCY,
) -> bool:
    """Return True if ``token`` looks like a real English word.

    The check tries the NLTK word list first (it is curated and rejects
    OCR typos) and falls back to wordfreq's frequency when NLTK is
    missing. The frequency floor is intentionally well above the
    background "sub-word" noise that wordfreq returns for unknown
    tokens, which is what causes ``worid``/``witl``/``tbat`` to pass
    an unfiltered wordfreq check.

    Tokens that contain a non-alpha run alongside an alpha core (e.g.
    contractions like ``don't``) are accepted when the alpha core
    looks like a real word.
    """
    if not token:
        return False
    core = _core_alpha_part(token)
    if not core:
        return False
    if _short_word_ok(core):
        return True
    in_nltk = is_in_nltk_word_list(core)
    if in_nltk is True:
        return True
    frequency = real_word_frequency(core)
    if frequency >= min_frequency:
        return True
    if in_nltk is None:
        # No NLTK and frequency is below the floor. Use a length-based
        # proxy: very long alphabetic tokens are much more likely to
        # be real than short ones because the chance of OCR producing
        # a long all-alpha string by accident is small.
        return len(core) >= 8
    return False


def cleanup_word_acceptable(
    token: str,
    allowed_words: set[str] | None = None,
) -> bool:
    """Return True if a cleanup correction producing ``token`` is acceptable.

    Stricter than ``is_probable_real_word``: the cleanup should only
    introduce corrections that land on a word the OCR system itself
    could plausibly have produced, so we require a higher frequency
    floor and a positive NLTK hit when the floor is missed.

    As with ``is_probable_real_word`` the alpha core of a token is
    consulted so contractions like ``don't`` and ``won't`` are still
    accepted.

    Multi-word targets (e.g. ``"fox jumps"`` produced by a split
    correction) are accepted when every word passes the gate
    individually, so a split correction can land on a phrase made
    entirely of real words.

    The optional ``allowed_words`` set is consulted first: tokens
    that the caller has explicitly declared acceptable (for example
    a user-supplied reference lexicon) always pass, even when the
    frequency / NLTK signal is borderline. This keeps the gate from
    blocking corrections the operator already trusts.
    """
    if not token:
        return False
    if any(char.isspace() for char in token):
        words = token.split()
        if not words:
            return False
        return all(_cleanup_single_word_acceptable(word, allowed_words) for word in words)
    return _cleanup_single_word_acceptable(token, allowed_words)


def _cleanup_single_word_acceptable(
    token: str,
    allowed_words: set[str] | None = None,
) -> bool:
    if not token:
        return False
    core = _core_alpha_part(token)
    if not core:
        return False
    if allowed_words is not None and core in allowed_words:
        return True
    if _short_word_ok(core):
        return True
    in_nltk = is_in_nltk_word_list(core)
    if in_nltk is True:
        return True
    frequency = real_word_frequency(core)
    if frequency >= _CLEANUP_MIN_REAL_WORD_FREQUENCY:
        return True
    if in_nltk is None:
        return len(core) >= 9
    return False


def real_word_log_frequency(token: str) -> float:
    """Return ``log10(frequency + 1e-12)`` for ``token``, clamped at -12.

    Used by candidate scoring to turn Zipf frequencies into a smooth
    score component. Returns ``-12.0`` when wordfreq is unavailable
    or the token is empty.
    """
    if not token:
        return -12.0
    frequency = real_word_frequency(token)
    if frequency <= 0.0:
        return -12.0
    return max(-12.0, min(8.0, math.log10(frequency)))
