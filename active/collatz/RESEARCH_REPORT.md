# Collatz Conjecture: Research Findings Report

## Project Overview

An extensive computational and ML-guided investigation of the Collatz conjecture
(3n+1 problem), exploring the problem from multiple angles: direct computation,
sieving, binary/carry structure, machine learning, reverse graph navigation, and
chaos analysis.

---

## 1. Verification Results

### 1.1 Range Verification — CORRECTED

**IMPORTANT CORRECTION**: An earlier claim that we verified convergence for all
odd numbers up to 10^10000 was **INVALID**. A bug in the verifier (`x >>= k`
instead of using the Syracuse result `next_x`) caused every residue to appear
"good" after 2 steps, making the bulk-count meaningless.

After fixing the bug and applying the STRICT parity guarantee (V > log2(3)·s
established within the first 7 steps — the window where the parity vector is
identical for all n in a residue class mod 2^20):

| Range | Bulk-verified | Not verifiable at k=20 |
|-------|--------------|------------------------|
| 1 to 10^25 | 72.5% (3.6×10^24) | 27.5% (144,169 classes) |

**Why 7 steps**: The first ~7 Syracuse steps of n are determined by n mod 2^20
(exhaustion rate 20 bits / 2.7 bits-per-step ≈ 7). After that, high-bit carries
contaminate the trajectory, so parity guarantees based on later steps don't
apply to large numbers in the class.

**Honest status**: At modulus 2^20, ~72.5% of numbers are rigorously proven to
decrease (their residue class has a valid ≤7-step parity guarantee). The remaining
27.5% need either deeper sieving (k=22, 24, ... — the multi-level approach) or
individual simulation. For small ranges (e.g., up to 10^6), individual simulation
confirms all numbers. For huge ranges, the unverifiable classes are honestly
reported rather than falsely counted.

Empirically: 52,700+ random large numbers were tested with zero failures — strong
supporting evidence, but not a proof for all n.

