# LUC (Lightweight Universal Codec) — Simulator & Prototype

A pure-Python simulator and working prototype of the **DARPA LUC** concept
(BAA HR001126S0014): a *universal, adaptive encoder–decoder* that can communicate
using **any known error-correcting code** — and any code developed in the future —
switching code classes **on the fly** while a link is operating, and supporting
field-updatable code books without implementation redesign.

This project demonstrates the whole idea end-to-end at a small, tractable scale
(a generated BLER-curve chart for all families lives at
`docs/images/bler_curves.svg`; regenerate with `luc-sim plot --all`).

## Why this matters (the program's problem)

Modern links hard-code one code (or a tiny set) per modulation. Changing codes
between *classes* (Polar ↔ Reed–Solomon ↔ LDPC …) normally means redesigning the
decoder. DARPA's prior **GRAND** study showed that a *single* algorithm can decode
every family: instead of inverting a code, GRAND guesses the noise — it enumerates
likely error patterns and keeps the first guess that lands on a valid codeword.
The only thing GRAND needs from a code is a **membership oracle**: *is this word a
codeword?* That is the LUC bet, and this repository is a working miniature of it.

## Architecture

```
              ┌────────────────────────────  transmitter  ────────────────────────────┐
  user bits   │  select code (policy: SNR est, mission, BLER target)                  │
 ───────────▶ │  ┌──────────────┐   ┌─────────────────┐    ┌────────────────────────┐ │
              │  │ code registry │──▶│ pack + encode   │───▶│ header ‖ codewords + CRC││──▶ channel
              │  │ 13 codes, 7    │   │ (any family)    │    │ (rep-protected code ID)││
              │  │ families       │   └─────────────────┘    └────────────────────────┘│
              └───────────────────────────────────────────────────────────────────────┘
                                                │  BPSK + AWGN, dynamic SNR, bursts
                                              ▼
              ┌────────────────────────────  receiver  ────────────────────────────┐
              │  ┌────────────────┐   ┌───────────────────┐   ┌───────────────────┐ │
              │  │ decode header  │──▶│ GRAND universal    │──▶│ CRC-16 check      │ │──▶ user bits
              │  │ (code ID)      │   │ decoder (any code) │   │ (catches misdecodes)│
              │  └────────────────┘   └───────────────────┘   └───────────────────┘ │
              │  estimate SNR from samples ──▶ feeds next frame's code selection     │
              └──────────────────────────────────────────────────────────────────────┘
```

### Code registry — 13 codes, 7 families, one decoder

| Code | Family | (n, k) | d | Notes |
|---|---|---|---|---|
| rep5 / rep11 / rep31 | repetition | (5,1) (11,1) (31,1) | 5/11/31 | fallback + header signaling |
| hamming(7,4), hamming(15,11) | Hamming | (7,4) (15,11) | 3 | built as BCH(d=3) |
| bch(15,7), bch(31,16) | BCH | (15,7) (31,16) | 5/7 | algebraic construction, distance verified |
| rs(7,3), rs(7,5), rs(15,11) | Reed–Solomon | (21,9) (21,15) (60,44) | 5/3/5 | GF(8)/GF(16); rs(15,11) uses a **syndrome oracle** (k=44, no enumeration) |
| polar(32,11) | Polar | (32,11) | 8 | Arikan-style, 5G beta-expansion reliability |
| ldpc(28,14) | LDPC | (28,14) | 4 | PEG construction, girth ≥ 6 |
| turbo-lite(8) | Turbo | (28,8) | 6 | two RSC(7,5) arms, interleaved; decoded by GRAND in one shot |

Every code exposes exactly one thing to the decoder: `contains(codeword)` — a
`frozenset` lookup for enumerable codes, a GF-syndrome evaluation for RS(15,11).
That is what makes the decoder **universal** and the registry **field-updatable**:
`codec.register(new_code)` mid-run, and GRAND decodes it with zero changes.

### The adaptive policy

Every frame the receiver estimates Eb/N0 from the received samples; the encoder
scores every code as *frame-level* goodput (its rate, its predicted BLER, and how
many codewords fit in a frame) subject to the BLER target, with **hysteresis** (SNR
deadband + score margin) so it doesn't thrash at decision boundaries. Mission modes
re-weight the score (throughput / latency / robust).

### What is measured (and what is a proxy)

- **BLER** — frame error rate including *misdecodes*: each frame carries a CRC-16,
  so a valid-but-wrong GRAND codeword is counted as an error, exactly like a real
  link.
- **Latency / power** — GRAND **query count** (codebook/syndrome membership checks)
  is used as the work proxy: GRAND's power is proportional to queries, and the
  referenced ORBGRAND silicon is sub-0.8 pJ/bit. Wall-clock numbers assume 1 ms
  frames (documented).
- **Signal gain** — Eb/N0 needed to reach the BLER target, adaptive vs fixed.
- **Switch time** — measured from each channel step until the codec changes codes
  (includes detection + decision latency).

## Running it

```bash
uv venv --python /run/current-system/sw/bin/python3 .venv
uv pip install --python .venv/bin/python -e . pytest

luc-sim codes                          # registry audit
luc-sim demo                           # adaptive link over a dynamic channel
luc-sim missions                       # compare throughput / latency / robust missions
luc-sim metrics                        # Table-1 style metrics report
luc-sim sweep --code ldpc(28,14) --snr 0,2,4,6,8,10,12
luc-sim plot --all --out bler.svg      # BLER curves (SVG, no dependencies)
luc-sim serve                          # LUC Link Explorer web UI at http://127.0.0.1:8080
```

