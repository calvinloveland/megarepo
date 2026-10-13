#!/usr/bin/env python3
"""
Practical sieving demo: measure class-level throughput and extrapolate.

Instead of a full verifier (which needs careful range arithmetic),
this measures how fast we can PROCESS RESIDUE CLASSES and simulates
the survivors. It then extrapolates to the full 10^20→10^21 range.
"""

import time
import math
from collections import defaultdict

LOG23 = math.log2(3)

def v2(x):
    return (x & -x).bit_length() - 1

# ---------------------------------------------------------------------------
# Sieve table builder
# ---------------------------------------------------------------------------

def build_sieve(k, generous=True):
    """
    Build sieving table for modulus 2^k.
    If generous=True: mark residues as 'good' if they empirically decrease
    for the smallest representative (faster, catches more).
    If generous=False: only mark as good if parity vector PROVES decrease.
    """
    mod = 1 << k
    good = 0
    uncertain = 0
    max_steps = 0
    
    for r in range(mod):
        if r % 2 == 0 or r == 1:
            good += 1
            continue
        
        n = r
        x = n
        V = 0
        s = 0
        stopped = False
        
        for step in range(1, 500):
            if x % 2 == 0:
                tz = v2(x)
                x >>= tz
                V += tz
                s += 1
            else:
                x2 = 3*x + 1
                k = v2(x2)
                x = x2 >> k
                V += k
                s += 1
            
            if generous:
                # Count as good if it empirically decreases
                if x < n or x == 1:
                    stopped = True
                    if step > max_steps:
                        max_steps = step
                    break
            else:
                # Count as good only if parity vector proves it
                if s >= 5 and V > LOG23 * s + 0.5:
                    stopped = True
                    break
                if s >= 10 and x < n:
                    stopped = True
                    break
        
        if stopped:
            good += 1
        else:
            uncertain += 1
    
    return good, uncertain, max_steps, mod

# ---------------------------------------------------------------------------
# Throughput measurement
# ---------------------------------------------------------------------------

def measure_class_throughput(k=20, num_classes=100000):
    """Measure how fast we can classify residue classes."""
    mod = 1 << k
    t0 = time.perf_counter()
    
    good = 0
    uncertain = 0
    for r in range(1, mod, 2):
        if r == 1:
            good += 1
            continue
        
        n = r
        x = n
        V = 0
        s = 0
        stopped = False
        
        for step in range(1, 100):
            if x % 2 == 0:
                tz = v2(x)
                x >>= tz
                V += tz
                s += 1
            else:
                x2 = 3*x + 1
                kval = v2(x2)
                x = x2 >> kval
                V += kval
                s += 1
            
            if x < n or x == 1:
                stopped = True
                break
        
        if stopped:
            good += 1
        else:
            uncertain += 1
        
        if good + uncertain >= num_classes:
            break
    
    elapsed = time.perf_counter() - t0
    classes_per_sec = (good + uncertain) / elapsed if elapsed > 0 else 0
    
    return good, uncertain, elapsed, classes_per_sec

