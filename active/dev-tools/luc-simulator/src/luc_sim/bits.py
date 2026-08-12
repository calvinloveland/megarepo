"""Bit-level helpers shared across the package.

Convention: an n-bit codeword/message is a Python int with bit position 0 as the
*most-significant* bit (MSB-first).  ``bit(x, i, n)`` reads bit i of an n-bit value x.
"""

from __future__ import annotations


def bit(x: int, i: int, n: int) -> int:
    """Bit at position i (0 = MSB) of an n-bit value."""
    return (x >> (n - 1 - i)) & 1


def set_bit(x: int, i: int, n: int, v: int) -> int:
    """Return x with bit i (0 = MSB) set to v (0/1)."""
    shift = n - 1 - i
    return (x & ~(1 << shift)) | ((v & 1) << shift)


def parity(x: int) -> int:
    """Parity bit of x (1 if odd weight)."""
    return x.bit_count() & 1


def weight(x: int) -> int:
    """Hamming weight of x."""
    return x.bit_count()


def gf2_rref(rows: list[int], width: int) -> tuple[list[int], list[int]]:
    """Row-reduced echelon form of `rows` over GF(2).

    Returns ``(basis, pivot_columns)``: every basis row has a unique leading-1 pivot
    column and all other rows are zeroed there.  Pivot columns (MSB-first positions)
    double as the *info positions* of a linear code built from the basis.
    """
    mat = rows[:]
    pivots: list[int] = []
    pr = 0
    for col in range(width):
        sel = next((r for r in range(pr, len(mat)) if bit(mat[r], col, width)), None)
        if sel is None:
            continue
        mat[pr], mat[sel] = mat[sel], mat[pr]
        for r in range(len(mat)):
            if r != pr and bit(mat[r], col, width):
                mat[r] ^= mat[pr]
        pivots.append(col)
        pr += 1
        if pr == len(mat):
            break
    return mat[:pr], pivots


def gf2_rank(rows: list[int], width: int) -> int:
    """Rank of `rows` over GF(2)."""
    basis, _ = gf2_rref(rows, width)
    return len(basis)


def nullspace_basis(rows: list[int], width: int) -> list[int]:
    """Basis (as n-bit ints) of the GF(2) null space {x : rows @ x = 0}."""
    echelon, pivots = gf2_rref(rows, width)
    pivot_set = set(pivots)
    basis: list[int] = []
    for col in range(width):
        if col in pivot_set:
            continue
        v = 1 << (width - 1 - col)
        for row, p in zip(echelon, pivots):
            if bit(row, col, width):
                v |= 1 << (width - 1 - p)
        basis.append(v)
    return basis


def gf2_poly_mul(a: int, b: int) -> int:
    """Multiply two GF(2) polynomials (int bit patterns, LSB = x^0)."""
    result = 0
    while b:
        if b & 1:
            result ^= a
        a <<= 1
        b >>= 1
    return result


def gf2_poly_mod(dividend: int, divisor: int) -> int:
    """Return `dividend` mod `divisor` over GF(2). Requires divisor's leading bit set."""
    deg = divisor.bit_length() - 1
    r = dividend
    while r.bit_length() > deg:
        r ^= divisor << (r.bit_length() - 1 - deg)
    return r