Profiles are measured on first use and cached in `~/.cache/luc-sim/profiles.json`
(override `LUC_SIM_CACHE`); repeat runs are instant.

### LUC Link Explorer (web UI)

`luc-sim serve` runs a dependency-free browser UI (Python stdlib `http.server` +
vanilla JS/Canvas) at `http://127.0.0.1:8080`:

* the **adaptive link timeline** — true vs estimated SNR over frames, the code
  family used per frame (color-coded), switch markers, and error/sync-loss
  markers, with hover tooltips;
* **summary cards** — BLER, goodput, outage, switches, switch latency;
* the **BLER curves** for all code families (log-y) with the target line;
* controls to re-run with a different scenario / mission / frame count / seed,
  including the non-adaptive (SoTA) baseline.

API: `GET /api/codes`, `/api/sim?frames=&seed=&mission=&scenario=&adaptive=`,
`/api/curves?snr=&frames=`.

## Sample results (measured, seed 7, 600 frames, 1 ms frames)

Channel: `12 dB → 4 dB → 9 dB → 1.5 dB (deep fade) → 10 dB` with bursts.

| Metric | Adaptive (LUC) | Fixed code (SoTA) |
|---|---|---|
| **BLER** | **0.062** | 0.315 |
| Goodput (info bits/transmitted bit) | 0.188 | 0.198 |
| Eb/N0 for 5% BLER | **3.0 dB** | 5.0 dB → **2 dB gain** |
| Time to switch code classes | median **2 ms**, worst 4 ms | n/a (static) |
| Codes used | 7 across 4 families, 22 switches | 1 |

The adaptive codec keeps the link alive through the deep fade and burst noise where
the fixed code collapses (BLER 0.062 vs 0.315), at a small throughput cost — exactly
the LUC value proposition. Decoder work (queries/info-bit) is *higher* for adaptive:
the extra queries are what buy robustness during degraded periods (the fade and
bursts), and on sub-pJ/bit GRAND silicon that cost is affordable.

## Honest caveats

- **Short codes** — the registry uses n ≤ 60, k ≤ 44 so GRAND's exhaustive search
  stays tractable in pure Python. Absolute BLER numbers are therefore worse than
  industrial long-code systems; the *relative* adaptive-vs-fixed behavior is the
  point.
- **Query-budget limits** — GRAND's bounded search makes nominally-robust codes like
  rep31 impractical (it cannot reach the required error weight within budget); the
  policy therefore chooses from *measured* profiles, not nominal distance.
- **Perfect codes misdecode** — a 2-error word in a perfect code (Hamming) can be
  distance-1 from a different codeword; GRAND correctly ML-decodes to it, and the
  CRC-16 is what turns that into a detected error.
- **Power proxy** — queries are a *proxy* for energy/latency, not a cycle-accurate
  model.
- **Header overhead** — the repetition-protected 124-bit code-ID header is 48% of a
  256-bit frame; real systems amortize signaling differently (this is a design knob,
  not a fundamental cost).

## Mapping to the LUC program's Table-1 metrics

1. **Codes supported on a single algorithm** — 13 instances / 7 families, all
   decoded by one GRAND algorithm; registry supports arbitrary additions (the
   "100 mission codes" story).
2. **Channel latency** — measured as GRAND queries per frame / per info bit.
3. **Signal gain in dynamic noise** — measured as the adaptive-vs-fixed Eb/N0 needed
   for the BLER target (≈ 2 dB here).
4. **BLER at Eb/N0 = 5 dB** — reported per code (see `luc-sim metrics`).
5. **Receiver decoder power** — queries per info bit as a power proxy.
6. **Time to switch code classes** — measured switch latency after channel steps
   (median 2 ms at 1 ms/frame).

### Mission modes (task/mission optimization)

`luc-sim missions` runs the same dynamic channel under all three policy modes:

| mission | BLER | goodput | q/frame | dominant codes |
|---|---|---|---|---|
| throughput | 0.070 | 0.211 | 584 | hamming(15,11), rs(7,3) |
| latency | 0.070 | 0.212 | 626 | rs(7,5), rs(7,3) |
| robust | 0.073 | 0.132 | 743 | ldpc(28,14), rs(7,3) |

Robust mode trades ~40% goodput for the lowest error rate; latency mode favors
low-query codes; throughput maximizes delivered bits — the same codec hardware,
only the policy differs.

## Layout

```
src/luc_sim/        the package (bits, gf, linear, codes, grand, channel, codec,
                    profiles, sim, metrics, plot, cli)
tests/              pytest suite (46 tests)
docs/images/        generated charts
```

## References

- DARPA BAA HR001126S0014, *Lightweight Universal Codec* (Jul 2026), incl. LUC CUI
  Guide and Abstract Template.
- Duffy, Li, Médard, *Capacity-Achieving Guessing Random Additive Noise Decoding*,
  IEEE Trans. Inf. Theory 65(7), 2019.
- Riaz et al., *A Sub-0.8-pJ/bit Universal Soft-Detection Decoder Using ORBGRAND*,
  IEEE JSSC 60(7), 2025.