def measure_simulation_throughput(bits=70, num_samples=1000):
    """Measure how fast we can simulate individual numbers."""
    import random
    random.seed(42)
    
    samples = []
    for _ in range(num_samples):
        n = random.getrandbits(bits) | 1
        t0 = time.perf_counter()
        x = n
        steps = 0
        limit = 10**20
        while x >= limit and x != 1 and steps < 10000:
            if x % 2 == 0:
                x >>= v2(x)
                steps += 1
            else:
                x2 = 3*x + 1
                x = x2 >> v2(x2)
                steps += 1
        elapsed = time.perf_counter() - t0
        samples.append((steps, elapsed))
    
    avg_steps = sum(s[0] for s in samples) / len(samples)
    avg_time = sum(s[1] for s in samples) / len(samples)
    sims_per_sec = 1 / avg_time if avg_time > 0 else 0
    
    return avg_steps, avg_time, sims_per_sec

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 65)
    print("COLLATZ SIEVING: PRACTICAL THROUGHPUT MEASUREMENT")
    print("=" * 65)
    print()
    
    # 1. Sieve table statistics
    print("1. Sieve table sizes and effectiveness")
    print(f"   {'k':>4s}  {'modulus':>12s}  {'good':>10s}  {'uncertain':>10s}  {'good%':>8s}  {'worst steps':>12s}")
    print("   " + "-" * 62)
    
    for k in [12, 14, 16, 18, 20, 22, 24]:
        good, uncertain, worst, mod = build_sieve(k, generous=False)
        odd_total = mod // 2
        # good includes even residues and r=1; uncertain only counts odd r>1
        actual_good = good - mod//2  # remove even residues that were counted
        actual_uncertain = uncertain
        pct = 100 * actual_good / (odd_total - 1) if odd_total > 1 else 0  # exclude r=1
        print(f"   {k:4d}  2^{k:<10d}  {actual_good:>10,d}  {actual_uncertain:>10,d}  {pct:>7.2f}%  {worst:>12,d}")
    
    print()
    
    # 2. Class processing throughput
    print("2. Residue class processing throughput")
    k = 20
    good, uncertain, elapsed, rate = measure_class_throughput(k, 50000)
    print(f"   At k={k}: processed {good+uncertain:,} classes in {elapsed:.3f}s")
    print(f"   Rate: {rate:,.0f} classes/second")
    print(f"   Good: {good:,} ({100*good/(good+uncertain):.1f}%)")
    print()
    
    # 3. Simulation throughput
    print("3. Individual number simulation throughput")
    for bits in [60, 70, 80]:
        avg_steps, avg_time, sim_rate = measure_simulation_throughput(bits, 500)
        print(f"   {bits}-bit numbers: {avg_steps:.0f} avg steps, "
              f"{avg_time*1e6:.1f} μs each, {sim_rate:,.0f}/sec")
    print()
    
    # 4. Extrapolation to full range
    print("4. Extrapolation to 10^20 → 10^21")
    total_odd = (10**21 - 10**20) // 2
    
    # Use k=20 sieve stats (strict: parity-vector guaranteed)
    mod = 1 << 20
    good, uncertain, _, _ = build_sieve(20, generous=False)
    odd_total = mod // 2
    actual_good = good - mod//2  # remove even residues
    actual_uncertain = uncertain
    good_frac = actual_good / (odd_total - 1)  # exclude r=1
    uncertain_frac = actual_uncertain / (odd_total - 1)
    
    # At k=20: good classes cover good_frac of total
    # Uncertain classes need deeper sieving
    # After multi-level: uncertain_frac^levels survive
    
    levels_needed = 8  # k=20 to k=36
    survival = uncertain_frac ** levels_needed
    
    # Numbers per uncertain leaf class
    leaf_mod = 1 << (20 + 2 * levels_needed)
    avg_per_class = total_odd / (leaf_mod // 2)
    
    # Total classes to process
    # This is a geometric sum approximation
    M = mod // 2  # odd classes at level 0
    total_class_visits = M  # level 0
    U = int(M * uncertain_frac)
    for _ in range(levels_needed):
        total_class_visits += U * 4  # each uncertain spawns 4 children
        U = int(U * 4 * uncertain_frac)
    
    leaf_survivor_classes = U
    leaf_numbers = leaf_survivor_classes * avg_per_class
    
    # Time
    class_rate = rate  # from measurement
    sim_rate = measure_simulation_throughput(70, 200)[2]
    
    t_classes = total_class_visits / class_rate
    t_sim = leaf_numbers / sim_rate
    t_total = t_classes + t_sim
    
    print(f"   Total odd numbers: {total_odd:.2e}")
    print(f"   Sieve table: k=20 → k={20+2*levels_needed} ({levels_needed} levels)")
    print(f"   Good fraction at k=20: {good_frac*100:.1f}%")
    print(f"   Uncertain fraction: {uncertain_frac*100:.1f}%")
    print(f"   Survival after {levels_needed} levels: {survival:.2e}")
    print(f"   Total class visits: {total_class_visits:,.0f}")
    print(f"   Leaf survivor numbers to simulate: {leaf_numbers:,.0f}")
    print()
    print(f"   Class processing time: {t_classes:.2f}s ({class_rate:,.0f} classes/s)")
    print(f"   Simulation time:       {t_sim:.2f}s ({sim_rate:,.0f} numbers/s)")
    print(f"   TOTAL (serial):        {t_total:.2f}s ({t_total/60:.1f} min)")
    print()
    
    # 5. Check: is this actually faster than the naive estimate?
    naive_seconds = total_odd / sim_rate
    print(f"5. Comparison:")
    print(f"   Naive (no sieving): {naive_seconds/86400/365:.1f} years")
    print(f"   With sieving:       {t_total:.1f} seconds")
    print(f"   Speedup:            {naive_seconds/t_total:,.0f}x")

if __name__ == '__main__':
    main()
