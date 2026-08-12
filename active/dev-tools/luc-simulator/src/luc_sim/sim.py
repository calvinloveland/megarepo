"""Monte-Carlo link simulation and BLER sweeps.

`run_link` streams a sequence of frames through the channel, running the full
codec loop (estimate -> select -> encode -> transmit -> decode) and returning a
per-frame record plus aggregates.  With `adaptive=False` the same machinery
measures the "state of the art" baseline: a fixed code chosen once for the
environment, no on-the-fly switching.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional, Sequence

from luc_sim.channel import DynamicChannel
from luc_sim.codec import FrameResult, SwitchRecord, UniversalCodec
from luc_sim.profiles import predict_bler

SMOOTHING = 0.3  # exponential smoothing weight for the receiver's SNR estimate


@dataclass
class FrameRecord:
    t: int
    true_snr_db: float
    est_snr_db: float
    code_name: str
    family: str
    queries: int
    ok: bool
    outage: bool
    info_bits: int
    tx_bits: int


@dataclass
class LinkReport:
    records: list[FrameRecord] = field(default_factory=list)
    switches: list[SwitchRecord] = field(default_factory=list)
    frame_ms: float = 1.0

    @property
    def n_frames(self) -> int:
        return len(self.records)

    def bler(self) -> float:
        if not self.records:
            return float("nan")
        bad = sum(1 for r in self.records if not r.ok)
        return bad / self.n_frames

    def outage_rate(self) -> float:
        if not self.records:
            return float("nan")
        return sum(1 for r in self.records if r.outage) / self.n_frames

    def goodput(self) -> float:
        """Info bits delivered per transmitted bit (header included)."""
        info_ok = sum(r.info_bits for r in self.records if r.ok)
        tx = sum(r.tx_bits for r in self.records)
        return info_ok / tx if tx else 0.0

    def throughput_bps(self, info_bits_per_frame: int = 0) -> float:
        """Info bits per second assuming a frame duration of frame_ms."""
        info_ok = sum(r.info_bits for r in self.records if r.ok)
        seconds = self.n_frames * self.frame_ms / 1000.0
        return info_ok / seconds if seconds else 0.0

    def avg_queries(self) -> float:
        if not self.records:
            return float("nan")
        return sum(r.queries for r in self.records) / self.n_frames

    def queries_per_info_bit(self) -> float:
        """GRAND work per delivered info bit (the decoder power proxy)."""
        info_ok = sum(r.info_bits for r in self.records if r.ok)
        if info_ok == 0:
            return float("inf")
        return sum(r.queries for r in self.records) / info_ok

    def code_usage(self) -> dict[str, int]:
        usage: dict[str, int] = {}
        for r in self.records:
            usage[r.code_name] = usage.get(r.code_name, 0) + 1
        return usage

    def family_usage(self) -> dict[str, int]:
        usage: dict[str, int] = {}
        for r in self.records:
            usage[r.family] = usage.get(r.family, 0) + 1
        return usage


def best_fixed_code(codec: UniversalCodec, mean_snr_db: float) -> str:
    """The code a (non-adaptive) state-of-the-art design would fix on for the
    environment: the highest-goodput code meeting the BLER target at the mean SNR.
    """
    codec.current = None
    return codec.select_code(mean_snr_db).name


def run_link(
    codec: UniversalCodec,
    channel: DynamicChannel,
    n_frames: int,
    seed: int = 1,
    adaptive: bool = True,
    fixed_code: Optional[str] = None,
    initial_snr_db: float = 6.0,
    frame_ms: float = 1.0,
) -> LinkReport:
    """Stream `n_frames` frames through `channel` using `codec`.

    adaptive=True  -> the codec re-selects its code every frame from its own
                      channel estimate (the LUC behavior).
    adaptive=False -> `fixed_code` (or the environment's best fixed code) is used
                      for every frame (the SoTA baseline).
    """
    rng = random.Random(seed)
    codec.last_est_snr_db = initial_snr_db
    codec.current = None
    codec.switches = []
    est = initial_snr_db
    report = LinkReport(frame_ms=frame_ms)
    fixed = fixed_code
    if not adaptive and fixed is None:
        fixed = best_fixed_code(codec, channel.mean_snr_db(n_frames))

    for t in range(n_frames):
        code = codec.select_code(est) if adaptive else codec.registry[fixed]
        if adaptive:
            codec.announce_switch(t, code.name, est, "policy")
        n_user = codec.user_bits_for(code)
        msg = rng.getrandbits(n_user)
        frame, total_len = codec.encode_frame(msg, code.name)
        samples, llrs, _, true_snr = channel.transmit(frame, total_len, code.rate, t, rng)
        res: FrameResult = codec.decode_frame(samples, llrs, codec.payload_bits)
        if not res.outage:
            est = SMOOTHING * res.est_snr_db + (1.0 - SMOOTHING) * est
        report.records.append(
            FrameRecord(
                t=t, true_snr_db=true_snr, est_snr_db=est,
                code_name=res.code_name, family=res.family,
                queries=res.queries, ok=res.ok, outage=res.outage,
                info_bits=n_user if res.ok else 0, tx_bits=total_len,
            )
        )
    report.switches = list(codec.switches)
    return report


def switch_latencies_ms(
    report: LinkReport, channel: DynamicChannel, frame_ms: float = 1.0
) -> list[float]:
    """Time (ms) from each channel step change until the codec switches codes.

    Includes detection (SNR estimation + smoothing) and decision (policy) latency.
    """
    latencies: list[float] = []
    for step_t, _ in channel.steps_after(-1):
        before = None
        for r in report.records:
            if r.t < step_t:
                before = r.code_name
            else:
                break
        if before is None:
            continue
        for r in report.records:
            if r.t >= step_t and r.code_name != before:
                latencies.append((r.t - step_t) * frame_ms)
                break
    return latencies


def bler_sweep(
    codec: UniversalCodec,
    code_name: str,
    snr_points: Sequence[float],
    n_frames: int = 800,
    max_queries: int = 4096,
    cache: bool = True,
) -> list[tuple[float, float, float]]:
    """(Eb/N0 dB, BLER, avg queries) for one code across an SNR grid."""
    code = codec.registry[code_name]
    out = []
    for snr in snr_points:
        bler, avg_q = predict_bler(code, snr, n_frames=n_frames, max_queries=max_queries, cache=cache)
        out.append((snr, bler, avg_q))
    return out


def snr_for_target_bler(
    codec: UniversalCodec,
    code_name: str,
    target: float,
    snr_grid: Sequence[float],
    n_frames: int = 800,
    max_queries: int = 4096,
    cache: bool = True,
) -> Optional[float]:
    """Minimum Eb/N0 (dB) at which `code_name` reaches `target` BLER (or None)."""
    for snr in sorted(snr_grid):
        bler, _ = predict_bler(
            codec.registry[code_name], snr,
            n_frames=n_frames, max_queries=max_queries, cache=cache,
        )
        if bler <= target:
            return snr
    return None
