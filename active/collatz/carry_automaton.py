#!/usr/bin/env python3
"""
Carry-Automaton Collatz Simulator.

Operates entirely on binary strings (LSB first) using the 2-state carry
transducer for computing 3n+1. The Syracuse step is:
  1. Run the carry automaton on n's binary digits to produce 3n+1
  2. Drop the k trailing zeros (where k is the number of consecutive
     0-bits before the first 1 in the output)
  3. The remaining bits form the next odd number

This finite-state perspective lets us analyze the Collatz map as a
transduction on binary strings and characterize the survivor language C∞.

Key insight: computing 3n+1 requires knowing pairs of adjacent bits
(b_i, b_{i-1}) plus the carry. This is a 2-state automaton with 4 input
symbols. The Syracuse step adds a SHIFT (dropping k bits), which changes
bit alignment for the next step.
"""

import math
from collections import defaultdict, Counter

# ---------------------------------------------------------------------------
# The Carry Automaton
# ---------------------------------------------------------------------------

# Transition table: (carry_in, b_i, b_{i-1}) → (output_bit, carry_out)
# b_i = current bit of n, b_{i-1} = previous bit (for 2n shift)
# Initially: carry = 1 (from +1), b_{-1} = 0

CARRY_TABLE = {
    # (carry, b_i, b_prev) → (out, next_carry)
    (0, 0, 0): (0, 0),
    (0, 0, 1): (1, 0),
    (0, 1, 0): (1, 0),
    (0, 1, 1): (0, 1),
    (1, 0, 0): (1, 0),  # sum=1 → out=1, carry STOPS
    (1, 0, 1): (0, 1),  # sum=2 → out=0, carry CONTINUES
    (1, 1, 0): (0, 1),  # sum=2 → out=0, carry CONTINUES
    (1, 1, 1): (1, 1),  # sum=3 → out=1, carry CONTINUES (doesn't stop!)
}

def compute_3n_plus_1_bits(n_bits, max_len=None):
    """
    Given n as a list of bits (LSB first), compute 3n+1 as bits.
    Returns (output_bits, final_carry).
    """
    if max_len is None:
        max_len = len(n_bits) + 10
    
    out = []
    carry = 1  # from +1
    
    for i in range(max_len):
        b_i = n_bits[i] if i < len(n_bits) else 0
        b_prev = n_bits[i-1] if (i > 0 and i-1 < len(n_bits)) else 0
        
        bit, carry = CARRY_TABLE[(carry, b_i, b_prev)]
        out.append(bit)
    
    return out, carry

def syracuse_on_bits(n_bits):
    """
    One Syracuse step on binary representation.
    Returns (next_n_bits, k) where k = v2(3n+1).
    """
    out, _ = compute_3n_plus_1_bits(n_bits)
    
    # Count trailing zeros (position of first 1)
    k = 0
    while k < len(out) and out[k] == 0:
        k += 1
    
    if k >= len(out):
        return [1], k  # Result is 1
    
    # Drop k trailing zeros and the first 1? 
    # Actually: 3n+1 = ... b_{k+1} b_k 0...0 (k zeros)
    # After dividing by 2^k: ... b_{k+1} b_k
    # The bit at position k is 1 (first non-zero), and higher bits remain
    # So we drop the k zero bits, keeping everything from position k onward
    next_bits = out[k:]  # Includes the first 1 at position k
    
    # Ensure odd (LSB should be 1)
    assert next_bits[0] == 1, f"Result should be odd, got LSB={next_bits[0]}"
    
    return next_bits, k

def bits_to_int(bits):
    """Convert LSB-first bit list to integer."""
    return sum(b << i for i, b in enumerate(bits))

def int_to_bits(n):
    """Convert integer to LSB-first bit list."""
    if n == 0:
        return [0]
    bits = []
    while n:
        bits.append(n & 1)
        n >>= 1
    return bits

# ---------------------------------------------------------------------------
# Verify against integer arithmetic
# ---------------------------------------------------------------------------

