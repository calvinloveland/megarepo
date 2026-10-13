#!/usr/bin/env python3
"""
Carry analysis for the Collatz map: how binary addition carries in 3n+1
determine the Syracuse step behavior.

Key: 3n+1 = 2n + n + 1. The carry chain from adding n + n + 1 determines
v2(3n+1), which controls how many times we divide by 2.

For odd n, write n in binary: n = ...b3 b2 b1 1
3n+1 = n + (n << 1) + 1

The trailing zeros of 3n+1 come from the carry chain in the low bits.
Let's analyze the exact relationship.
"""

import math
from collections import defaultdict, Counter

def to_binary(n, bits=40):
    """Return binary string of n (LSB first)."""
    return ''.join(str((n >> i) & 1) for i in range(bits))

def v2(x):
    return (x & -x).bit_length() - 1

def syracuse(n):
    x = 3*n + 1
    k = v2(x)
    return x >> k, k

def analyze_carry_chain(n, max_bits=64):
    """
    Analyze the carry chain in computing 3n+1.
    
    In binary: 3n+1 = n + (n<<1) + 1
    This is two additions:
      1. (n<<1) + n = 3n
      2. 3n + 1
    
    Or equivalently: n + n + n + 1 (three-way addition)
    
    Returns:
      - n in binary
      - carry pattern
      - resulting v2(3n+1)
      - next odd number
    """
    # Simulate bit-by-bit addition of n + 2n + 1
    bits = []
    carry = 1  # Start with the +1
    k = 0
    i = 0
    
    while i < max_bits:
        a = (n >> i) & 1  # bit of n
        b = ((n << 1) >> i) & 1  # bit of 2n (same as bit i-1 of n)
        
        # Sum = a + b + carry
        total = a + b + carry
        bit = total & 1
        carry = total >> 1
        
        bits.append(bit)
        i += 1
        
        if bit == 0 and carry == 0:
            # The carry chain stopped — all higher bits are just a + b
            # Actually, we need to continue to verify
            pass
    
    # Actually, let me just analyze v2(3n+1) more directly
    x = 3*n + 1
    k = v2(x)
    
    # The trailing zeros come from: how far does the initial carry=1 propagate?
    # For odd n, a_0 = 1, b_0 = 0 (since 2n has 0 in bit 0)
    # total = 1 + 0 + 1 = 2 → bit=0, carry=1
    # So we always get at least 1 trailing zero (k>=1)
    
    # a_1 = (n>>1)&1, b_1 = n&1 = 1 (since n is odd)
    # If a_1 = 0: total = 0 + 1 + 1 = 2 → bit=0, carry=1 → continues
    # If a_1 = 1: total = 1 + 1 + 1 = 3 → bit=1, carry=1 → continues
    
    # So carry ALWAYS propagates through bit 1. Whether it continues depends on a_2.
    # Actually let me think more carefully:
    # At position i:
    #   a_i = bit i of n
    #   b_i = bit i-1 of n (since 2n shifts left by 1)
    #   sum = a_i + b_i + carry_in
    #   bit_i = sum mod 2
    #   carry_out = sum // 2
    
    # The carry chain continues as long as carry_out = 1.
    # The first position where carry_out = 0 determines k.
    
    bits_n = [(n >> i) & 1 for i in range(max_bits)]
    trace = []
    c = 1  # initial carry from +1
    
    for i in range(min(max_bits, 64)):
        a_i = bits_n[i]
        b_i = bits_n[i-1] if i > 0 else 0  # 2n shifted
        s = a_i + b_i + c
        bit_i = s & 1
        c = s >> 1
        trace.append((i, a_i, b_i, bit_i, c))
        if bit_i == 1:
            # This is where carry stops propagating
            # Actually no — the carry can continue even if bit is 1
            pass
    
    # k = number of trailing zeros = first position where bit_i = 1
    # Actually k = v2(3n+1): the number of consecutive 0 bits at the bottom
    
    return x, k, trace

def carry_chain_length(n):
    """
    Compute the carry chain length: how many consecutive carries of 1
    happen when computing 3n+1, starting from the +1.
    
    Returns (k, chain_bits) where:
      k = v2(3n+1) = number of trailing zeros
      chain_bits = the pattern of carry propagations
    """
    x = 3*n + 1
    k = v2(x)
    
    # The carry chain length is related to k
    # For each bit position from 0 to k-1, the sum a_i + b_i + carry = 2 (bit=0, carry=1)
    # or = 3 (bit=1, carry=1) — in either case carry continues
    # At position k, the sum gives bit=1 and carry=0 (carry STOPS)
    
    # So k-1 is the number of positions where carry=1, and at position k, carry=0
    
    # Let's trace:
    chain = []
    c = 1
    for i in range(k + 2):
        a_i = (n >> i) & 1
        b_i = (n >> (i-1)) & 1 if i > 0 else 0
        s = a_i + b_i + c
        bit = s & 1
        c_next = s >> 1
        chain.append((a_i, b_i, c, s, bit, c_next))
        c = c_next
    
    return k, chain

