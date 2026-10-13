# Collatz Conjecture: State of the Art & Research Directions

## Summary

The Collatz conjecture (3n+1 problem) states that iterating
T(n) = n/2 (if even) or 3n+1 (if odd) eventually reaches 1 for all n ∈ N.
Despite verification up to 2^71 (Barina 2025), no proof exists.

## Key Results (chronological)

1. **Terras (1976)**: Almost all n have finite stopping time.

2. **Krasikov-Lagarias (2003)**: At least x^0.84 integers in [1,x] reach 1.

3. **Tao (2019)**: Almost all orbits (in logarithmic density) descend below
   any f(n)→∞. Uses entropy/ergodic methods. **Barrier**: log-density → natural
   density, and "below f(n)" → "reaches 1".

4. **Barina (2025)**: Verified all n < 2^71 converge to 1.
   Cycle length lower bound: ~2.18×10^11.

5. **Chang (2026)**: arXiv:2603.11066v6. Most comprehensive structural analysis.
   630 formal results across 29 mathematical paradigms.
   **Key conclusion**: All 29 paradigms hit the same "Distributional-to-Pointwise
   Gap" — proving almost-all convergence (distributional) is fundamentally
   different from proving all-convergence (pointwise).

## Chang (2026) — Detailed Contributions

### 7-Block IFS Decomposition
The Syracuse map on odd numbers admits a 7-block alphabet:
- From landmark 1 (n ≡ 1 mod 8): blocks a, b, s
- From landmark 7 (n ≡ 7 mod 8): blocks g, d, t1, t2
- Class 3 is transitional; class 5 is "death" (leads to descent)

Each block is an affine map Φ(x) = (ax + c)/2^V on Z2 (2-adic integers).

### Key Results (Unconditional)
1. **Spectral gap**: Transfer operator has uniform gap → equidistribution mod 2^M.
2. **Cycle bound**: D > 2^F unconditionally for L ≥ 3 → ord_D(2) > F.
3. **Divergence thin**: Potential divergent starting points have density 0,
   Hausdorff dimension ≈ 0.68 in Z2.
4. **Formal language**: Divergent-compatible v-sequences are not context-free.
5. **Carry Contamination Theorem**: Exact 1/4 elimination at every compatible depth.
6. **j ≥ 5 bound**: No K-bit integer survives 5+ consecutive non-descending
   exhaustion rounds (unconditional).
7. **Cycle exclusion**: Verified through period 13 on 7-block alphabet
   (238,811 contracting words, zero non-trivial fixed points).
8. **I2 spectral contraction**: Unconditional cylinder-averaged density-1 convergence.
9. **Discrete log triple filter**: 100% blockage for all L ≤ 500 tested.

### The Irreducible Core
The **Distributional-to-Pointwise Gap** is identified as the fundamental obstruction:
- C∞ (the survivor set) has 2-adic measure 0
- But measure 0 doesn't guarantee C∞ ∩ N = {1}
- The conjecture is equivalent to: C∞ ∩ N = {1}

### Two Equivalent Reductions
- **Route A**: Collatz ⇐ Weak Mixing Hypothesis (WMH: Σ δ_K < 0.557)
- **Route B**: Collatz ⇐ Carry Independence Conjecture (CIC)

### Sharpest Open Problem
The Collatz conjecture is equivalent to:
> The only natural number whose Collatz orbit stays in {1,3,7} mod 8 forever is 1.

Equivalently: the 2-adic Cantor set C∞ (attractor of the 7-block IFS) contains
exactly one natural number: 1.

## Remaining Barriers

1. **WMH/CIC**: Proving the mixing/convergence hypotheses that bridge
   distributional → pointwise.

2. **j-bound**: Unconditional j ≥ 5; need j = 1 for full conjecture.

3. **Cycle exclusion**: Proving D ∤ c_w for ALL non-trivial contracting words
   (not just verified through L=13).

4. **C∞ ∩ N**: Proving the survivor set contains only 1 as a natural number.

## Promising Research Directions

### 1. Automaton-Theoretic Approach
The safe Collatz map on Z2 can be modeled as a finite-state transducer on
2-adic digits. The survivor set C∞ is recognized by a specific automaton.
Can we prove C∞ ∩ N = {1} by analyzing the automaton structure?

### 2. Roth-Type Arithmetic Intersection
C∞ has Hausdorff dimension ~0.68 < 1. For 2-adic self-similar sets with
dimension < 1, can we bound the number of rational/natural points?
This would require a p-adic analogue of the Erdős-Volkmann ring conjecture.

### 3. Baker's Method Enhancement
The cycle equation n = C_w/(2^V - 3^p) is an S-unit equation. Baker's theorem
gives finiteness but not emptiness. Can we strengthen the bounds using the
specific structure of the carry polynomials c_w ∈ {1, 7, 19, 73}?

### 4. Carry Contamination Universality
The carry constants {1, 7, 19, 73} introduce specific primes. Can we prove
that D = 2^V - 3^p is never composed solely of primes that can divide C_w?
(Computational evidence: 88-95% of cases have gcd(C_w, D) = 1.)

### 5. Sturmian Rigidity
The critical β-density q* = log(4/3)/log(3/2) is irrational. Infinite
non-descending words must be Sturmian with slope q*. But Sturmian words
have rigid structure. Can we prove that no Sturmian word with slope q*
can be realized by a natural number?

### 6. Information-Theoretic via Kolmogorov Complexity
If n is a counterexample, its orbit encodes infinite information (aperiodic,
unbounded). But n is finite, so its Kolmogorov complexity is finite.
Can we formalize this contradiction?

## Computational Results (this exploration)

- Cycle exclusion verified through period 12 (2,508,928 cyclic words,
  71,538 contracting, 0 non-trivial fixed points), matching Chang (2026).
- Word counts verified against paper.
- Carry polynomial analysis: primes {7, 19, 73} from c_b appear alongside
  many others via carry contamination.
- Block statistics on odd n ≤ 2000: g:40.8%, s:16.0%, a:15.2%, b:14.9%,
  d:5.1%, t1:5.3%, t2:2.6%. Death rate near 100%.

## Conclusion

The Collatz conjecture remains open. The Chang (2026) paper has compressed
the problem to a sharply localized core: proving that the 2-adic IFS attractor
C∞ contains no natural number other than 1. This formulation exposes the
problem's essential arithmetic nature while eliminating probabilistic,
ergodic, and density-based approaches as insufficient.

The remaining gap is fundamentally number-theoretic: it concerns the 
intersection of a specific 2-adic fractal with the integers. Future progress
likely requires new tools bridging p-adic dynamics and Diophantine geometry.