def test_automaton(limit=1000):
    """Verify the carry automaton matches integer arithmetic."""
    print("Verifying carry automaton against integer arithmetic...")
    errors = 0
    for n in range(1, limit + 1, 2):
        n_bits = int_to_bits(n)
        
        # Compute 3n+1 both ways
        out_bits, _ = compute_3n_plus_1_bits(n_bits)
        automaton_result = bits_to_int(out_bits)
        integer_result = 3 * n + 1
        
        if automaton_result != integer_result:
            print(f"  MISMATCH: n={n}, automaton={automaton_result}, integer={integer_result}")
            errors += 1
        
        # Compute Syracuse step both ways
        next_bits, k = syracuse_on_bits(n_bits)
        automaton_next = bits_to_int(next_bits)
        
        # Integer Syracuse
        x = 3 * n + 1
        k_int = (x & -x).bit_length() - 1
        integer_next = x >> k_int
        
        if automaton_next != integer_next or k != k_int:
            print(f"  MISMATCH: n={n}, auto: k={k}, next={automaton_next}, "
                  f"int: k={k_int}, next={integer_next}")
            errors += 1
    
    if errors == 0:
        print(f"  All {limit//2} odd numbers verified ✓")
    else:
        print(f"  {errors} errors found ✗")

# ---------------------------------------------------------------------------
# The Syracuse Transducer
# ---------------------------------------------------------------------------

def syracuse_transducer_state(n_mod_8):
    """
    The Syracuse step can be characterized by n mod 8:
    - n ≡ 1 (mod 4): k ≥ 2 (contracting)
    - n ≡ 3 (mod 4): k = 1 (expanding)
    
    More precisely from the carry automaton:
    - n ≡ 1 (mod 8): b_2 b_1 b_0 = 001 → ?
    - n ≡ 3 (mod 8): b_2 b_1 b_0 = 011 → k=1
    - n ≡ 5 (mod 8): b_2 b_1 b_0 = 101 → k≥4 (death!)
    - n ≡ 7 (mod 8): b_2 b_1 b_0 = 111 → k=1
    """
    pass

# ---------------------------------------------------------------------------
# Characterizing C∞: the survivor language
# ---------------------------------------------------------------------------

def orbit_as_bit_transductions(n, max_steps=100):
    """
    Trace the Collatz orbit, showing each step as a bit transduction.
    Returns list of (n_bits, k, next_bits) for each Syracuse step.
    """
    bits = int_to_bits(n)
    trace = []
    
    for _ in range(max_steps):
        if bits == [1]:
            break
        
        next_bits, k = syracuse_on_bits(bits)
        trace.append((bits[:], k, next_bits[:]))
        bits = next_bits
    
    return trace

def survival_signature(n, depth=20):
    """
    Compute the 'survival signature' of n: for the first <depth> Syracuse steps,
    record whether each step is contracting (k≥2) or expanding (k=1).
    
    Returns a binary string where 0=contracting, 1=expanding.
    """
    bits = int_to_bits(n)
    sig = []
    
    for _ in range(depth):
        if bits == [1]:
            break
        
        next_bits, k = syracuse_on_bits(bits)
        sig.append('E' if k == 1 else 'C')
        bits = next_bits
    
    return ''.join(sig)

def classify_number(n):
    """
    Classify n by its initial Syracuse behavior.
    Returns the 7-block label (a, b, s, g, d, t1, t2, or 'death').
    """
    if n % 2 == 0:
        return 'even'
    if n == 1:
        return 'trivial'
    
    n_bits = int_to_bits(n)
    
    # First Syracuse step
    next1, k1 = syracuse_on_bits(n_bits)
    n1 = bits_to_int(next1)
    
    if n % 8 == 5:
        return 'death'
    elif n % 8 == 1:
        if k1 == 2 and n1 % 8 == 1:
            return 'a'
        elif k1 == 2 and n1 % 8 == 7:
            return 's'
        elif k1 >= 3:
            # Could be 'b' (1→3→1)
            next2, k2 = syracuse_on_bits(next1)
            n2 = bits_to_int(next2)
            if n2 % 8 == 1:
                return 'b'
    elif n % 8 == 7:
        if k1 == 1 and n1 % 8 == 7:
            return 'g'
        elif k1 == 1 and n1 % 8 == 3:
            # Could be d, t1, t2, or death
            next2, k2 = syracuse_on_bits(next1)
            n2 = bits_to_int(next2)
            if n2 % 8 == 1:
                next3, k3 = syracuse_on_bits(next2)
                n3 = bits_to_int(next3)
                if n3 % 8 == 7:
                    return 'd'
                elif n3 % 8 == 1:
                    return 't1'
                elif n3 % 8 == 3:
                    next4, k4 = syracuse_on_bits(next3)
                    n4 = bits_to_int(next4)
                    if n4 % 8 == 1:
                        return 't2'
            elif n2 % 8 == 5:
                return 'death'
    
    # Fallback: trace more
    x = n
    for _ in range(5):
        x_bits = int_to_bits(x)
        nx_bits, kx = syracuse_on_bits(x_bits)
        x = bits_to_int(nx_bits)
        if x % 8 == 5:
            return 'death'
    
    return 'unknown'

