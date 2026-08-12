"""Code family constructors and the default LUC code registry.

Families: repetition, Hamming, BCH, Reed-Solomon, Polar, LDPC, Turbo-lite.
Every family is built as a plain linear block code with an exact membership oracle,
so the same GRAND universal decoder handles them all.
"""

from __future__ import annotations

import random
from typing import Optional

from luc_sim.bits import bit, gf2_poly_mod, gf2_poly_mul, nullspace_basis, weight
from luc_sim.gf import GF
from luc_sim.linear import LinearCode, linear_from_encoder, linear_from_generator, with_codebook

ALPHA = 2  # primitive element of every GF(2^m) we use

# primitive polynomials (leading x^m bit implicit) for the fields we build codes over
_PRIMITIVES = {3: 0b1011, 4: 0b10011, 5: 0b100101}  # x^3+x+1, x^4+x+1, x^5+x^2+1


def _field(m: int) -> GF:
    try:
        return GF(m, _PRIMITIVES[m])
    except KeyError:
        raise ValueError(f"no primitive polynomial table for GF(2^{m})")


# --------------------------------------------------------------------------- repetition
def repetition(n: int) -> LinearCode:
    """Rate-1/n repetition code: family demo + robust fallback (e.g. header signaling)."""
    code = LinearCode(
        name=f"rep{n}",
        family="repetition",
        n=n,
        k=1,
        generator=((1 << n) - 1,),
        info_positions=(0,),
        d=n,
        params={"class": "single-parity-limit"},
    )
    return with_codebook(code)


# --------------------------------------------------------------------------- BCH / Hamming
def _gf2_poly_from_roots(field: GF, roots: list[int]) -> int:
    """Product of (x - root) over GF(2^m), returned as a binary int polynomial."""
    poly: list[int] = [1]
    for root in roots:
        poly = field.poly_mul(poly, [1, root])  # (x + root) == (x - root) in char 2
    assert all((c & 1) == c for c in poly), "minimal polynomial has non-binary coefficients"
    out = 0
    for c in poly:
        out = (out << 1) | (c & 1)  # minimal polynomials have 0/1 coefficients
    return out


def bch(m: int, design_d: int, name: Optional[str] = None) -> LinearCode:
    """Narrow-sense binary BCH code of length n=2^m-1 with design distance `design_d`.

    Generator = lcm of minimal polynomials of alpha^1..alpha^(design_d-1).
    Minimum distance is brute-force verified at construction (codes here are small).
    """
    field = _field(m)
    n = field.order
    # collect distinct minimal polynomials of alpha^1 .. alpha^(design_d-1)
    seen_roots: set[int] = set()
    factors: list[int] = []
    for root_exp in range(1, design_d):
        if root_exp in seen_roots:
            continue
        conj = root_exp
        cycle: list[int] = []
        while conj not in cycle:
            cycle.append(conj)
            seen_roots.add(conj)
            conj = (conj * 2) % n
        roots = [field.pow(ALPHA, e) for e in cycle]
        factors.append(_gf2_poly_from_roots(field, roots))
    g = 1
    for f in factors:
        g = gf2_poly_mul(g, f)
    n_k = g.bit_length() - 1
    k = n - n_k

    def encode(msg: int) -> int:
        rem = gf2_poly_mod(msg << n_k, g)
        return (msg << n_k) | rem

    code = linear_from_encoder(
        encode, n, k, name or f"bch({n},{k})", "bch", d=design_d,
        params={"m": m, "generator_poly": f"0b{g:b}"},
    )
    assert code.min_distance() >= design_d, f"{code.name}: min distance too low"
    return with_codebook(code)


def hamming(m: int) -> LinearCode:
    """Hamming(2^m-1, 2^m-m-1): the binary BCH code with design distance 3."""
    code = bch(m, 3, name=f"hamming({2 ** m - 1},{2 ** m - m - 1})")
    code.family = "hamming"
    return code


# --------------------------------------------------------------------------- Reed-Solomon
def _rs_symbols_from_bits(bits: int, n_syms: int, m: int) -> list[int]:
    return [(bits >> (m * (n_syms - 1 - i))) & ((1 << m) - 1) for i in range(n_syms)]


def _bits_from_rs_symbols(syms: list[int], m: int) -> int:
    out = 0
    for s in syms:
        out = (out << m) | (s & ((1 << m) - 1))
    return out


