"""Tests for the channel model."""

import math
import random

from luc_sim.channel import (
    DynamicChannel,
    awgn_sigma2,
    estimate_ebn0_db,
    qfunc,
    transmit_bpsk_awgn,
)


def test_awgn_sigma2_math():
    # rate-1 BPSK at Eb/N0 = 3 dB: Es/N0 = 3 dB -> sigma^2 = 1/(2*10^0.3)
    expected = 1.0 / (2.0 * 10 ** 0.3)
    assert abs(awgn_sigma2(3.0, 1.0) - expected) < 1e-12


def test_rate_scaling():
    # rate 1/2 code halves the per-symbol energy -> sigma^2 doubles vs rate 1
    assert awgn_sigma2(3.0, 0.5) > awgn_sigma2(3.0, 1.0)


def test_uncoded_ber_matches_qfunc():
    rng = random.Random(1)
    n_bits = 20000
    bits = rng.getrandbits(n_bits)
    samples, _, _ = transmit_bpsk_awgn(bits, n_bits, 1.0, 3.0, rng)
    hard = 0
    for s in samples:
        hard = (hard << 1) | (1 if s > 0 else 0)
    errors = (hard ^ bits).bit_count()
    expected = qfunc(math.sqrt(2.0 * 10 ** 0.3))
    assert abs(errors / n_bits - expected) < 0.02  # loose tolerance, 20k samples


def test_snr_estimate_accuracy():
    rng = random.Random(2)
    for true_db in (2.0, 5.0, 9.0):
        bits = rng.getrandbits(8000)
        samples, _, _ = transmit_bpsk_awgn(bits, 8000, 0.5, true_db, rng)
        est = estimate_ebn0_db(samples, 0.5)
        assert abs(est - true_db) < 0.5, f"{true_db} dB -> {est:.2f} dB"


def test_dynamic_channel_schedule():
    ch = DynamicChannel([(0, 10.0), (50, 4.0), (100, 8.0)])
    assert ch.snr_at(0) == 10.0
    assert ch.snr_at(49) == 10.0
    assert ch.snr_at(50) == 4.0
    assert ch.snr_at(99) == 4.0
    assert ch.snr_at(100) == 8.0
    assert ch.snr_at(1000) == 8.0
    assert ch.steps_after(-1) == [(0, 10.0), (50, 4.0), (100, 8.0)]
    assert ch.steps_after(49) == [(50, 4.0), (100, 8.0)]
    mean = sum(ch.snr_at(t) for t in range(150)) / 150
    assert abs(mean - ch.mean_snr_db(150)) < 1e-9


def test_dynamic_channel_bursts():
    rng = random.Random(3)
    ch = DynamicChannel([(0, 9.0)], burst_prob=0.5, burst_penalty_db=6.0)
    got_burst = False
    got_clean = False
    for _ in range(100):
        samples, _, _, snr = ch.transmit(0b101, 3, 1.0, 0, rng)
        got_burst |= snr < 5.0
        got_clean |= snr > 8.0
    assert got_burst and got_clean
