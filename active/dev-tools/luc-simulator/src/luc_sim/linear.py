"""Linear block code representation and generic construction helpers.

The whole simulator is built around one idea: every code -- whatever its family -- is
exposed to the decoder through a single *membership oracle* ``contains(codeword)``.
The GRAND universal decoder needs nothing else, which is precisely the LUC bet: one
algorithm decodes every known code, plus any code registered later in the field.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from luc_sim.bits import bit, gf2_rref

# Codes with k <= this can be fully enumerated into a frozenset codebook; larger
# codes (e.g. RS(15,11) with k=44) fall back to a structured syndrome oracle.
ENUMERABLE_MAX_K = 16


@dataclass
class LinearCode:
    """A binary linear block code with an exact membership oracle."""

    name: str
    family: str
    n: int  # codeword length (bits)
    k: int  # message length (bits)
    generator: tuple[int, ...]  # k basis rows, each an n-bit int (RREF; info positions are pivots)
    info_positions: tuple[int, ...]  # n-bit positions (0 = MSB) carrying the message
    d: Optional[int] = None  # (design) minimum distance
    params: dict = field(default_factory=dict)
    codebook: Optional[frozenset] = None  # set of all 2^k codewords when enumerable
    syndrome: Optional[Callable[[int], bool]] = None  # structured membership oracle

    @property
    def rate(self) -> float:
        return self.k / self.n

    def encode(self, msg: int) -> int:
        """Encode a k-bit message into an n-bit codeword."""
        c = 0
        for j, row in enumerate(self.generator):
            if bit(msg, j, self.k):
                c ^= row
        return c

    def extract(self, codeword: int) -> int:
        """Pull the k message bits back out of a codeword."""
        msg = 0
        for p in self.info_positions:
            msg = (msg << 1) | bit(codeword, p, self.n)
        return msg

    def contains(self, c: int) -> bool:
        """Membership oracle: is `c` (an n-bit int) a valid codeword?"""
        if self.codebook is not None:
            return c in self.codebook
        if self.syndrome is not None:
            return self.syndrome(c)
        raise NotImplementedError(f"{self.name}: no membership oracle available")

    def min_distance(self, limit: Optional[int] = None) -> int:
        """Brute-force minimum distance over all 2^k codewords (k must be small)."""
        if self.k > 16:
            raise ValueError("min_distance only supported for k <= 16")
        best = self.n + 1
        for m in range(1 << self.k):
            w = self.encode(m).bit_count()
            if w and w < best:
                best = w
        return best

    def describe(self) -> str:
        d = f"d={self.d}" if self.d else "d=?"
        return f"{self.name:14s} {self.family:12s} n={self.n:3d} k={self.k:3d} R={self.rate:.3f} {d}"


def linear_from_generator(
    rows: list[int],
    width: int,
    name: str,
    family: str,
    d: Optional[int] = None,
    params: Optional[dict] = None,
) -> LinearCode:
    """Build a code from raw generator rows via GF(2) RREF (canonical form)."""
    basis, pivots = gf2_rref(rows, width)
    k = len(basis)
    return LinearCode(
        name=name,
        family=family,
        n=width,
        k=k,
        generator=tuple(basis),
        info_positions=tuple(pivots),
        d=d,
        params=params or {},
    )


def linear_from_encoder(
    encode_fn: Callable[[int], int],
    width: int,
    k: int,
    name: str,
    family: str,
    d: Optional[int] = None,
    params: Optional[dict] = None,
) -> LinearCode:
    """Build a code from a linear encode function (used for structured families).

    `encode_fn(msg)` must be GF(2)-linear in msg.  Basis rows are the encodings of
    the k unit vectors, then canonicalized via RREF.
    """
    rows = [encode_fn(1 << (k - 1 - j)) for j in range(k)]
    return linear_from_generator(rows, width, name, family, d, params)


def with_codebook(code: LinearCode, max_k: int = ENUMERABLE_MAX_K) -> LinearCode:
    """Fill in `codebook` when the code is small enough to enumerate."""
    if code.k <= max_k and code.codebook is None:
        code.codebook = frozenset(code.encode(m) for m in range(1 << code.k))
    return code