# ---------------------------------------------------------------------------
# Survivor language analysis
# ---------------------------------------------------------------------------

def analyze_survivor_language(k=12):
    """
    For residues mod 2^k, characterize which ones survive (don't hit class 5)
    within a small number of steps.
    
    This builds a finite description of C∞ at resolution k.
    """
    mod = 1 << k
    survivors = []
    death_by_step = Counter()
    
    print(f"Survivor language analysis at modulus 2^{k}")
    print(f"{'residue':>10s}  {'binary':>20s}  {'sig (first 16)':>20s}  fate")
    print("-" * 75)
    
    for r in range(mod):
        if r % 2 == 0 or r == 1:
            continue
        
        # Trace up to 32 Syracuse steps
        bits = int_to_bits(r)
        fate = 'alive'
        steps_to_death = 0
        sig = []
        
        for step in range(1, 33):
            if bits == [1]:
                fate = 'reached_1'
                break
            
            next_bits, k = syracuse_on_bits(bits)
            sig.append('E' if k == 1 else 'C')
            
            # Check if we hit class 5
            n = bits_to_int(next_bits)
            if n % 8 == 5:
                fate = 'death'
                steps_to_death = step
                death_by_step[step] += 1
                break
            
            bits = next_bits
        
        if fate == 'alive':
            survivors.append(r)
    
    # Show examples
    for r in survivors[:10]:
        bits = int_to_bits(r)
        sig = survival_signature(r, 16)
        print(f"{r:10d}  {''.join(str(b) for b in bits[:12][::-1]):>20s}  {sig:>20s}  SURVIVOR")
    
    print(f"...")
    print(f"Total odd residues: {mod//2 - 1}")
    print(f"Survivors after 32 steps: {len(survivors)} ({100*len(survivors)/(mod//2-1):.2f}%)")
    print(f"Death step distribution: {dict(death_by_step.most_common(10))}")
    
    return survivors

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    print("=" * 60)
    print("CARRY-AUTOMATON COLLATZ SIMULATOR")
    print("=" * 60)
    print()
    
    # 1. Verify correctness
    test_automaton(2000)
    print()
    
    # 2. Show example transductions
    print("Example bit-level Syracuse traces:")
    for n in [7, 9, 15, 25, 27]:
        trace = orbit_as_bit_transductions(n, 8)
        print(f"  n={n} ({n:08b}):")
        for i, (bits, k, next_bits) in enumerate(trace[:5]):
            n_val = bits_to_int(bits)
            next_val = bits_to_int(next_bits)
            print(f"    step {i}: {n_val} → k={k} → {next_val}")
        print()
    
    # 3. Survivor language
    survivors = analyze_survivor_language(10)
    print()
    
    # 4. The key insight
    print("=" * 60)
    print("THE CARRY AUTOMATON AND C∞")
    print()
    print("The Syracuse map is a 2-state transducer + bit shift.")
    print("Repeated application can be modeled as a non-uniform")
    print("cellular automaton on binary strings.")
    print()
    print("The survivor set C∞ = {n : orbit never hits class 5}")
    print("is the set of binary strings that avoid a specific")
    print("pattern (bits that make the output ≡ 5 mod 8) under")
    print("repeated transduction + shift.")
    print()
    print("This is a 'pattern avoidance' problem on an automatic")
    print("sequence. The question 'does C∞ ∩ N = {1}?' becomes:")
    print("'Is 1 the only finite binary string that avoids death")
    print(" under infinite iteration of the Syracuse transducer?'")
    print()
    print("This reformulation may be more amenable to proof than")
    print("the original arithmetic formulation.")