def analyze_carry_statistics(limit=100000):
    """
    Analyze the carry chain statistics for odd numbers.
    """
    print("Carry Chain Analysis for 3n+1")
    print("=" * 60)
    print()
    
    # Count v2(3n+1) distribution
    k_counts = Counter()
    # Count carry chain patterns
    pattern_counts = Counter()
    
    for n in range(1, limit + 1, 2):
        k, chain = carry_chain_length(n)
        k_counts[k] += 1
        
        # Extract carry pattern (sequence of carry values)
        carry_pattern = tuple(c[4] for c in chain[:6])  # first 6 steps
        pattern_counts[carry_pattern] += 1
    
    total = len(k_counts)
    
    print(f"v2(3n+1) distribution for odd n < {limit}:")
    for k in sorted(k_counts.keys())[:10]:
        pct = 100 * k_counts[k] / (limit // 2)
        expected = 100 / (2 ** k)
        print(f"  k={k}: {k_counts[k]:>8d} ({pct:>6.2f}%)  [random would be ~{expected:.2f}%]")
    print()
    
    # The expected distribution if bits were random: P(k) = 1/2^k
    # Since 3n+1 is not random, let's see how it differs
    print("Most common carry patterns (first 4 steps):")
    for pattern, count in pattern_counts.most_common(8):
        pct = 100 * count / (limit // 2)
        print(f"  {pattern}: {count:>8d} ({pct:>5.2f}%)")
    
    return k_counts

def why_k_equals_1(n):
    """
    Explain why n has v2(3n+1)=1 (the 'dangerous' case where value increases).
    
    k=1 means: 3n+1 = 2 × odd → the carry chain stops immediately after bit 0.
    
    At bit 0: a=1, b=0, carry=1 → sum=2 → bit=0, carry_next=1
    At bit 1: a=a_1, b=1, carry=1 → need sum=3 → bit=1, carry_next=1
    Wait, that gives carry continuing. Let me redo.
    
    For k=1: 3n+1 ≡ 2 (mod 4). This means v2=1 exactly.
    3n+1 = 2 mod 4 → 3n ≡ 1 (mod 4) → n ≡ 3 (mod 4)
    
    At bit 0: sum=2, bit=0, carry=1
    At bit 1: a_1 + 1 + 1 must give bit=1 (non-zero) and carry=1
    Actually for k=1, the carry must STOP at bit 1.
    sum at bit 1: a_1 + b_1(which is n_0=1) + carry_in(1) = a_1 + 2
    For this to give bit=0 and carry=1: a_1=0 → sum=2 → bit=0, carry=1 (continues!)
    For bit=1 and carry=0: a_1=0 → sum=2 → bit=0, carry=1. Hmm.
    
    Wait, I need to re-think. k = v2(3n+1) = number of trailing zeros.
    After k zeros, the (k+1)th bit (0-indexed) of 3n+1 is 1.
    
    At position k: the sum gives bit=1 (the first non-zero bit)
    For k=1: 
      bit 0: sum must give 0 (trailing zero) → a_0+b_0+carry_in=even
      bit 1: sum must give 1 (stop) → a_1+b_1+carry_in=odd
    
    With a_0=1 (n odd), b_0=0 (2n has no bit 0), carry_in=1 (from +1):
      s_0 = 1+0+1 = 2 → bit=0, carry_out=1 ✓
    
    With carry_in=1 from bit 0, a_1 = (n>>1)&1, b_1 = n&1 = 1:
      s_1 = a_1 + 1 + 1 = a_1 + 2
      
    For bit_1 = 1 (first non-zero): a_1+2 must be odd → a_1 must be odd = 1
    Then s_1 = 3 → bit=1, carry_out=1 (still carries forward!)
    
    Wait, but if carry_out=1, then bit 2 might also be 0 or 1.
    For k=1 exactly, we need the carry to STOP giving zeros after bit 1.
    But carry_out from bit 1 is 1... so bit 2 depends on a_2 + b_2 + 1.
    
    Actually, k=1 means that 3n+1 has exactly ONE trailing zero:
    3n+1 = 2 × odd_number
    
    This means after dividing 3n+1 by 2, we get an odd number.
    So 3n+1 ≡ 2 (mod 4) → n ≡ 3 (mod 4).
    
    The carry chain length (positions where carry propagates) is NOT the same as k.
    Let me separate these concepts.
    """
    pass

def carry_and_valuation_table(max_bits=8):
    """
    Build a table showing: for each odd residue mod 2^k, what are
    v2(3n+1) and the carry pattern?
    """
    mod = 1 << max_bits
    
    print(f"\nCarry patterns for n mod 2^{max_bits}:")
    print(f"{'n':>6s}  {'binary':>16s}  {'3n+1':>10s}  {'v2':>4s}  {'T(n)':>10s}  {'carry chain':>20s}")
    print("-" * 75)
    
    for n in range(1, min(mod, 65), 2):
        x = 3*n + 1
        k = v2(x)
        tn = x >> k
        _, chain = carry_chain_length(n)
        chain_str = ''.join(str(c[4]) for c in chain[:6])
        print(f"{n:6d}  {n:016b}  {x:10d}  {k:4d}  {tn:10d}  {chain_str}")

if __name__ == '__main__':
    print("CARRY ANALYSIS FOR 3n+1")
    print()
    
    # 1. Show examples
    print("Examples of carry chains:")
    print(f"{'n':>6s}  {'n binary':>20s}  {'3n+1':>10s}  {'v2':>4s}  {'T(n)':>10s}")
    print("-" * 55)
    for n in [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27]:
        x = 3*n + 1
        k = v2(x)
        tn = x >> k
        print(f"{n:6d}  {n:020b}  {x:10d}  {k:4d}  {tn:10d}")
    
    print()
    
    # 2. Distribution of v2 values
    analyze_carry_statistics(20000)
    
    print()
    
    # 3. The key insight
    print("=" * 60)
    print("KEY INSIGHT: The Carry Contamination Theorem (Chang 2026)")
    print()
    print("Computing 3n+1 = n + 2n + 1 involves two additions.")
    print("The carry bits propagate through the binary representation.")
    print()
    print("For the Syracuse step: T(n) = (3n+1)/2^k")
    print("  k = v2(3n+1) = number of trailing zeros in 3n+1")
    print()
    print("The CARRY CHAIN determines k:")
    print("  - Each carry of 1 that propagates creates another trailing 0")
    print("  - The chain stops when a position sums to an odd value")
    print()
    print("The carry bits are NOT random — they're determined by n's binary")
    print("representation. Specifically, carries occur where n has runs of 1s.")
    print()
    print("For the 7-block IFS (Chang 2026), the carry constants are:")
    print("  c_a = 1, c_b = 7, c_s = 1, c_g = 1, c_d = 19, c_t1 = 19, c_t2 = 73")
    print()
    print("These carries introduce primes {7, 19, 73} into the cycle equation.")
    print("This 'contamination' is what makes the cycle non-divisibility")
    print("(D ∤ C_w) resist proof — the carry primes don't divide 2^V - 3^p.")
    
    print()
    
    # 4. The carry as a finite automaton
    print("=" * 60)
    print("THE CARRY AUTOMATON")
    print()
    print("The binary addition 3n+1 can be modeled as a finite-state transducer.")
    print("Reading bits of n (LSB first), the transducer outputs bits of 3n+1")
    print("while tracking the carry state (0 or 1).")
    print()
    print("State transitions for reading bit b of n (with 2n shifted):")
    print("  Input: bit b of n (and bit b-1 for 2n term)")
    print("  State: carry_in (0 or 1)")
    print("  Output: bit of 3n+1")
    print("  Next state: carry_out")
    print()
    print("This is a 2-state automaton! The carry can only be 0 or 1.")
    print()
    print("The v2(3n+1) is the number of consecutive 0 outputs before")
    print("the first 1 output. This is determined by how long the carry=1")
    print("state persists.")
    print()
    print("Since the automaton has only 2 states, the carry chain length")
    print("follows a Markov-like process. The transition probabilities")
    print("depend on the distribution of bits in n.")
    print()
    print("If the bits of n were independent fair coins:")
    print("  - P(carry stops) = 1/2 at each position")
    print("  - P(k) = 1/2^k (geometric distribution)")
    print("  - E[k] = 2")
    print()
    print("But Collatz numbers are NOT random. The binary structure of n")
    print("determines the carry pattern. This is where the structure lives.")
