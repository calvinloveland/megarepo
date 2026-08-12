"""GRAND-style universal decoder.

Guessing Random Additive Noise Decoding (GRAND) works on one idea: instead of
*inverting* a code, guess the noise.  It enumerates candidate error patterns in
order of increasing likelihood and returns the first guess for which the received
word minus the guess is a *valid codeword*.

The decoder never inspects the internal structure of a code -- it only asks the
code's membership oracle ``code.contains(c)``.  That is what makes it universal:
the same algorithm decodes Hamming, BCH, Reed-Solomon, Polar, LDPC and Turbo codes
alike, and any new code registered later (the LUC field-update story) is decoded
with zero changes.

This implementation follows the ORBGRAND spirit: bit positions are sorted by
reliability (|LLR|) and error patterns are enumerated over the least-reliable
positions first.  The number of oracle queries is bounded by `max_queries`, which
doubles as the decoder's work/power proxy for the LUC metrics.
"""

from __future__ import annotations

import itertools
from typing import Optional, Sequence

from luc_sim.linear import LinearCode

DecodeResult = tuple[Optional[int], int]  # (codeword or None, queries used)


def grand_decode(
    llrs: Sequence[float], code: LinearCode, max_queries: int = 4096
) -> DecodeResult:
    """Decode soft bits with the universal GRAND algorithm.

    Returns ``(codeword, queries)``; codeword is None if the query budget was
    exhausted without finding a valid codeword (a decode failure).
    """
    n = code.n
    hard = 0
    rel: list[float] = []
    for i in range(n):
        l = llrs[i]
        hard = (hard << 1) | (1 if l > 0 else 0)
        rel.append(abs(l))

    # least-reliable-first ordering over bit positions
    order = sorted(range(n), key=rel.__getitem__)
    masks = [1 << (n - 1 - order[i]) for i in range(n)]

    queries = 0
    if code.contains(hard):
        return hard, 1
    queries = 1

    for w in range(1, n + 1):
        for comb in itertools.combinations(range(n), w):
            e = 0
            for idx in comb:
                e ^= masks[idx]
            cand = hard ^ e
            if code.contains(cand):
                return cand, queries + 1
            queries += 1
            if queries >= max_queries:
                return None, queries
        if queries >= max_queries:
            break
    return None, queries


def decode_frame_llrs(
    llrs: Sequence[float], code: LinearCode, max_queries: int = 4096
) -> tuple[Optional[int], int]:
    """Decode and return the extracted *message* (or None) plus query count."""
    cand, q = grand_decode(llrs, code, max_queries)
    if cand is None:
        return None, q
    return code.extract(cand), q
