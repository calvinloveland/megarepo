"""Tests for bit-level helpers."""

from luc_sim.bits import (
    bit,
    gf2_poly_mod,
    gf2_poly_mul,
    gf2_rank,
    gf2_rref,
    nullspace_basis,
    parity,
    set_bit,
    weight,
)


def test_bit_access():
    x = 0b10110
    assert [bit(x, i, 5) for i in range(5)] == [1, 0, 1, 1, 0]
    assert set_bit(x, 1, 5, 1) == 0b11110  # 10110 -> 11110 (bit 1 set)
    assert set_bit(x, 0, 5, 0) == 0b00110  # 10110 -> 00110 (bit 0 cleared)


def test_weight_parity():
    assert weight(0b10110) == 3
    assert parity(0b10110) == 1
    assert parity(0b10111) == 0


def test_rref_basic():
    # rows [1 1 0], [0 1 1] over GF(2) -> RREF eliminates col 1 from row 0
    rows = [0b110, 0b011]
    basis, pivots = gf2_rref(rows, 3)
    assert pivots == [0, 1]
    assert basis[0] == 0b101
    assert basis[1] == 0b011


def test_rref_rank():
    rows = [0b101, 0b011, 0b111]  # three independent vectors -> rank 3
    assert gf2_rank(rows, 3) == 3
    rows2 = [0b101, 0b101, 0b011, 0b110]  # 0b110 = 0b101 ^ 0b011 -> rank 2
    assert gf2_rank(rows2, 3) == 2


def test_nullspace():
    # H = [1 1 0 0; 0 1 1 0] -> nullspace vectors must satisfy H v = 0
    h = [0b1100, 0b0110]
    basis = nullspace_basis(h, 4)
    assert len(basis) == 2
    for v in basis:
        for row in h:
            assert (row & v).bit_count() % 2 == 0


def test_gf2_poly():
    # (x^3 + x + 1) * (x + 1) = x^4 + x^3 + x^2 + 1
    assert gf2_poly_mul(0b1011, 0b11) == 0b11101
    # x^4 mod (x^3 + x + 1): x^4 = x*(x^3) = x*(x+1) = x^2 + x -> 0b110
    assert gf2_poly_mod(0b10000, 0b1011) == 0b110
