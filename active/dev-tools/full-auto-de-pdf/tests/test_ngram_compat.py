"""Tests for the optional n-gram language-model compatibility shim."""

from __future__ import annotations

import pytest

from full_auto_de_pdf import ngram_compat
from full_auto_de_pdf.ngram_compat import (
    bigram_coverage,
    has_language_model_signal,
    trigram_coverage,
    trigram_log_likelihood,
)


@pytest.fixture(autouse=True)
def _clear_caches() -> None:
    """Reset the LRU caches so each test gets a fresh module state."""

    ngram_compat.get_common_trigrams.cache_clear()
    ngram_compat.get_common_bigrams.cache_clear()


def test_has_language_model_signal_returns_bool() -> None:
    assert isinstance(has_language_model_signal(), bool)


def test_trigram_coverage_zero_for_short_text() -> None:
    assert trigram_coverage("the cat") == 0.0
    assert trigram_coverage("a") == 0.0
    assert trigram_coverage("") == 0.0


def test_bigram_coverage_zero_for_short_text() -> None:
    assert bigram_coverage("the") == 0.0
    assert bigram_coverage("") == 0.0


def test_trigram_log_likelihood_zero_for_short_text() -> None:
    assert trigram_log_likelihood("the cat") == 0.0
    assert trigram_log_likelihood("") == 0.0


@pytest.mark.skipif(
    not has_language_model_signal(),
    reason="NLTK brown corpus not available",
)
def test_trigram_coverage_prefers_natural_prose() -> None:
    natural = "one of the united states is a great place"
    garbled = "thc quick broun fox jumps ovcr thc lazy dog"
    assert trigram_coverage(natural) > trigram_coverage(garbled)


@pytest.mark.skipif(
    not has_language_model_signal(),
    reason="NLTK brown corpus not available",
)
def test_bigram_coverage_prefers_natural_prose() -> None:
    natural = "the quick brown fox"
    garbled = "thc qulck broun fcx"
    assert bigram_coverage(natural) > bigram_coverage(garbled)


@pytest.mark.skipif(
    not has_language_model_signal(),
    reason="NLTK brown corpus not available",
)
def test_trigram_log_likelihood_prefers_natural_prose() -> None:
    natural = "one of the united states is a great place to live"
    garbled = "thc qulck broun fox jumps ovcr thc lazy dog"
    assert trigram_log_likelihood(natural) > trigram_log_likelihood(garbled)


@pytest.mark.skipif(
    not has_language_model_signal(),
    reason="NLTK brown corpus not available",
)
def test_trigram_coverage_bounded_between_zero_and_one() -> None:
    assert 0.0 <= trigram_coverage("the quick brown fox") <= 1.0
    assert 0.0 <= trigram_coverage("one of the united states is great") <= 1.0
    assert 0.0 <= trigram_coverage("xxxxx xxxxx xxxxx xxxxx") <= 1.0


def test_get_common_trigrams_caches_result() -> None:
    first = ngram_compat.get_common_trigrams()
    second = ngram_compat.get_common_trigrams()
    assert first is second
