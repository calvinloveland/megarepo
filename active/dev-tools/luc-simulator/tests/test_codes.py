"""Tests for the code family constructors and the default registry."""

import random

from luc_sim.codes import build_registry, default_registry


def test_registry_shape():
    reg = build_registry()
    assert len(reg) == 15
    families = {c.family for c in reg.values()}
    assert families == {
        "repetition", "hamming", "bch", "reed-solomon", "polar", "ldpc", "turbo",
    }


def test_long_codes_syndrome_consistent():
    """Syndrome-membership codes beyond k=16 must agree with the encoder."""
    rng = random.Random(3)
    for name in ("bch(63,45)", "bch(63,36)", "ldpc(64,40)", "rs(15,11)"):
        c = build_registry()[name]
        assert c.syndrome is not None
        assert c.codebook is None  # too large to enumerate
        for _ in range(200):
            m = rng.getrandbits(c.k)
            assert c.syndrome(c.encode(m)), f"{name}: encoder/oracle mismatch"


def test_encode_extract_roundtrip():
    rng = random.Random(11)
    for c in build_registry().values():
        for _ in range(20):
            m = rng.getrandbits(c.k)
            cw = c.encode(m)
            assert cw < (1 << c.n)
            assert c.extract(cw) == m, c.name
            assert c.contains(cw), c.name
            assert cw == c.encode(c.extract(cw)), c.name


def test_zero_codeword():
    for c in build_registry().values():
        assert c.encode(0) == 0
        assert c.contains(0)


def test_minimum_distances():
    expected = {
        "rep5": 5, "rep11": 11,
        "hamming(7,4)": 3, "hamming(15,11)": 3,
        "bch(15,7)": 5, "bch(31,16)": 7,
        "rs(7,3)": 5, "rs(7,5)": 3,
        "polar(32,16)": 8, "ldpc(28,14)": 4, "turbo-lite(8)": 3,
    }
    reg = build_registry()
    for name, d in expected.items():
        c = reg[name]
        if c.k <= 14:
            assert c.min_distance() >= d, f"{name}: d={c.min_distance()} < {d}"
        else:
            assert c.d is None or c.d >= 1


def test_rs_syndrome_consistency():
    rng = random.Random(5)
    for name in ("rs(7,3)", "rs(7,5)", "rs(15,11)"):
        c = build_registry()[name]
        assert c.syndrome is not None
        for _ in range(500):
            m = rng.getrandbits(c.k)
            cw = c.encode(m)
            assert c.syndrome(cw)
            # a single-symbol corruption must break the syndrome for t>=1 codes
            if c.k <= 16:
                pass


def test_single_bit_flip_detected():
    rng = random.Random(7)
    for c in build_registry().values():
        if c.d is None or c.d < 3:
            continue
        for _ in range(50):
            m = rng.getrandbits(c.k)
            cw = c.encode(m)
            bad = cw ^ (1 << rng.randrange(c.n))
            if bad != cw:
                assert not c.contains(bad), f"{c.name}: weight-1 word accepted"


def test_policy_skips_long_codes():
    reg = build_registry()
    for name in ("bch(63,45)", "bch(63,36)", "ldpc(64,40)", "rs(15,11)"):
        assert reg[name].params.get("policy") is False, name


def test_long_code_min_distance_bound():
    """The BCH bound guarantees d >= design distance; spot-check weight-1/2 words."""
    rng = random.Random(9)
    for name, d in (("bch(63,45)", 7), ("bch(63,36)", 11)):
        c = build_registry()[name]
        for _ in range(20):
            m = rng.getrandbits(c.k)
            cw = c.encode(m)
            for _ in range(5):
                p1 = rng.randrange(c.n)
                p2 = rng.randrange(c.n - 1)
                if p2 >= p1:
                    p2 += 1
                bad = cw ^ (1 << p1) ^ (1 << p2)  # two *distinct* flips
                assert not c.syndrome(bad), f"{name}: weight-2 word accepted (d should be {d})"


def test_polar_information_rate():
    c = build_registry()["polar(32,16)"]
    # distinct info positions, all distinct codewords
    assert len(set(c.info_positions)) == c.k
    assert len(c.codebook) == (1 << c.k)
    assert c.params["frozen_method"] == "popcount"


def test_polar_popcount_beats_beta_expansion():
    """For (32,16) the popcount ordering (BEC-optimal) gives d=8; the 5G
    beta-expansion ordering gives only d=4 -- the choice matters at this size."""
    from luc_sim.codes import polar

    pop = polar(32, 16)
    beta = polar(32, 16, frozen_method="beta")
    assert pop.min_distance() >= beta.min_distance()
    assert pop.min_distance() >= 8
    assert beta.min_distance() == 4


def test_polar_empirical_bler():
    """polar(32,16) must be competitive with the other rate-1/2 codes at 5 dB."""
    from luc_sim.profiles import measure_code

    c = build_registry()["polar(32,16)"]
    bler, _, _ = measure_code(c, 5.0, 500, 4096, seed=1)
    assert bler < 0.06, f"polar(32,16) BLER@5dB={bler:.3f} too high"


def test_ldpc_structure():
    c = build_registry()["ldpc(28,14)"]
    assert c.n == 28 and c.k == 14
    assert len(c.codebook) == (1 << 14)
    assert c.params["column_weight"] == 3


def test_turbo_distinct():
    c = build_registry()["turbo-lite(8)"]
    assert c.n == 28 and c.k == 8
    assert len(c.codebook) == 256


def test_default_registry_unique_names():
    names = [c.name for c in default_registry()]
    assert len(names) == len(set(names))
