"""The universal codec: encoder + GRAND decoder + adaptive code selection.

This is the LUC prototype's centerpiece.  It implements:

* an *encoder* that can draw on any code in its registry (many classes), choosing
  one per frame based on the receiver's estimated channel state and the current
  mission (throughput / latency / robustness);
* a *decoder* that is universal -- one GRAND algorithm handles every family, and
  it never needs to know which family was used before the header tells it;
* *in-band code signaling*: a 4-bit code ID in a repetition-protected preamble, so
  transmitter and receiver can switch codes on the fly with no out-of-band control
  channel;
* *field updates*: ``register()`` can add a new code at any time (the LUC
  "updatability to facilitate new codes without implementation redesign" story).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from luc_sim.channel import estimate_ebn0_db
from luc_sim.codes import default_registry
from luc_sim.grand import decode_frame_llrs
from luc_sim.linear import LinearCode
from luc_sim.profiles import predict_bler


@dataclass
class SwitchRecord:
    t: int
    old: Optional[str]
    new: str
    est_snr_db: float
    reason: str


@dataclass
class FrameResult:
    ok: bool
    outage: bool  # header lost -> frame unaddressable (sync failure)
    msg: Optional[int]
    code_name: str
    family: str
    queries: int
    est_snr_db: float


# Fixed frame size in bits: a frame carries a repetition-protected code-ID header
# plus as many codewords of the selected code as fit.  This amortizes signaling
# overhead the way a real system would (per-frame, not per-codeword).
FRAME_BITS = 256

# Every frame whose info payload fits carries a CRC-16 over its data, so the
# receiver can detect GRAND misdecodes (valid codeword, wrong message) exactly as
# a real link would.  Very small payloads (e.g. rep11: 12 info bits/frame) skip the
# CRC; for those, any valid codeword is accepted (documented limitation).
FRAME_CRC_BITS = 16

_CRC16_POLY = 0x1021  # CRC-16-CCITT


def crc16(data: int, n_bits: int) -> int:
    """CRC-16-CCITT (poly 0x1021, init 0xFFFF, MSB-first) of the low n_bits."""
    crc = 0xFFFF
    for i in range(n_bits - 1, -1, -1):
        crc ^= ((data >> i) & 1) << 15  # data bit enters at the MSB
        top = crc & 0x8000
        crc = (crc << 1) & 0xFFFF
        if top:
            crc ^= _CRC16_POLY
    return crc


@dataclass
class UniversalCodec:
    """One object plays both ends of the link: it selects, encodes, and decodes.

    A single codec instance is shared by 'transmitter' and 'receiver' in the
    simulator; real hardware would run the same policy logic on both sides.
    """

    codes: Optional[Sequence[LinearCode]] = None
    target_bler: float = 0.05
    max_queries: int = 4096
    mission: str = "throughput"  # throughput | latency | robust
    profile_frames: int = 500
    cache: bool = True
    header_code: Optional[LinearCode] = field(default=None)  # repetition(31) by default
    hysteresis: float = 0.15  # score margin to justify abandoning the current code
    switch_deadband_db: float = 1.0  # SNR movement required before switching away

    def __post_init__(self) -> None:
        from luc_sim.codes import repetition

        self.registry: dict[str, LinearCode] = {}
        self.by_id: list[str] = []
        self.current: Optional[str] = None
        self.last_est_snr_db = 6.0
        self._adopted_est = 6.0
        self.switches: list[SwitchRecord] = []
        self._policy_cache: dict[tuple[float, str], list[tuple[float, str, float]]] = {}
        self._fallback_cache: dict[tuple[float, str], str] = {}
        if self.header_code is None:
            self.header_code = repetition(31)
        for c in (self.codes if self.codes is not None else default_registry()):
            self.register(c)

    # ------------------------------------------------------------------ registry
    def register(self, code: LinearCode) -> None:
        """Add (or replace) a code -- the LUC field-update path.

        The in-band code-ID header is 4 bits, so at most 16 codes can be addressed;
        adding beyond that raises.  Registering under an existing name replaces the
        code in that slot (the codebook update story).
        """
        if code.name not in self.registry:
            if len(self.by_id) >= 16:
                raise ValueError(
                    "code-ID header supports at most 16 registered codes; "
                    "replace an existing slot (register under an existing name)"
                )
            self.by_id.append(code.name)
        self.registry[code.name] = code
        self._policy_cache.clear()
        self._fallback_cache.clear()

    @property
    def header_len(self) -> int:
        return 4 * self.header_code.n

    @property
    def payload_bits(self) -> int:
        """Payload bits per frame given the fixed frame size."""
        return FRAME_BITS - self.header_len

    def pack_count(self, code: LinearCode) -> int:
        """How many `code` codewords fit in one frame's payload."""
        return max(1, self.payload_bits // code.n)

    def info_bits_for(self, code: LinearCode) -> int:
        """Info bits a frame can carry under `code` (including the CRC trailer)."""
        return code.k * self.pack_count(code)

    def user_bits_for(self, code: LinearCode) -> int:
        """User payload bits per frame: code capacity minus the CRC when it fits."""
        n_info = self.info_bits_for(code)
        if n_info >= FRAME_CRC_BITS + 1:
            return n_info - FRAME_CRC_BITS
        return n_info

    def _uses_crc(self, code: LinearCode) -> bool:
        return self.info_bits_for(code) >= FRAME_CRC_BITS + 1

    @property
    def family_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for c in self.registry.values():
            counts[c.family] = counts.get(c.family, 0) + 1
        return counts

    # ------------------------------------------------------------------ signaling
    def encode_frame(self, msg: int, code_name: str) -> tuple[int, int]:
        """Encode a user message under `code_name` with an in-band protected header.

        The payload carries as many codewords as fit in ``FRAME_BITS - header_len``
        bits; the user message gets a CRC-16 trailer when the payload can hold it.
        Returns (frame int, frame length in bits).
        """
        code = self.registry[code_name]
        k_cw = self.pack_count(code)
        n_info = code.k * k_cw
        if self._uses_crc(code):
            frame_msg = (msg << FRAME_CRC_BITS) | crc16(msg, self.user_bits_for(code))
        else:
            frame_msg = msg
        id_ = self.by_id.index(code_name)
        header = 0
        for j in range(4):
            v = (id_ >> (3 - j)) & 1
            header = (header << self.header_code.n) | self.header_code.encode(v)
        body = 0
        for j in range(k_cw):
            m = (frame_msg >> (code.k * (k_cw - 1 - j))) & ((1 << code.k) - 1)
            body = (body << code.n) | code.encode(m)
        # Layout (MSB-first): header | body | zero padding, padded to FRAME_BITS.
        body_bits = code.n * k_cw
        frame = (header << (FRAME_BITS - self.header_len)) | (
            body << (FRAME_BITS - self.header_len - body_bits)
        )
        return frame, FRAME_BITS

    def decode_frame(
        self, samples: Sequence[float], llrs: Sequence[float], n_payload_expected: int
    ) -> FrameResult:
        """Decode a received frame: header first, then universal GRAND decoding.

        `n_payload_expected` is the payload length the receiver sees from its own
        framing; if the header points at a code that does not tile the payload, the
        frame is treated as a sync failure (outage).
        """
        header = 0
        for j in range(4):
            seg = llrs[j * self.header_code.n : (j + 1) * self.header_code.n]
            header = (header << 1) | (1 if sum(seg) > 0 else 0)
        if header >= len(self.by_id):
            return FrameResult(
                ok=False, outage=True, msg=None,
                code_name="(sync)", family="(outage)",
                queries=0, est_snr_db=self.last_est_snr_db,
            )
        code = self.registry[self.by_id[header]]
        if n_payload_expected < code.n:
            return FrameResult(
                ok=False, outage=True, msg=None,
                code_name="(sync)", family="(outage)",
                queries=0, est_snr_db=self.last_est_snr_db,
            )
        k_cw = n_payload_expected // code.n  # trailing padding bits are ignored
        # channel estimate from the whole frame (many samples -> stable estimate,
        # robust even for tiny payload codes like rep11)
        est = estimate_ebn0_db(samples, code.rate)
        queries = 0
        frame_msg = 0
        ok_all = True
        for j in range(k_cw):
            seg = llrs[self.header_len + j * code.n : self.header_len + (j + 1) * code.n]
            m, q = decode_frame_llrs(seg, code, self.max_queries)
            queries += q
            if m is None:
                ok_all = False
                break
            frame_msg = (frame_msg << code.k) | m
        if ok_all and self._uses_crc(code):
            user_bits = self.user_bits_for(code)
            payload = frame_msg >> FRAME_CRC_BITS
            if crc16(payload, user_bits) != (frame_msg & ((1 << FRAME_CRC_BITS) - 1)):
                ok_all = False  # misdecode: valid codewords, wrong message (CRC catches it)
        return FrameResult(
            ok=ok_all, outage=False, msg=None,
            code_name=code.name, family=code.family, queries=queries, est_snr_db=est,
        )

    # ------------------------------------------------------------------ selection
    def _score_codes(self, est_snr_db: float) -> list[tuple[float, str, float]]:
        """Rank codes by mission score at this SNR: (score, name, predicted BLER)."""
        key = (round(est_snr_db * 2) / 2.0, self.mission)
        cached = self._policy_cache.get(key)
        if cached is not None:
            return cached
        scored: list[tuple[float, str, float]] = []
        for name, code in self.registry.items():
            if code.params.get("policy") is False:
                continue  # registry-only codes (e.g. large syndrome-based RS)
            bler_cw, avg_q = predict_bler(
                code, est_snr_db,
                n_frames=self.profile_frames, max_queries=self.max_queries,
                cache=self.cache,
            )
            # frames pack several codewords; a frame fails if *any* codeword fails
            k_cw = self.pack_count(code)
            bler_frame = 1.0 - (1.0 - bler_cw) ** k_cw
            if bler_frame > self.target_bler:
                continue
            if self.mission == "latency":
                score = (code.k * k_cw / FRAME_BITS) * (1.0 - bler_frame) / max(avg_q * k_cw, 1.0)
            elif self.mission == "robust":
                score = 1.0 - bler_frame
            else:
                score = (code.k * k_cw / FRAME_BITS) * (1.0 - bler_frame)
            scored.append((score, name, bler_frame))
        scored.sort(reverse=True)
        self._policy_cache[key] = scored
        return scored

    def _min_bler_code(self, est_snr_db: float) -> str:
        """Code with the lowest predicted *frame* BLER at this SNR.

        Used when nothing meets the target: GRAND's query budget makes nominally-
        robust low-rate codes impractical, so the fallback is chosen from the
        measured profiles rather than by nominal robustness.
        """
        key = (round(est_snr_db * 2) / 2.0, self.mission)
        if key in self._fallback_cache:
            return self._fallback_cache[key]
        best_name: Optional[str] = None
        best_bler = 1.0
        for name, code in self.registry.items():
            if code.params.get("policy") is False:
                continue
            bler_cw, _ = predict_bler(
                code, est_snr_db,
                n_frames=self.profile_frames, max_queries=self.max_queries,
                cache=self.cache,
            )
            bler_frame = 1.0 - (1.0 - bler_cw) ** self.pack_count(code)
            if bler_frame < best_bler:
                best_bler, best_name = bler_frame, name
        best_name = best_name or min(self.registry, key=lambda nm: self.registry[nm].rate)
        self._fallback_cache[key] = best_name
        return best_name

    def select_code(self, est_snr_db: float) -> LinearCode:
        """Pick the code maximizing mission goodput subject to the BLER target.

        Hysteresis has two parts: the current code is kept unless it misses the BLER
        target, another code is > (1+hysteresis) better, *or* the SNR estimate has
        moved more than `switch_deadband_db` away from where the code was adopted.
        This prevents thrashing at decision boundaries.
        """
        scored = self._score_codes(est_snr_db)
        if not scored:
            # nothing meets the target: fall back to the least-bad code, but stay put
            # within the deadband so we don't hunt among equally-bad codes
            if self.current is not None and abs(est_snr_db - self._adopted_est) < self.switch_deadband_db:
                return self.registry[self.current]
            return self.registry[self._min_bler_code(est_snr_db)]
        best_score, best_name, _ = scored[0]
        cur = self.current
        if cur is not None and cur in self.registry:
            cur_score = next((s for s, n, _ in scored if n == cur), None)
            if cur_score is not None and best_name != cur:
                if abs(est_snr_db - self._adopted_est) < self.switch_deadband_db:
                    return self.registry[cur]  # within deadband: stay put
                if cur_score >= best_score * (1.0 - self.hysteresis):
                    return self.registry[cur]  # current code is still competitive
            if best_name == cur:
                return self.registry[cur]
        return self.registry[best_name]

    def announce_switch(self, t: int, new_name: str, est_snr_db: float, reason: str) -> None:
        """Record a code-class change (used by the link runner)."""
        if new_name != self.current:
            self.switches.append(SwitchRecord(t, self.current, new_name, est_snr_db, reason))
            self.current = new_name
            self._adopted_est = est_snr_db