def reed_solomon(m: int, k_syms: int, name: Optional[str] = None) -> LinearCode:
    """Systematic Reed-Solomon over GF(2^m): n=2^m-1 symbols, t=(n-k)/2 errors.

    A codeword is `n` symbols (`m` bits each).  Messages are k_syms symbols.
    Membership is checked via syndrome evaluation at the generator's roots, so even
    large RS codes (e.g. RS(15,11)) are decodable by GRAND without enumeration.
    """
    field = _field(m)
    n_syms = field.order
    t = (n_syms - k_syms) // 2
    assert t >= 1 and n_syms - k_syms == 2 * t
    n_bits = n_syms * m
    k_bits = k_syms * m
    b = 1  # narrow-sense offset

    # generator polynomial g(x) = prod_{j=0}^{2t-1} (x - alpha^{b+j})
    g = [1]
    for j in range(2 * t):
        g = field.poly_mul(g, [1, field.pow(ALPHA, b + j)])

    def encode(msg: int) -> int:
        msg_syms = _rs_symbols_from_bits(msg, k_syms, m)
        shifted = msg_syms + [0] * (2 * t)  # m(x) * x^{n-k} (high degrees first)
        rem = field.poly_mod(shifted, g)
        rem = [0] * (2 * t - len(rem)) + rem
        return _bits_from_rs_symbols(msg_syms + rem, m)

    def syndrome(c: int) -> bool:
        syms = _rs_symbols_from_bits(c, n_syms, m)
        for j in range(2 * t):
            root = field.pow(ALPHA, b + j)
            acc = 0
            for s in syms:  # Horner: evaluate codeword poly at root
                acc = field.mul(acc, root) ^ s
            if acc != 0:
                return False
        return True

    code = linear_from_encoder(
        encode, n_bits, k_bits,
        name or f"rs({n_syms},{k_syms})", "reed-solomon",
        d=n_syms - k_syms + 1,
        params={"m": m, "symbols": n_syms, "t": t},
    )
    code.syndrome = syndrome
    if k_bits > 16:
        # syndrome-membership RS (e.g. RS(15,11)): fully decodable by GRAND but
        # slow to profile; keep it in the registry, out of the default policy
        code.params["policy"] = False
    # verify the encoder really produces codewords the oracle accepts
    for probe in (0, 1, (1 << k_bits) - 1, 1 << (k_bits - 1)):
        assert syndrome(encode(probe)), f"{code.name}: encoder/oracle mismatch"
    return code


# --------------------------------------------------------------------------- Polar
def _polar_reliability(i: int, m: int, beta: float) -> float:
    """5G-style beta-expansion sub-channel reliability (beta = 2^(1/4))."""
    acc = 0.0
    for j in range(m):
        acc += ((i >> j) & 1) * (beta ** j)
    return acc


def polar(n: int, k: int, name: Optional[str] = None) -> LinearCode:
    """Arikan-style Polar code, natural (non bit-reversed) indexing.

    Generator G_{i,j} = 1 iff (i & j) == j.  The k most reliable sub-channels
    (beta-expansion ordering, as in 5G) carry information; the rest are frozen to 0.
    """
    m = n.bit_length() - 1
    assert (1 << m) == n and 0 < k <= n
    beta = 2.0 ** 0.25
    ranked = sorted(range(n), key=lambda i: _polar_reliability(i, m, beta), reverse=True)
    info = sorted(ranked[:k])

    def encode(msg: int) -> int:
        c = 0
        for j, i in enumerate(info):
            if bit(msg, j, k):
                row = 0
                for col in range(n):
                    if (i & col) == col:
                        row |= 1 << (n - 1 - col)
                c ^= row
        return c

    code = linear_from_encoder(
        encode, n, k, name or f"polar({n},{k})", "polar", d=None,
        params={"info_set": info, "frozen": [i for i in range(n) if i not in info]},
    )
    return with_codebook(code)


# --------------------------------------------------------------------------- LDPC
def ldpc(n: int, k: int, col_w: int = 3, seed: int = 7, attempts: int = 300,
         name: Optional[str] = None) -> LinearCode:
    """Small regular-column-weight LDPC with girth >= 6 and minimum distance >= 4.

    The parity-check matrix is built by rejection sampling (no two columns share
    more than one row, which rules out 4-cycles); the code is the null space of H.
    """
    rows = n - k
    if col_w > 1:
        max_pairs = (rows * (rows - 1)) // 2
        assert n * (col_w * (col_w - 1)) // 2 <= max_pairs, "impossible girth-6 design"
    rng = random.Random(seed)
    for _ in range(attempts):
        # Progressive Edge Growth: add edges one at a time, each time choosing a
        # row at maximum BFS depth from the column (this maximizes girth).
        cols: list[list[int]] = [[] for _ in range(n)]
        row_degree = [0] * rows
        for col in range(n):
            for _ in range(col_w):
                if col == 0:
                    chosen_row = rng.randrange(rows)
                else:
                    # BFS from `col` over the bipartite graph of edges added so far
                    depth: dict[int, int] = {col: 0}
                    frontier = [col]
                    visited = {col}
                    while frontier:
                        node = frontier.pop(0)
                        for nb in _ldpc_neighbors(node, n, cols, row_degree):
                            if nb not in visited:
                                visited.add(nb)
                                depth[nb] = depth[node] + 1
                                frontier.append(nb)
                    max_depth = max(depth.values())
                    deepest_rows = [r for r in range(rows) if depth.get(r) == max_depth]
                    candidates = [r for r in deepest_rows if r not in cols[col]]
                    if not candidates:
                        # relax: any row not already connected to this column
                        candidates = [r for r in range(rows) if r not in cols[col]]
                    if not candidates:
                        raise RuntimeError("PEG stuck")
                    candidates.sort(key=lambda r: (row_degree[r], r))  # keep row degrees balanced
                    chosen_row = candidates[0]
                cols[col].append(chosen_row)
                row_degree[chosen_row] += 1
        h_rows = [0] * rows
        for c, poss in enumerate(cols):
            for r in poss:
                h_rows[r] |= 1 << (n - 1 - c)
        basis = nullspace_basis(h_rows, n)
        if len(basis) != k:
            continue
        code = linear_from_generator(
            basis, n, name or f"ldpc({n},{k})", "ldpc", d=None,
            params={"column_weight": col_w},
        )
        if code.min_distance() < 4:
            continue
        return with_codebook(code)
    raise RuntimeError(f"could not construct ldpc({n},{k}) with girth 6 and d>=4")


