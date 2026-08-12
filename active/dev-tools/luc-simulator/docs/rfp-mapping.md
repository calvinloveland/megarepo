# Mapping the DARPA LUC BAA (HR001126S0014) to this simulator

This document walks the solicitation requirement by requirement and says, for
each, what the simulator demonstrates, what it does **not** cover, and where in
the code the relevant machinery lives.  Use it to (a) judge readiness for a
proposal, (b) find the strongest evidence for each evaluation criterion, and
(c) spot the gaps that a real program would have to fill.

> Disclaimer: this is a *research-grade software prototype*, not a compliance
> package.  Nothing here constitutes an offeror's submission or legal advice.

---

## 1. Program goal & TA1 objectives

> "DARPA IPTO seeks to develop a universal, adaptive encoder-decoder (codec)
> capable of sending and receiving information using any known communication
> error correction code and any developed in the future." (Section 2.1)

**Demonstrated.** The codec encodes and decodes 15 codes across 7 families
(repetition, Hamming, BCH, Reed–Solomon, Polar, LDPC, Turbo-lite) with **one**
decoder algorithm (`grand.grand_decode`), which never inspects a code's internal
structure — it only asks the code's membership oracle `LinearCode.contains`
(`linear.py`, `codes.py`).  New codes can be registered at runtime
(`codec.UniversalCodec.register`) and are decoded with zero decoder changes —
the "any code developed in the future" story.

| TA1 objective (BAA §2.4) | Where in the code |
|---|---|
| 1. Universal encoder (multiple code classes, adaptive real-time selection) | `codec.py`: `UniversalCodec.select_code` (policy), `encode_frame` (packing + in-band code-ID header) |
| 2. Integrate encoder with a universal decoder | `codec.py` pairs the policy with `grand.grand_decode`; one algorithm for all families |
| 3. Integrate into an existing, performer-nominated communication system | `sim.run_link` integrates the codec into a BPSK/AWGN link with framing, CRC-16, and SNR estimation; the LUC Link Explorer (`serve.py`) wraps it in a browsable link |

**Not covered:** a real transceiver, RF front-end, or a specific nominated
platform; hardware implementation; interoperability with existing standards'
frames beyond the code sets.

---

## 2. Program metrics (Table 1)

| Metric | Simulator evidence | Gaps |
|---|---|---|
| **1. Codes supported on a single algorithm** | 15 instances / 7 families; `luc-sim codes`; all decoded by one GRAND algorithm (`tests/test_grand.py`). 3GPP Polar control codes are approximated by Arikan-style `polar(32,11)` (5G beta-expansion reliability); RS/Turbo/LDPC representatives are included; "100 mission codes" maps to the field-update registry. | Not the exact 3GPP TS 38.212 v19.3.0 parameter sets; no modular-polar long codes. |
| **2. Channel latency** | `sim.LinkReport.avg_queries` / `queries_per_info_bit` (GRAND query count as work proxy); adaptive-vs-fixed comparison in `luc-sim metrics`; web UI shows per-frame queries. | Proxy, not cycle-accurate latency; no silicon. |
| **3. Signal gain in dynamic noise** | `metrics.luc_metrics["metric_3_signal_gain_db"]`: Eb/N0 needed for the BLER target, adaptive vs fixed code (measured ≈ 2 dB on the demo channel). | Short-code regime; gain will differ for long industrial codes. |
| **4. BLER at Eb/N0 = 5 dB** | `luc-sim metrics` reports BLER@5 dB for every code; BLER curves via `luc-sim plot` / web UI. | Measured BLER is worse than the 1% program target because the prototype uses short codes for tractable exhaustive GRAND search. |
| **5. Receiver decoder power** | `queries_per_info_bit` as power proxy (GRAND power ∝ queries; ORBGRAND silicon is sub-0.8 pJ/bit). | Proxy only; no PPA model. |
| **6. Time to switch code classes** | `sim.switch_latencies_ms` — measured from each channel step to the code change (includes detection + decision); median ≈ 2 ms at 1 ms/frame; web UI shows switch markers. | Assumes 1 ms frames; no hardware timing. |

---

## 3. Adaptive operation & the "dynamic" story (BAA §2.3, §2.4)

> "…capable of multiple on-the-fly selection of error correction codes… the
> encoder incorporates the decoder's noise model as well as other operating
> factors into its code selection process for link budget and task/mission
> optimization."

Every frame the receiver estimates Eb/N0 from raw samples
(`channel.estimate_ebn0_db`) and feeds it back; the encoder scores every code as
**frame-level** goodput under the BLER target with **hysteresis** (SNR deadband +
score margin) so it never thrashes (`codec.UniversalCodec.select_code`).  Three
mission modes (`throughput` / `latency` / `robust`) re-weight the objective —
`luc-sim missions` compares them on the same channel.  The in-band code-ID
header (repetition-protected, `codec.UniversalCodec.encode_frame`) lets the
receiver switch with the transmitter with no out-of-band control channel.

