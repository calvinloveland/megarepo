"""Tests for the GRAND universal decoder."""

import random

from luc_sim.codes import build_registry
from luc_sim.grand import grand_decode


def _llrs_from_bits(bits: int, n: int, amp: float = 3.0) -> list[float]:
    return [amp if (bits >> (n - 1 - i)) & 1 else -amp for i in range(n)]


def test_clean_decode_is_immediate():
    for c in build_registry().values():
        msg = 0b1011 & ((1 << c.k) - 1)
        cw = c.encode(msg)
        cand, q = grand_decode(_llrs_from_bits(cw, c.n), c)
        assert cand == cw, c.name
        assert q == 1, c.name


def test_single_bit_error_corrected():
    rng = random.Random(1)
    for c in build_registry().values():
        recovered = 0
        for _ in range(100):
            msg = rng.getrandbits(c.k)
            cw = c.encode(msg)
            bad = cw ^ (1 << rng.randrange(c.n))
            cand, _ = grand_decode(_llrs_from_bits(bad, c.n), c)
            if cand is not None and c.extract(cand) == msg:
                recovered += 1
        assert recovered == 100, f"{c.name}: {recovered}/100 single-bit fixes"


def test_two_bit_error_corrected_for_d5_codes():
    rng = random.Random(2)
    for name in ("bch(15,7)", "bch(31,16)", "rs(7,3)", "polar(32,16)", "ldpc(28,14)", "turbo-lite(8)"):
        c = build_registry()[name]
        recovered = 0
        trials = 60
        for _ in range(trials):
            msg = rng.getrandbits(c.k)
            cw = c.encode(msg)
            bad = cw
            for _ in range(2):
                bad ^= 1 << rng.randrange(c.n)
            cand, _ = grand_decode(_llrs_from_bits(bad, c.n), c, max_queries=16384)
            if cand is not None and c.extract(cand) == msg:
                recovered += 1
        assert recovered >= trials - 1, f"{name}: {recovered}/{trials}"


def test_query_budget_respected():
    """rep11 has just two codewords; a random word is far from both, so a tiny
    query budget must exhaust without finding anything."""
    c = build_registry()["rep11"]
    rng = random.Random(3)
    bad = rng.getrandbits(11)
    llrs = [1.0 if (bad >> (10 - i)) & 1 else -1.0 for i in range(11)]
    cand, q = grand_decode(llrs, c, max_queries=50)
    assert q <= 50
    assert cand is None  # budget too small to reach the needed error weight


def test_reliability_ordering_matters():
    """GRAND searches least-reliable bits first, so correct soft info finds the
    true error pattern in a few queries instead of exhausting weight classes.

    (Hamming codes are perfect, so a 2-error word can sit distance-1 from a
    different codeword and GRAND would correctly ML-decode to it -- use BCH d=5
    where the 2-error pattern is uniquely nearest.)"""
    c = build_registry()["bch(15,7)"]
    rng = random.Random(4)
    msg = rng.getrandbits(7)
    cw = c.encode(msg)
    # flip two *word* positions and mark exactly those two as unreliable
    bad = cw ^ (1 << (14 - 3)) ^ (1 << (14 - 12))
    llrs = [1.0 if (bad >> (14 - i)) & 1 else -1.0 for i in range(15)]
    llrs[3] = 0.1 * llrs[3]
    llrs[12] = 0.1 * llrs[12]
    cand, q = grand_decode(llrs, c)
    assert cand is not None and c.extract(cand) == msg
    # the weight-2 pattern is found right after the 15 weight-1 patterns
    assert q <= 20, f"took {q} queries"