def _ldpc_neighbors(node: int, n: int, cols: list[list[int]], row_degree: list[int]) -> list[int]:
    """Bipartite neighbors of `node` (0..n-1 are columns, n..n+rows-1 are rows)."""
    rows = len(row_degree)
    if node < n:
        return [n + r for r in cols[node]]
    r = node - n
    out = []
    for c, cc in enumerate(cols):
        if r in cc:
            out.append(c)
    return out


# --------------------------------------------------------------------------- Turbo-lite
def _rsc_parity_stream(bits: int, k: int) -> list[int]:
    """Parity stream of an RSC(7,5) convolutional encoder (2 flush bits appended).

    Feedback poly 1+D+D^2, feedforward poly 1+D^2, so parity = u XOR s0 with
    next state [u^s1^s0, s0].  Everything is GF(2)-linear in the input bits.
    """
    s0 = s1 = 0
    out: list[int] = []

    def step(u: int) -> None:
        nonlocal s0, s1
        fb = u ^ s1 ^ s0
        out.append(u ^ s0)
        s1, s0 = s0, fb

    for j in range(k):
        step(bit(bits, j, k))
    for _ in range(2):  # flush registers to zero (linear in the data)
        step(s0 ^ s1)
    return out


def turbo_lite(k: int = 8, seed: int = 7, name: Optional[str] = None) -> LinearCode:
    """Turbo-flavored linear code: systematic + two RSC parity streams (interleaved).

    n = k + 2*(k+2).  Encoding is GF(2)-linear, so the whole thing is a linear block
    code that GRAND decodes in one shot -- no iterative BCJR needed.
    """
    rng = random.Random(seed)
    interleaver = rng.sample(range(k), k)
    n = k + 2 * (k + 2)

    def encode(msg: int) -> int:
        msg2 = 0
        for j, pos in enumerate(interleaver):
            msg2 |= bit(msg, pos, k) << (k - 1 - j)
        out = msg
        for p in _rsc_parity_stream(msg, k):
            out = (out << 1) | p
        for p in _rsc_parity_stream(msg2, k):
            out = (out << 1) | p
        return out

    code = linear_from_encoder(
        encode, n, k, name or f"turbo-lite({k})", "turbo", d=None,
        params={"interleaver": interleaver, "constituent": "RSC(7,5)"},
    )
    return with_codebook(code)


# --------------------------------------------------------------------------- registry
def default_registry() -> list[LinearCode]:
    """The default LUC code registry: 13 codes across 7 families."""
    return [
        repetition(5),
        repetition(11),
        repetition(31),
        hamming(3),   # hamming(7,4)
        hamming(4),   # hamming(15,11)
        bch(4, 5),    # bch(15,7,5)
        bch(5, 7),    # bch(31,16,7)
        reed_solomon(3, 3),  # rs(7,3)  t=2
        reed_solomon(3, 5),  # rs(7,5)  t=1
        reed_solomon(4, 11),  # rs(15,11) t=2  (syndrome-based, k=44 bits)
        polar(32, 11),
        ldpc(28, 14),
        turbo_lite(8),
    ]


def build_registry() -> dict[str, LinearCode]:
    """Registry as a dict keyed by code name (insertion order preserved)."""
    return {c.name: c for c in default_registry()}


def registry_summary(codes: dict[str, LinearCode]) -> list[str]:
    fams: dict[str, int] = {}
    for c in codes.values():
        fams[c.family] = fams.get(c.family, 0) + 1
    return [
        f"{len(codes)} code instances across {len(fams)} families:",
        ", ".join(f"{f} x{cnt}" for f, cnt in sorted(fams.items())),
    ]
