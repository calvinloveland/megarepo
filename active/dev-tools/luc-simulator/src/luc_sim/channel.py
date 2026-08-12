"""BPSK/AWGN channel model with dynamic SNR schedules and burst noise.

SNR is expressed in Eb/N0 (per info bit) dB -- the convention used by the LUC
program's Table 1 metrics.  For a code of rate R, Es = R*Eb, so the per-symbol
noise variance is sigma^2 = Es / (2 * 10^(EsN0_db/10)).

Transmit calls return both the raw received *samples* (used by the receiver to
estimate the channel state) and soft *LLRs* (used by the GRAND decoder).
"""

from __future__ import annotations

import math
import random
from typing import Sequence

from luc_sim.bits import bit


def awgn_sigma2(ebn0_db: float, rate: float) -> float:
    """Per-symbol noise variance for BPSK at Eb/N0 = ebn0_db (Eb = 1)."""
    esn0_lin = 10 ** ((ebn0_db + 10.0 * math.log10(rate)) / 10.0)
    return 1.0 / (2.0 * esn0_lin)


def transmit_bpsk_awgn(
    bits: int, n: int, rate: float, ebn0_db: float, rng: random.Random
) -> tuple[list[float], list[float], float]:
    """Transmit `bits` (n bits, MSB-first) over BPSK + AWGN.

    Returns ``(samples, llrs, true_sigma2)`` with LLR = 2*y/sigma^2 per sample.
    """
    sigma2 = awgn_sigma2(ebn0_db, rate)
    sigma = math.sqrt(sigma2)
    samples: list[float] = []
    llrs: list[float] = []
    for i in range(n):
        amp = 1.0 if bit(bits, i, n) else -1.0
        y = amp + rng.gauss(0.0, sigma)
        samples.append(y)
        llrs.append(2.0 * y / sigma2)
    return samples, llrs, sigma2


def estimate_ebn0_db(samples: Sequence[float], rate: float) -> float:
    """Eb/N0 (dB) estimate from raw received samples (E[y^2] = 1 + sigma^2).

    The result is clamped to a sane range: with a finite number of samples the
    second-moment estimate can dip below its expectation, which would otherwise
    produce absurd values.
    """
    mean_sq = sum(s * s for s in samples) / max(len(samples), 1)
    var = max(mean_sq - 1.0, 1e-4)
    est = 10.0 * math.log10(1.0 / (2.0 * var * rate))
    return min(max(est, -5.0), 25.0)


def qfunc(x: float) -> float:
    """Q(x) = P(N(0,1) > x)."""
    return 0.5 * math.erfc(x / math.sqrt(2.0))


class DynamicChannel:
    """AWGN channel whose Eb/N0 follows a step schedule, optionally with bursts.

    ``schedule`` is a list of ``(start_frame, ebn0_db)`` steps; between steps the
    SNR holds its last value.  Burst noise is modeled as a per-frame probability of
    a sudden SNR drop, which the LUC adaptive codec is supposed to ride through.
    """

    def __init__(
        self,
        schedule: Sequence[tuple[int, float]],
        burst_prob: float = 0.0,
        burst_penalty_db: float = 8.0,
    ) -> None:
        if not schedule:
            raise ValueError("schedule must be non-empty")
        self.schedule = list(schedule)
        self.burst_prob = burst_prob
        self.burst_penalty_db = burst_penalty_db

    def mean_snr_db(self, n_frames: int) -> float:
        """Time-average Eb/N0 over the first n_frames frames (no bursts)."""
        return sum(self.snr_at(t) for t in range(n_frames)) / n_frames

    def steps_after(self, t0: int) -> list[tuple[int, float]]:
        """Schedule steps that occur strictly after frame t0."""
        return [(t, s) for t, s in self.schedule if t > t0]

    def snr_at(self, t: int) -> float:
        """Base Eb/N0 (dB) at frame index t."""
        snr = self.schedule[0][1]
        for start, value in self.schedule:
            if t >= start:
                snr = value
            else:
                break
        return snr

    def transmit(
        self, bits: int, n: int, rate: float, t: int, rng: random.Random
    ) -> tuple[list[float], list[float], float, float]:
        """Transmit at frame index t; returns (samples, llrs, sigma^2, Eb/N0 dB)."""
        snr = self.snr_at(t)
        if self.burst_prob and rng.random() < self.burst_prob:
            snr -= self.burst_penalty_db
        samples, llrs, sigma2 = transmit_bpsk_awgn(bits, n, rate, snr, rng)
        return samples, llrs, sigma2, snr
