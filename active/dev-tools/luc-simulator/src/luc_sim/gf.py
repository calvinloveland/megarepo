"""GF(2^m) arithmetic used by the BCH and Reed-Solomon code constructors.

Elements are ints 0..2^m-1; addition is XOR.  Multiplication/division use log/exp
tables built from a primitive polynomial `prim` (the leading bit is implicit).

Polynomials are lists of coefficients with index 0 = highest-degree coefficient.
"""

from __future__ import annotations


class GF:
    """Binary extension field GF(2^m)."""

    def __init__(self, m: int, prim: int) -> None:
        if not (prim & (1 << m)):
            raise ValueError("primitive polynomial must have its x^m bit set")
        self.m = m
        self.size = 1 << m
        self.order = (1 << m) - 1
        self.prim = prim
        self._log = [-1] * self.size
        self._exp = [0] * (self.order + 2)
        x = 1
        for i in range(self.order):
            self._exp[i] = x
            self._log[x] = i
            x <<= 1
            if x & self.size:
                x ^= prim
        self._exp[self.order] = self._exp[0]  # alpha^order = 1
        self._exp[self.order + 1] = self._exp[1]
        # verify primitivity: every nonzero element must appear in the exp table
        if any(self._log[v] < 0 for v in range(1, self.size)):
            raise ValueError(f"polynomial 0x{prim:x} is not primitive for GF(2^{m})")

    def mul(self, a: int, b: int) -> int:
        if a == 0 or b == 0:
            return 0
        return self._exp[(self._log[a] + self._log[b]) % self.order]

    def div(self, a: int, b: int) -> int:
        if b == 0:
            raise ZeroDivisionError("division by zero in GF")
        if a == 0:
            return 0
        return self._exp[(self._log[a] - self._log[b]) % self.order]

    def inv(self, a: int) -> int:
        if a == 0:
            raise ZeroDivisionError("inverse of zero in GF")
        return self._exp[(self.order - self._log[a]) % self.order]

    def pow(self, a: int, e: int) -> int:
        if a == 0:
            return 0
        return self._exp[(self._log[a] * e) % self.order]

    # ------------------------------------------------------------------ polys
    def poly_mul(self, p: list[int], q: list[int]) -> list[int]:
        """Multiply two polynomials (coefficient lists, index 0 = highest degree)."""
        res = [0] * (len(p) + len(q) - 1)
        for i, a in enumerate(p):
            if a == 0:
                continue
            for j, b in enumerate(q):
                if b:
                    res[i + j] ^= self.mul(a, b)
        return res

    def poly_mod(self, p: list[int], g: list[int]) -> list[int]:
        """p mod g over GF(2^m); g must be monic (leading coefficient 1)."""
        r = [c for c in p]
        dg = len(g) - 1
        while len(r) >= len(g) and len(r) > 0:
            lead = r[0]
            if lead == 0:
                r = r[1:]
                continue
            for j in range(len(g)):
                r[j] ^= self.mul(lead, g[j])
            r = r[1:]
        while r and r[0] == 0:
            r = r[1:]
        return r or [0]
