"""Tests for GF(2^m) arithmetic."""

import pytest

from luc_sim.gf import GF


def test_gf16_tables():
    f = GF(4, 0b10011)  # x^4 + x + 1
    assert f.size == 16 and f.order == 15
    # alpha^4 = alpha + 1 = 3
    assert f.pow(2, 4) == 3
    # multiplicativeness of the log map
    assert f.mul(7, 9) == f.pow(2, (f._log[7] + f._log[9]) % 15)
    # inverses
    for a in range(1, 16):
        assert f.mul(a, f.inv(a)) == 1


def test_gf8_tables():
    f = GF(3, 0b1011)  # x^3 + x + 1
    assert f.mul(3, 5) == f.pow(2, (f._log[3] + f._log[5]) % 7)
    assert f.div(5, 3) == f.mul(5, f.inv(3))


def test_gf_rejects_nonprimitive():
    with pytest.raises(ValueError):
        GF(4, 0b10001)  # x^4 + 1 is not primitive


def test_poly_mul_mod():
    f = GF(4, 0b10011)
    # (x + a) * (x + a^2) over GF(16)
    p = f.poly_mul([1, 2], [1, 4])
    assert p == [1, 2 ^ 4, f.mul(2, 4)]
    # (x^4) mod (x^4 + x + 1) = x + 1  ->  remainder [1, 1]
    rem = f.poly_mod([1, 0, 0, 0, 0], [1, 0, 0, 1, 1])
    assert rem == [1, 1]
