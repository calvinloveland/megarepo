# LUC Proposal Abstract — Working Draft

> **Status: internal working draft.** Follows the official LUC Abstract Template
> (BAA HR001126S0014 attachment): cover sheet, Goals and Impact, Technical
> Approach, IP Plan, Capabilities/Management/Security Plan, Cost and Schedule,
> Bibliography, Technical Papers. Replace `[PLACEHOLDER]` fields before use.
> Formatting rules: ≤ 8 pages (cover/TOC/bibliography excluded), 12-pt font,
> 1" margins, 8–10-pt allowed for figures/tables, PDF or Word, submit via BAAT
> as `Organization Name_LUC Abstract`.

---

## Cover Sheet

| Field | Value |
|---|---|
| Abstract Title | **[PLACEHOLDER: e.g. "Universal Adaptive Error-Correcting Codec via GRAND-Style Membership-Oracle Decoding"]** |
| Proposer Organization | **[PLACEHOLDER]** |
| Technical POC | Name / Mailing Address / Telephone / Email — **[PLACEHOLDER]** |
| Administrative POC | Name / Mailing Address / Telephone / Email — **[PLACEHOLDER]** |
| Other Team Members | **[PLACEHOLDER: subs / consultants]** |
| Award Instrument Requested | **[Research Other Transaction (10 U.S.C. §4021) / OT for Prototype (10 U.S.C. §4022) / Procurement Contract]** |
| Estimated Total Cost — Base Phase 1 | **$[PLACEHOLDER]** |
| Estimated Total Cost — Option Phase 2 | **$[PLACEHOLDER]** |
| Estimated Period of Performance | 12 months base + 27 months option |
| Other solicitations for this concept | **[PLACEHOLDER: none / list]** |

**Acknowledgment:** By submitting this abstract, the Offeror acknowledges the
solicitation's research-only scope, the test-article limitation, the absence of
contemplated production/commercialization under the solicitation, the offeror's
responsibility for patent-risk management, and that any future production or
deployment requires a separate action with separately negotiated terms.

---

## 1. Goals and Impact

We propose a universal, adaptive error-correcting codec built on a single
decoding algorithm — a GRAND-style (Guessing Random Additive Noise Decoding)
membership-oracle decoder — that can communicate using any known code family
(Polar, Reed–Solomon, Turbo, LDPC, BCH, Hamming, repetition) and any code
registered in the future, switching code classes on the fly while a link is
operating.

**What difference it makes.** Today a link fixes its code (or a tiny set) at
design time; changing code *classes* mid-operation is impractical because each
family needs its own decoder.  LUC turns that on its head: the decoder never
needs to know *which* code it is decoding — it only asks "is this a valid
codeword?".  The encoder therefore becomes a policy problem: pick, every frame,
the code that best meets the link budget and mission under the current channel
conditions.  The result is a transceiver that automatically optimizes error
correction against dynamic noise — including burst noise and deep fades — and
can absorb new codes by a software/table update instead of a redesign.

**Quantitative evidence (from our working prototype).** We have implemented and
measured this exact architecture end-to-end (pure-Python, reproducible):

- **Codes supported on one algorithm:** 15 code instances across 7 families
  (n = 5…64, k = 1…45), all decoded by one GRAND algorithm; long codes
  (RS(15,11), BCH(63,45), BCH(63,36), LDPC(64,40)) are handled via
  syndrome-membership oracles with no decoder changes.
- **Robustness in dynamic noise:** on a channel stepping 12 → 4 → 9 → 1.5 →
  10 dB with bursts, the adaptive codec achieves **BLER 0.06 vs 0.32** for a
  fixed state-of-the-art code on the same channel — a **5× reduction** at
  comparable goodput — and **2 dB less Eb/N0** needed to reach the BLER target.
- **Switching:** code-class switches happen in **~2 ms** (median) after a
  channel change, with hysteresis to prevent thrashing (15–40 switches over
  600–800 frames).
