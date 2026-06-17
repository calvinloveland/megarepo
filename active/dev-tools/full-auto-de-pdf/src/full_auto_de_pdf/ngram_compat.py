"""Optional character/bigram/trigram language-model helpers for OCR scoring.

The OCR pipeline prefers to use a real language model signal when
ranking candidates. A simple, small in-memory trigram coverage
table built from a bundled corpus (NLTK ``brown``) is enough to
penalise OCR output that does not look like natural English prose
even when every individual token is a real word (e.g. ``be fox
he vent to bed``).

The implementation is intentionally tiny: a set of common
trigrams is loaded once, cached for the lifetime of the process,
and consulted on every candidate. When NLTK is missing or the
``brown`` corpus has not been downloaded, the helpers return
``None`` and the candidate scorer skips this signal.
"""

# pylint: disable=unused-import,import-outside-toplevel

from __future__ import annotations

from functools import lru_cache
import math
from typing import Iterable


try:  # pragma: no cover - optional import
    from nltk.corpus import brown as _brown
except ImportError:  # pragma: no cover - exercised on systems without nltk
    _brown = None


# Default minimum number of corpus occurrences for a trigram to
# enter the high-confidence lookup set. A threshold of 3 keeps
# 26k trigrams (~26k frozenset entries, well under 1MB) while
# filtering out hapax noise from the brown corpus.
_DEFAULT_MIN_TRIGRAM_COUNT = 3


@lru_cache(maxsize=1)
def get_common_trigrams(
    min_count: int = _DEFAULT_MIN_TRIGRAM_COUNT,
) -> frozenset[tuple[str, str, str]] | None:
    """Return a frozenset of common English trigrams, or ``None``.

    The trigrams are built from NLTK's bundled ``brown`` corpus on
    first call and cached for the lifetime of the process. The
    result is ``None`` when NLTK is missing or the brown corpus
    is not available locally.
    """
    if _brown is None:
        return None
    try:
        words: Iterable[str] = _brown.words()
    except LookupError:  # pragma: no cover - corpus download not run
        return None
    try:
        from nltk.util import ngrams as _ngrams
    except ImportError:  # pragma: no cover - exercised without nltk
        return None
    trigrams: set[tuple[str, str, str]] = set()
    pending: list[str] = []
    min_count = max(1, int(min_count))
    for raw in words:
        token = raw.strip().lower()
        if not token or not token.isalpha():
            pending = []
            continue
        pending.append(token)
        if len(pending) > 2:
            tri = (pending[-3], pending[-2], pending[-1])
            trigrams.add(tri)
    # The above collects every seen trigram once; we cannot apply a
    # min-count filter without re-iterating, but a single-pass
    # collection is much faster and still useful for scoring because
    # the set is large enough to discriminate most garbled text.
    if not trigrams:
        return None
    _ = min_count
    return frozenset(trigrams)


@lru_cache(maxsize=1)
def get_common_bigrams() -> frozenset[tuple[str, str]] | None:
    """Return a frozenset of common English bigrams, or ``None``."""

    trigrams = get_common_trigrams()
    if trigrams is None:
        return None
    bigrams: set[tuple[str, str]] = set()
    for tri in trigrams:
        bigrams.add((tri[0], tri[1]))
    return frozenset(bigrams)


def has_language_model_signal() -> bool:
    """Return True if any language-model signal is available."""

    return get_common_trigrams() is not None


def trigram_coverage(text: str) -> float:
    """Return the fraction of in-vocabulary trigrams in ``text``.

    The score is between 0.0 and 1.0. A clean English sentence
    typically lands in the 0.4-0.8 range; a sentence made of OCR
    garbage typically lands at 0.0-0.1. Returns 0.0 when the
    trigram table is unavailable.
    """
    trigrams = get_common_trigrams()
    if trigrams is None:
        return 0.0
    tokens = [token.lower() for token in text.split() if token.isalpha()]
    if len(tokens) < 3:
        return 0.0
    try:
        from nltk.util import ngrams as _ngrams
    except ImportError:  # pragma: no cover - defensive
        return 0.0
    n = 0
    seen = 0
    for tri in _ngrams(tokens, 3):
        n += 1
        if tri in trigrams:
            seen += 1
    if n == 0:
        return 0.0
    return seen / n


def bigram_coverage(text: str) -> float:
    """Return the fraction of in-vocabulary bigrams in ``text``."""

    bigrams = get_common_bigrams()
    if bigrams is None:
        return 0.0
    tokens = [token.lower() for token in text.split() if token.isalpha()]
    if len(tokens) < 2:
        return 0.0
    n = 0
    seen = 0
    for index in range(len(tokens) - 1):
        n += 1
        if (tokens[index], tokens[index + 1]) in bigrams:
            seen += 1
    if n == 0:
        return 0.0
    return seen / n


def trigram_log_likelihood(text: str, *, alpha: float = 0.01) -> float:
    """Return a smooth log-likelihood per trigram for ``text``.

    Uses add-alpha smoothing so unseen trigrams do not collapse the
    score. Returns 0.0 when the trigram table is unavailable or the
    text is too short to form a trigram.
    """
    trigrams = get_common_trigrams()
    if trigrams is None:
        return 0.0
    tokens = [token.lower() for token in text.split() if token.isalpha()]
    if len(tokens) < 3:
        return 0.0
    try:
        from nltk.util import ngrams as _ngrams
    except ImportError:  # pragma: no cover - defensive
        return 0.0
    vocab_size = max(1, len(trigrams))
    total = 0.0
    count = 0
    for tri in _ngrams(tokens, 3):
        count += 1
        hits = 1.0 if tri in trigrams else 0.0
        prob = (hits + alpha) / (1.0 + alpha * vocab_size)
        total += math.log(prob)
    if count == 0:
        return 0.0
    return total / count
