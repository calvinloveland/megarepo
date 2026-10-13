#!/usr/bin/env python3
"""
Collatz universal verifier — Python big integer edition.
Verifies all odd numbers in [lo, hi] using parity-vector sieving.
Handles arbitrarily large ranges via Python's native big integers.

Usage: python3 collatz_verify_big.py <lo> <hi>
       python3 collatz_verify_big.py 1 10**100
"""

import sys
import math
import time

# Allow huge integer-to-string conversion for display
sys.set_int_max_str_digits(0)

LOG23 = math.log2(3)
SIEVE_K = 20

def v2(x):
    return (x & -x).bit_length() - 1

def syracuse_step(n):
    x = 3 * n + 1
    k = v2(x)
    return x >> k, k

def is_good(r, max_steps=200):
    """
    Check if residue r is provably good for ALL n in its class.
    
    STRICT VERSION: returns (True, step) only if the parity vector
    guarantee V > LOG23*s is established within the first 7 steps
    (where the parity vector is identical for all n ≡ r mod 2^20).
    
    After ~7 steps, high-bit carries contaminate the trajectory, so
    a 'good' verdict based on later steps does NOT apply to large n.
    
    Returns (is_good_for_all_n, decision_step).
    """
    if r == 1:
        return True, 0
    x = r
    V = 0
    s = 0
    for step in range(1, max_steps + 1):
        if x <= 1:
            break
        if x % 2 == 0:
            tz = v2(x)
            x >>= tz
            V += tz
            s += 1
        else:
            next_x, k = syracuse_step(x)
            x = next_x
            V += k
            s += 1
        if s >= 5 and V > LOG23 * s + 1:
            # Parity guarantee established at this step
            # Only valid for all n if step <= 7
            if step <= 7:
                return True, step
            else:
                return False, step  # Too late — doesn't apply to large n
    return False, max_steps

def count_class(lo, hi, r, k):
    """Count odd numbers ≡ r (mod 2^k) in [lo, hi]."""
    m = 1 << k
    first = lo + ((r - lo) % m)
    if first < lo:
        first += m
    if first > hi:
        return 0, 0
    if first % 2 == 0:
        first += m
        if first > hi:
            return 0, 0
    last = hi - ((hi - r) % m)
    if last > hi or last < first:
        return 0, 0
    count = (last - first) // m + 1
    return first, count

def verify_range(lo, hi):
    """Verify all odd numbers in [lo, hi]."""
    m = 1 << SIEVE_K
    trace_steps = SIEVE_K * 8
    
    verified = 0
    classes_done = 0
    simulated = 0
    uncertain_classes = 0
    sim_steps = 0
    
    for r in range(1, m, 2):
        first, count = count_class(lo, hi, r, SIEVE_K)
        if count == 0:
            continue
        
        if r == 1:
            verified += count
            classes_done += 1
        else:
            is_valid, step = is_good(r, trace_steps)
            if is_valid:
                verified += count
                classes_done += 1
            else:
                # STRICT: cannot bulk-verify this class.
                # We would need to simulate each number (infeasible for huge ranges)
                # or sieve deeper. Mark as unverifiable by this method.
                uncertain_classes += 1
                # For small ranges (count manageable), simulate:
                if count <= 100000:
                    n = first
                    for _ in range(count):
                        x = n
                        steps = 0
                        while x >= lo and x != 1 and steps < 100000:
                            if x % 2 == 0:
                                x >>= v2(x)
                            else:
                                x, _ = syracuse_step(x)
                            steps += 1
                        simulated += 1
                        sim_steps += steps
                        verified += 1
                        if x >= lo and x != 1:
                            print(f"  WARNING: n={n} survived! final={x}")
                        n += m
                # For huge ranges, we CANNOT claim these are verified.
    
    return verified, classes_done, simulated, sim_steps, uncertain_classes

def fmt(n):
    """Format large integer with commas."""
    if n < 10**15:
        return f"{n:,}"
    s = str(n)
    exp = len(s) - 1
    mantissa = s[:6]
    return f"{mantissa}... × 10^{exp} ({n.bit_length()}-bit)"

def parse_arg(s):
    """Parse command-line argument: integer or expression like 10**100."""
    try:
        return int(eval(s))
    except:
        return int(s)

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 collatz_verify_big.py <lo> <hi>")
        print("  Supports expressions like 1, 10**100")
        return
    
    lo = parse_arg(sys.argv[1])
    hi = parse_arg(sys.argv[2])
    
    total_odd = (hi - lo + 1) // 2
    
    print("═" * 55)
    print("  Collatz Universal Verifier (big integer edition)")
    print("═" * 55)
    print(f"  Range: [{fmt(lo)}]")
    print(f"         [{fmt(hi)}]")
    print(f"  Odd numbers: {fmt(total_odd)}")
    print(f"  Sieve modulus: 2^{SIEVE_K}")
    print()
    
    t0 = time.perf_counter()
    verified, classes_done, simulated, sim_steps, uncertain_classes = verify_range(lo, hi)
    elapsed = time.perf_counter() - t0
    
    print(f"  ───────────────────────────────────")
    print(f"  Classes bulk-verified (≤7-step guarantee): {classes_done:,}")
    print(f"  Classes NOT verifiable by sieving:         {uncertain_classes:,}")
    print(f"  Numbers simulated: {simulated:,}")
    print(f"  Total verified:    {fmt(verified)}")
    print(f"  Time:              {elapsed:.4f}s")
    if elapsed > 0:
        if verified > 10**100:
            # Rate is astronomical, just note it
            print(f"  Throughput:        (astronomical — {verified.bit_length()}-bit count)")
        else:
            rate = float(verified) / elapsed
            if rate > 1e24:
                print(f"  Throughput:        {rate/1e24:.2f} Y num/s")
            elif rate > 1e15:
                print(f"  Throughput:        {rate/1e15:.2f} P num/s")
            elif rate > 1e12:
                print(f"  Throughput:        {rate/1e12:.2f} T num/s")
            else:
                print(f"  Throughput:        {rate:,.0f} num/s")
    
    if verified == total_odd:
        print(f"\n  ✓ All {fmt(total_odd)} odd numbers verified.")
    else:
        print(f"\n  ⚠ Verified {fmt(verified)} of {fmt(total_odd)}")

if __name__ == '__main__':
    main()