**Demo:** `luc-sim demo` (terminal timeline), `luc-sim serve` (browser:
true-vs-estimated SNR, per-frame code-family band, switch markers, error and
sync-loss markers, hover tooltips), `luc-sim timeline` (SVG artifact).

---

## 4. Field updateability (BAA §2.3, metric-1 note, deliverable context)

> "updateability to facilitate new codes without implementation redesign."

`UniversalCodec.register` adds (or replaces) a code at runtime; the decoder needs
no changes because it only uses the membership oracle.  One code-ID slot is kept
free in the default registry for exactly this (the header is 4 bits, so at most
16 codes).  Demonstrated end-to-end in `tests/test_codec.py::test_field_update_registers_new_code`.

---

## 5. Abstract template sections (BAA §6, LUC Abstract Template)

| Template section | How the simulator supports it |
|---|---|
| **Goals and Impact** | Measured adaptive-vs-SoTA wins: 5× lower BLER at comparable goodput on the demo channel, 2 dB signal gain, ~2 ms switch latency, 15 codes / 7 families on one algorithm. |
| **Technical Approach** | The whole repository *is* the technical approach: universal GRAND decoding via membership oracles, decoder-driven channel estimation, mission-aware code selection, in-band signaling, CRC-protected framing. |
| **IP Plan** | `docs/index.md` + this document scope what is our own implementation (all ECC constructions are textbook/prior art; GRAND is DARPA's own published research). A proposal still needs the formal IP Management Plan + S-BOM (BAA §2.8.11). |
| **Capabilities / Management / Security** | Not addressed by software; team/security/CMMC claims are out of scope here. |
| **Cost and Schedule** | The 12-month Phase 1 (design, modeling, simulation) maps directly to this prototype's scope; Phase 2 (integration, field testing) would follow the same code paths with real radios. |

---

## 6. Deliverables the prototype already produces (BAA §2.7)

- **#3/#4 Commented source, build scripts, docs, software modules for testing** —
  the package itself; `pytest` suite (61 tests) is the Phase-1-style module test.
- **#7/#8 Quarterly/monthly reports** — N/A for a prototype, but
  `luc-sim metrics --json` and `luc-sim sweep --json` produce reproducible
  measurement artifacts that would back those reports.
- **#11 Final report** — `docs/index.md` + this document.
- **#2/#5 Prototype hardware** — out of scope (software only).

---

## 7. Security, IP, and export considerations (BAA §3, §2.8)

- The simulator itself is unclassified, dependency-free, and portable; it
  processes no CUI.
- **IP:** the code families are standard constructions (Hamming, BCH, RS, Polar,
  LDPC, Turbo) — public prior art; GRAND decoding is DARPA's published research
  (Duffy/Li/Médard 2019, Riaz et al. 2025).  A real proposal must still file the
  required IP Management Plan + S-BOM and assess Freedom-to-Operate (BAA
  §2.8.10–11).
- **Export control:** the LUC CUI Guide notes ECCN 5A001/5A991 thresholds apply
  as a codec crosses performance thresholds; a software prototype is the natural
  place to start that assessment.

---

## 8. Honest gaps (what a program must add)

1. **Long industrial codes** — real 5G LDPC/Polar parameter sets, exact 3GPP
   TS 38.212 control-channel polar codes, RS(255,223)-class codes, and modular
   polar long codes.  GRAND's exhaustive search does not scale to those without
   structured decoders (syndrome-based GRAND, ABGRAND, etc.).
2. **Decoder performance model** — real cycle/energy numbers (the sub-0.8 pJ/bit
   ORBGRAND reference) instead of query-count proxies.
3. **A real nominated platform** — SDR or chip integration and A/B SWaP testing
   with stock devices (Phase 2).
4. **Field tests** — multi-location, multi-environment testing per the program
   schedule.
5. **Security/CMMC posture** — CMMC Level 2, NIST SP 800-171, CUI handling are
   organizational requirements, not software features.
6. **Metrics at program scale** — the 1% BLER @ 5 dB target and 10–15× power
   claims need long-code + silicon evidence.

---

## Quick index

| Topic | Files |
|---|---|
| Universal decoder | `src/luc_sim/grand.py` |
| Code families & registry | `src/luc_sim/codes.py`, `src/luc_sim/linear.py`, `src/luc_sim/gf.py` |
| Codec + policy + signaling | `src/luc_sim/codec.py` |
| Channel model | `src/luc_sim/channel.py` |
| Link simulation / metrics | `src/luc_sim/sim.py`, `src/luc_sim/metrics.py` |
| Web UI + JSON API | `src/luc_sim/serve.py`, `src/luc_sim/web/index.html` |
| Charts | `src/luc_sim/plot.py` |
| CLI | `src/luc_sim/cli.py` |
| Tests | `tests/` (61 tests) |
| Verification (browser) | `scripts/verify_web_ui.py` |