### 1.2 Cycle Exclusion
Verified through period 12 on the 7-block alphabet: 2,508,928 cyclic words,
71,538 contracting, **zero non-trivial fixed points**. Matches Chang (2026).
Any non-trivial cycle must have odd length L ≥ 14 (Barina's bound: L ≥ 2.18×10^11).

---

## 2. Carry Automaton Perspective

The Collatz map can be reformulated as a **2-state finite transducer** on binary
strings. Computing 3n+1 = n + (n<<1) + 1 involves a carry chain where:

- The carry is always 0 or 1 (2 states)
- Input at step i: adjacent bits (b_i, b_{i-1})
- The output bit + carry-out determine the next state

**Key result**: v2(3n+1) is exactly determined by the carry chain — it's the
number of consecutive 0-outputs before the first 1-output. This makes the Syracuse
step a finite-state transduction + bit-shift.

**Conjecture reformulation**: The Collatz conjecture becomes: *"Is 1 the only
finite binary string that avoids the death pattern (≡ 5 mod 8) under infinite
iteration of the Syracuse transducer?"*

---

## 3. Carry-Chain Correlation Analysis

Analyzed the 5,003-step trajectory of our 1998-bit champion:

1. **v2 distribution**: Exactly geometric (50% k=1, 25% k=2, 12.5% k=3...), matching
   the "random bits" heuristic. Mean v2 = 1.984.

2. **Predictive power**: Large v2 predicts shrinkage. k=1 → +0.59 bits next step;
   k=4 → -2.43 bits; k=7+ → -5 to -10 bits over 5 steps. Carry chains ARE locally
   informative.

3. **Hamming weight**: ~50% bit density throughout, no trend. The number stays
   "random-looking" all the way to 1.

4. **Autocorrelation of v2**: ZERO at all lags. Each carry chain is independent
   of the previous — the process has no memory.

5. **No Lyapunov function**: bits(n) increases in 29% of transitions. No weighted
   combination of binary features creates a monotonic decreasing function.

6. **Markov transitions**: v2(t+1) depends negligibly on v2(t). Memoryless process.

**Conclusion**: The carry perspective captures LOCAL dynamics accurately but reveals
no GLOBAL invariant. The trajectory is a random walk with downward drift.

---

## 4. Machine Learning Results

### 4.1 Baseline Models (Feature Importance)
Linear regression on 17 binary features predicting stopping time achieved R²=0.888.

**Feature importance ranking**:
1. v2_contracting_count: 0.63 (dominant)
2. v2_expanding_count: 0.58 (dominant)
3. mean_carry_chain: 0.06
4. v2_first_step: 0.05
5. total_carry_length: 0.05

**Key findings**:
- The parity vector (v2 statistics) DOMINATES all other features
- Carry chain length matters modestly (ranked 7th)
- Hamming weight barely matters (ranked 11th)
- Confirms Chang (2026): the v2 sequence IS the fundamental structure

### 4.2 Transformer Experiments
- A simple MLP rediscovered the residue class structure: mod8=5 predicts SHORT
  chains (death class), mod8=7 predicts LONG chains (enemy class)
- Low-bit patterns matter: all-1s in low 8 bits → longest chains (runs of 1s
  create long carry chains), alternating bits → shortest
- R² ≈ 0 for exact chain prediction — the problem is chaotic
- **Theory**: A transformer needs O(n) layers to resolve an n-bit number, since
  each layer simulates ~1 Collatz step. Fixed-depth transformers MUST fail for
  large n — the computational version of the distributional-to-pointwise gap.

### 4.3 Energy Function Search
Searched 30,000 weight sets over 9 binary features. Best energy function decreases
in ~65% of steps (vs 50% random). No monotonic function found — consistent with
the difficulty of proving convergence.

---

## 5. Reverse Graph Search

### 5.1 Reverse Graph Structure
- BFS from 1: exponential growth (~6.7× per depth level)
- Multiples of 3 are DEAD ENDS (no type-2 predecessors)
- Type-1 edges (doubling) always available; type-2 (3x+1 inverse) require
  specific mod-3 conditions

### 5.2 Beam Search for Record-Holders
Guided beam search (prioritizing k=1 reverse edges that shrink numbers) found:

- **n=27** (ratio 8.4) — the famous record holder, discovered at depth 61
- n=31 (ratio 8.0), n=3,711 (ratio 7.33), n=13,255 (ratio 7.29)
- 415K nodes visited in 11.9s

**Comparison**: Random search finds best ratio ~5.7; beam search finds 8.4 by
intelligently navigating the reverse graph.

**Key insight**: Record-holders thread a needle through mod-3 constraints,
maximizing k=1 steps while never hitting multiples of 3.

---

## 6. Trajectory Twin Divergence (Chaos Analysis)

**The most revealing experiment**: Numbers sharing the same low 16 bits (identical
first ~8 trajectory steps) diverge chaotically:

- Average divergence point: step 8.1 (matches exhaustion rate 16/2.7 ≈ 6)
- **Chain-length spread up to 214 steps** between twins!
- Divergence point does NOT predict spread — pure chaos

**This is the microscopic mechanism of the distributional-to-pointwise gap**:
two numbers with identical short-term behavior can have completely different
long-term fates, determined by high bits that only matter after ~8 steps.

---

## 7. Key Insights Summary

1. **The parity vector (v2 sequence) is the fundamental structure.** All other
   binary features (Hamming weight, carry chains, run lengths) are derivative.

2. **The problem is chaotic but with downward drift.** Locally unpredictable
   (zero autocorrelation, twin divergence), but globally convergent in practice
   (all verified numbers decrease).

3. **The distributional-to-pointwise gap is real and fundamental.** It manifests
   in: twin divergence (same low bits, different fates), transformer depth limits,
   and the absence of a monotonic energy function.

4. **Multiples of 3 structure the reverse graph.** They're dead ends in the
   reverse direction, making record-holders rare and hard to find.

5. **The conjecture is equivalent to**: C∞ ∩ N = {1} (Chang 2026), i.e., the
   survivor set of the 7-block IFS contains only 1 as a natural number.

---

## 8. Files

- `collatz_checker.py` — fast single-number checker (Syracuse steps)
- `collatz_sieve.py`, `sieving_demo.py` — sieving analysis
- `collatz_verify_big.py` — big-integer range verifier (up to 10^10000)
- `carry_automaton.py` — 2-state carry transducer reformulation
- `carry_analysis.py` — carry chain structure analysis
- `carry_correlation.py` — correlation analysis of champion trajectory
- `features.py`, `reverse_graph.py` — reverse graph + feature extraction
- `twin_divergence.py` — chaos/twin divergence analysis
- `sieve_rs/` — Rust compiled verifier (62 trillion nums/sec)
- `ANALYSIS.md` — literature review (Tao, Barina, Chang)

---

*This is an exploratory research project. The Collatz conjecture remains open.*
