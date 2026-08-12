# luc-sim — Lightweight Universal Codec simulator + prototype

A pure-Python simulator and working prototype of the **DARPA Lightweight Universal
Codec (LUC)** concept (BAA HR001126S0014): a *universal, adaptive error-correcting
codec* that can communicate using any known error-correction code — or one developed
in the future — switching code classes **on the fly** while a link is operating, and
supporting field-updatable code books without redesign.

**Read the full docs:** [`docs/index.md`](docs/index.md)

## What's in the box

| Piece | What it is |
|---|---|
| `luc_sim/codes.py` | 13 codes across 7 families (repetition, Hamming, BCH, Reed-Solomon, Polar, LDPC, Turbo-lite), every one a linear block code with an exact membership oracle |
| `luc_sim/grand.py` | GRAND-style **universal decoder** — one algorithm decodes every family; it never inspects a code, it only asks "is this a codeword?" |
| `luc_sim/codec.py` | The universal codec: in-band code signaling, decoder-driven channel estimation, adaptive code selection with hysteresis, CRC-16 frame protection, field-updatable registry |
| `luc_sim/channel.py` | BPSK/AWGN channel with dynamic SNR schedules and burst noise |
| `luc_sim/sim.py` | Monte-Carlo link simulation, BLER sweeps, adaptive-vs-SoTA comparison |
| `luc_sim/metrics.py` | A report mirroring the LUC program's Table-1 metrics |
| `luc_sim/plot.py` | Dependency-free SVG BLER-curve charts |
| `luc_sim/cli.py` | `luc-sim {codes|sweep|metrics|demo|plot}` |

## Quickstart

```bash
uv venv --python /run/current-system/sw/bin/python3 .venv
uv pip install --python .venv/bin/python -e . pytest

luc-sim codes                 # list the code registry
luc-sim demo                  # adaptive streaming demo over a dynamic channel
luc-sim metrics               # LUC Table-1 style metrics report
luc-sim plot --all --out bler.svg   # BLER curves across all code families
```

The demo measures performance profiles on first run and caches them in
`~/.cache/luc-sim/profiles.json` (override with `LUC_SIM_CACHE`), so repeat runs are
instant.

## The LUC story, in one paragraph

The receiver estimates the channel from received samples; the encoder picks, every
frame, the code that maximizes mission goodput (throughput / latency / robustness)
subject to a BLER target; the code ID rides in a repetition-protected header so the
receiver can switch with it; the GRAND decoder needs nothing but the code's
membership oracle — which is exactly why a brand-new code can be *registered at
runtime* (field update) and decoded with zero changes.

See `docs/index.md` for architecture, honest measurement caveats, and sample results.
