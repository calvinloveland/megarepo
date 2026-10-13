# Collatz Conjecture: Exploration Results

## What was accomplished

### 1. Literature Review
- **Tao (2019)**: Almost all orbits descend below any f(n)→∞ (logarithmic density).
  Barrier: cannot upgrade to pointwise "all n reach 1".
- **Chang (2026)**: arXiv:2603.11066v6. 233-page comprehensive structural analysis.
  630 formal results, 29 mathematical paradigms. All hit the same
  Distributional-to-Pointwise Gap. Reduces conjecture to WMH or CIC.
- **Barina (2025)**: Verified all n < 2^71. Cycle period lower bound ~2.18×10^11.

### 2. Computational Verification
- Reproduced Chang's cycle exclusion results through period 12
  (2,508,928 cyclic words, 71,538 contracting, 0 non-trivial fixed points)
- Verified block formulas for the 7-block IFS decomposition
- Analyzed carry polynomial prime distributions
- Block statistics confirm ~100% death rate for odd n ≤ 2000

### 3. Analysis Document
See ANALYSIS.md for comprehensive state-of-the-art summary and
research directions.

## Key Open Problems (from Chang 2026)

1. **WMH** (Weak Mixing Hypothesis): Σ δ_K < 0.557
   → would prove full conjecture via Route A

2. **CIC** (Carry Independence Conjecture): No n > 1 avoids class 5 forever
   → equivalent to Collatz via Route B

3. **C∞ ∩ N = {1}**: The 2-adic survivor set contains only one natural number
   → sharpest formulation of the conjecture

4. **j-bound**: Currently unconditional for j ≥ 5, need j = 1

5. **Cycle exclusion**: D ∤ c_w for all non-trivial contracting words
   (verified through L=13, needs proof for all L)

## Promising New Directions

1. **Automaton-theoretic**: Model C∞ as an automatic set in Z2.
   Analyze the associated finite automaton to prove C∞ ∩ N = {1}.

2. **Sturmian rigidity**: Non-descending words must be Sturmian with
   irrational slope q*. Prove no such word is realizable over N.

3. **Information-theoretic**: Counterexample orbit encodes infinite
   information, contradicting finite Kolmogorov complexity of n.

4. **p-adic Diophantine approximation**: Use Roth-type theorems for
   2-adic self-similar sets with dimension < 1.

## Files

- `collatz_explore.py` - Initial exploration and block decomposition
- `cycle_search.py`, `cycle_search2.py` - Cycle enumeration and counting
- `cycle_count.py` - Transition matrix cycle counting
- `rw_verify.py`, `rw_verify2.py`, `rw_verify3.py` - Exhaustion residue checks
- `automaton.py` - Automaton construction for C∞
- `ANALYSIS.md` - Comprehensive state-of-the-art analysis