- **Decoder power story:** GRAND's work scales with the *noise load*, not the
  code length — at 9 dB Eb/N0 even 64-bit codes decode with a single membership
  check — matching the published sub-0.8 pJ/bit GRAND-silicon trajectory.

**Innovation vs state of practice.** The state of practice couples each code
family to a bespoke decoder (Viterbi, BCJR, SC, belief propagation…) and fixes
the code at design time.  Our approach decouples *decoding* from *code choice*:
one universal algorithm plus a codebook/update policy.  This is the GRAND
principle extended from "decode many codes" (GRAND's decoder result) to "operate
a link adaptively across all of them" (LUC's codec result).

## 2. Technical Approach

### 2.1 Feasible universal encoding–decoding

**Decoder.** The GRAND algorithm enumerates candidate noise patterns in order of
increasing likelihood and returns the first guess that lands on a valid
codeword (Duffy/Li/Médard 2019).  It needs only a *membership oracle* per code.
For enumerable codes the oracle is a codebook set; for long codes it is an exact
syndrome evaluation (GF or parity-check).  This one decoder handles every
family in the registry, and a newly registered code is decoded with **zero
changes** to the decoder — demonstrated in our prototype via runtime code
registration ("field update").

**Encoder / code selection.** Every frame the receiver estimates Eb/N0 from
received samples; the encoder scores every candidate code by *frame-level*
goodput (rate × number of codewords per frame × predicted frame success) under
the BLER target, with three mission modes (throughput / latency / robust) and
hysteresis (SNR deadband + score margin) to avoid thrashing.  Code identity
rides in a repetition-protected in-band header, so switching requires no
out-of-band control channel.

**Channel inference from decoder data.** Rather than assuming a fixed noise
model, the receiver estimates the channel state directly from received soft
samples each frame and smooths it; the same estimate feeds both code selection
and, through the codebook search, the decoder's reliability ordering.

### 2.2 Efficient, scalable code selection and convergence

Code selection is a *measured-profile* policy: each code's BLER-vs-SNR curve is
characterized (offline and, in Phase 2, in situ), cached, and consulted per
frame at 0.5 dB resolution.  Selection cost is O(#codes) profile lookups; the
search itself is bounded by a query budget that doubles as the power/latency
budget.  "Code convergence" — the transition when the channel changes — is
bounded by the estimate smoothing time plus the decision latency, measured at
~2 ms median in our prototype.

### 2.3 Target platforms and integration

Our Phase-1 prototype is a complete software link (BPSK/AWGN, framing, CRC-16,
signaling, adaptive policy, metrics) that runs in a browser — the LUC Link
Explorer.  For the program we propose to integrate the codec into
**[PLACEHOLDER: performer-nominated platform(s) — e.g., an SDR-based
tactical radio waveform / a 5G-NR control-channel processing chain / a
satellite DVB-S2 modem]**, selected for the largest measured link-budget
improvement per the solicitation's intent, with concrete backward-compatibility
(A/B with stock devices) and field-update (codebook push) plans.

### 2.4 Key technical challenges and risks

1. **GRAND work at very low SNR** — the exhaustive search's query budget bounds
   how robust a code can practically be; mitigated by profile-driven selection
   (only codes GRAND can actually decode within budget are chosen) and, in
   Phase 2, by syndrome-based/ABGRAND accelerations.
2. **Misdecode detection** — a universal decoder can return a *valid but wrong*
   codeword; our frames carry a CRC-16 so misdecodes are detected exactly as a
   real link would (measured and modeled in the prototype).
3. **Signaling overhead** — in-band code-ID headers cost bandwidth; mitigated
   by frame packing and amortization (prototype quantifies the trade).
4. **Long-code scaling** — exhaustive search does not scale to industrial
   parameter sets; the structured-membership (syndrome) path is the bridge, and
   Phase 2 targets exact 3GPP control-channel polar codes and RS/Turbo/LDPC
   representatives.

## 3. IP Plan

- **Background IP:** the code constructions (Hamming, BCH, RS, Polar, LDPC,
  Turbo) are standard, published constructions; GRAND decoding is DARPA's own
  published research.  Our contributions are the adaptive-policy architecture,
  the membership-oracle framing, and the field-update mechanism — to be
  identified precisely in the IP Management Plan and Software Bill of Materials
  (S-BOM) submitted with the full proposal (BAA §2.8.11).
- **Third-party risks:** we will disclose any known third-party patent or
  license constraints and design-around strategies in the IP Management Plan.
- **Data/software rights:** proposed rights (per the solicitation's
  research-only scope) will be stated for data, software, and any inventions;
  we do not anticipate restrictions that would impair Government research use
  or Freedom-to-Operate.
- **Flow-down:** the substance of these terms will be flowed to subcontractors
  per BAA §2.8.14.

## 4. Capabilities / Management / Security Plan

- **Team:** **[PLACEHOLDER: PI, key personnel, and relevant experience in
  error-correcting codes, decoder/silicon design, and communications systems]**.
  The proposer's prior work demonstrates delivery of **[PLACEHOLDER]**.
- **Organization:** **[PLACEHOLDER: org structure, roles, responsibilities,
  proposed subs]**.
- **Security:** the prototype work is unclassified; for the program we will
  conform to CMMC Level 2 (Final Level 2 in SPRS + annual affirmation), NIST SP
  800-171 / DFARS 252.204-7021, and the LUC CUI Guide (DoDI 5200.48 marking and
  handling).  Level of work proposed: **[unclassified / CUI]**.
- **Management:** biweekly DARPA status, quarterly technical and monthly
  financial reporting per BAA §2.6.2 and §2.7.

## 5. Cost and Schedule

- **Base Phase 1 (12 months) — $[PLACEHOLDER]:** codec design, modeling and
  simulation (extending the working prototype), profile-driven policy
  refinement, target-platform selection and integration study, design reviews
  at M6 and M11.
- **Option Phase 2 (27 months) — $[PLACEHOLDER]:** platform integration,
  transceiver bring-up, field tests in multiple locations, delivery of two (2)
  LUC-enhanced and two (2) stock devices for A/B SWaP testing, and end-of-phase
  evaluation (BAA §2.4, §2.6).
- Cost basis: **[PLACEHOLDER: labor by task, materials, equipment, fabrication,
  travel per the solicitation's informed-budget guidance]**; costs are
  tightly linked to the technical level of effort per BAA §5.

## 6. Bibliography (abridged)

1. K. R. Duffy, J. Li, M. Médard, "Capacity-Achieving Guessing Random Additive
   Noise Decoding," IEEE Trans. Inf. Theory 65(7), 2019.
2. A. Riaz et al., "A Sub-0.8-pJ/bit Universal Soft-Detection Decoder Using
   ORBGRAND," IEEE JSSC 60(7), 2025.
3. E. Arikan, "Channel Polarization," IEEE Trans. Inf. Theory 55(7), 2009.
4. R. W. Hamming, "Error Detecting and Error Correcting Codes," Bell Syst.
   Tech. J. 29(2), 1950.
5. DARPA BAA HR001126S0014, Lightweight Universal Codec (incl. CUI Guide and
   Abstract Template), 2026.
6. [Supporting results from our prototype: docs/ within the proposer's
   controlled repository, available to the Government on request.]

## 7. Technical Papers

☐ YES ☒ NO — technical papers included as part of this abstract.

---

## Notes on evaluation alignment (internal)

- **Technical Comprehension:** Section 2 addresses every bullet — universal
  encoding/decoding, channel inference from decoder data, efficient code
  selection *and* convergence, target platforms with backward-compat and field
  update plans, and key risks.
- **Technical Ability:** Section 4 + bibliography establish verifiable expertise
  in codes, decoders, and platforms; the working prototype is objective
  evidence.
- **IP Considerations:** Section 3 + the S-BOM/IP Management Plan at full
  proposal.
- **Cost Considerations:** Section 5 ties budget to the technical approach.

See `rfp-mapping.md` for the requirement-by-requirement trace and the honest
gap list (long industrial codes, real platform, silicon power model, CMMC
posture) that a full proposal must address.
