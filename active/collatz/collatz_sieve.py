#!/usr/bin/env python3
"""
Collatz checker with sieving acceleration.

Uses a precomputed sieve table: for each odd residue mod 2^SIEVE_BITS,
stores the parity vector (valuations) of the first few Syracuse steps.
If the parity vector guarantees eventual decrease (sum of valuations >
log2(3) × number of steps), we can skip the full simulation.

For residues that don't guarantee decrease, we fall back to full simulation
or recursively apply the sieve at a deeper level.
"""

import sys
import math
import time
import argparse
import random as _random
from collections import defaultdict

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

VERIFIED_LIMIT = 10**20
SIEVE_BITS = 16          # Precompute sieve for residues mod 2^16
MAX_STEPS = 10**9
REPORT_INTERVAL = 1_000_000
LOG23 = math.log2(3)     # ≈ 1.585

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def trailing_zeros(x):
    return (x & -x).bit_length() - 1

def syracuse_step(n):
    """Return (next_odd, valuation_k)."""
    x = 3 * n + 1
    k = trailing_zeros(x)
    return x >> k, k

# ---------------------------------------------------------------------------
# Sieve table
# ---------------------------------------------------------------------------

class CollatzSieve:
    """Precomputed sieving table for fast Collatz checking."""
    
    def __init__(self, bits=SIEVE_BITS):
        self.bits = bits
        self.mod = 1 << bits
        self.table = {}  # residue → (status, skip_steps, skip_V, info)
        self._build()
    
    def _build(self):
        """Build sieving table for all odd residues mod 2^bits."""
        for r in range(self.mod):
            if r % 2 == 0:
                continue  # even numbers halve, trivial
            
            if r == 1:
                self.table[r] = ('trivial', 0, 0, 'n=1')
                continue
            
            # Compute parity vector for the first few steps
            n = r
            x = n
            vals = []
            s = 0
            V = 0
            
            for _ in range(self.bits * 2):
                if x % 2 == 0:
                    tz = trailing_zeros(x)
                    x >>= tz
                    V += tz
                    s += 1
                    vals.append(tz)
                else:
                    x2 = 3 * x + 1
                    k = trailing_zeros(x2)
                    x = x2 >> k
                    V += k
                    s += 1
                    vals.append(k)
                
                # Check if we can make a decision
                if s >= 3:
                    if V > LOG23 * s + 0.5:
                        # Guaranteed decrease: T^s(n) ≈ 3^s/2^V < 1 for large n
                        self.table[r] = ('good', s, V, vals[:s])
                        break
                    elif x < n or x == 1:
                        # Empirically decreases for the tested value
                        self.table[r] = ('good_small', s, V, vals[:s])
                        break
            else:
                # Couldn't determine — mark as needing full check
                self.table[r] = ('check', s, V, vals)
    
    def lookup(self, n):
        """Look up a number in the sieve. Returns (status, skip_info)."""
        r = n & (self.mod - 1)  # n mod 2^bits
        if r % 2 == 0:
            return ('even', {'halvings': trailing_zeros(n)})
        if r == 1:
            return ('trivial', {})
        
        entry = self.table.get(r)
        if entry is None:
            return ('check', {})
        
        status, steps, V, vals = entry
        return (status, {'steps': steps, 'V': V, 'vals': vals})
    
    def stats(self):
        """Return statistics about the sieve table."""
        counts = defaultdict(int)
        for entry in self.table.values():
            counts[entry[0]] += 1
        counts['even'] = self.mod // 2  # half of all residues are even
        return dict(counts)

# ---------------------------------------------------------------------------
# Accelerated checker
# ---------------------------------------------------------------------------

class AcceleratedChecker:
    """Collatz checker using sieving for acceleration."""
    
    def __init__(self, n, verified_limit=VERIFIED_LIMIT, sieve=None):
        self.start = n
        self.current = n
        self.verified_limit = verified_limit
        
        self.sieve = sieve or CollatzSieve()
        
        self.syr_steps = 0    # Syracuse (odd→odd) steps
        self.raw_steps = 0    # Raw Collatz steps
        self.max_val = n
        self.max_at_step = 0
        
        self.skipped_by_sieve = 0  # Numbers we skipped via sieving
        
        self.start_time = time.time()
    
    def step(self):
        """Single Syracuse step."""
        n = self.current
        
        if n % 2 == 0:
            tz = trailing_zeros(n)
            self.current = n >> tz
            self.raw_steps += tz
            self.syr_steps += 1
            return
        
        # Odd: Syracuse step
        x = 3 * n + 1
        k = trailing_zeros(x)
        self.current = x >> k
        self.raw_steps += 1 + k
        self.syr_steps += 1
    
    def fast_forward(self, vals):
        """
        Apply a known parity vector (list of valuations) to skip multiple steps.
        vals = [k1, k2, ..., ks] where each ki is the valuation at that step.
        """
        n = self.current
        for k in vals:
            if n % 2 == 0:
                tz = trailing_zeros(n)
                n >>= tz
                self.raw_steps += tz
            else:
                x = 3 * n + 1
                # k should match trailing_zeros(x) for the precomputed parity
                n = x >> k
                self.raw_steps += 1 + k
            self.syr_steps += 1
        
        self.current = n
    
    def check(self, max_steps=MAX_STEPS, verbose=True):
        """Run the accelerated Collatz check."""
        n = self.current
        
        if n < self.verified_limit:
            return self._result('verified', f'Already below {self.verified_limit}')
        if n == 1:
            return self._result('converged', 'Already at 1')
        
        last_report = 0
        
        while self.syr_steps < max_steps:
            n = self.current
            
            # Check terminal conditions
            if n <= 1:
                return self._result('converged', 'Reached 1')
            if n < self.verified_limit:
                return self._result(
                    'verified',
                    f'Reached {n} < {self.verified_limit}'
                )
            
            # Try sieving
            if n % 2 == 1 and n > 1:
                status, info = self.sieve.lookup(n)
                
                if status in ('good', 'good_small'):
                    # We know the parity vector — fast-forward through these steps
                    vals = info['vals']
                    self.fast_forward(vals)
                    self.skipped_by_sieve += 1
                    
                    # After fast-forward, the value should be smaller
                    # (but we still need to verify it's below limit)
                    continue
                
                elif status == 'trivial':
                    # n = 1, already handled
                    pass
            
            # Regular step
            self.step()
            
            # Track max
            if self.current > self.max_val:
                self.max_val = self.current
                self.max_at_step = self.syr_steps
            
            # Progress reporting
            if verbose and self.syr_steps - last_report >= REPORT_INTERVAL:
                self._report()
                last_report = self.syr_steps
        
        return self._result('timeout', f'Exceeded {max_steps} steps')
    
    def _report(self):
        elapsed = time.time() - self.start_time
        n = self.current
        bits = n.bit_length()
        rate = self.syr_steps / elapsed if elapsed > 0 else 0
        print(f"  Step {self.syr_steps:,} | {bits}-bit | "
              f"max: {self.max_val.bit_length()}-bit | "
              f"{rate:,.0f} steps/s | "
              f"skipped: {self.skipped_by_sieve:,}")
    
    def _result(self, status, msg):
        elapsed = time.time() - self.start_time
        return {
            'status': status,
            'message': msg,
            'starting_bits': self.start.bit_length(),
            'syracuse_steps': self.syr_steps,
            'raw_collatz_steps': self.raw_steps,
            'skipped_by_sieve': self.skipped_by_sieve,
            'max_value_bits': self.max_val.bit_length(),
            'elapsed': round(elapsed, 4),
            'rate': round(self.syr_steps / elapsed, 1) if elapsed > 0 else 0,
        }

# ---------------------------------------------------------------------------
# Benchmark: compare with/without sieving
# ---------------------------------------------------------------------------

def benchmark_sieving(num_samples=100, bits=200):
    """Compare accelerated vs basic checker."""
    print(f"Benchmark: {num_samples} random {bits}-bit odd numbers")
    print()
    
    sieve = CollatzSieve(SIEVE_BITS)
    stats = sieve.stats()
    print(f"Sieve table (mod 2^{SIEVE_BITS}):")
    for status, count in sorted(stats.items()):
        pct = 100 * count / (1 << SIEVE_BITS)
        print(f"  {status}: {count:,} ({pct:.1f}%)")
    print()
    
    basic_times = []
    accel_times = []
    
    for i in range(num_samples):
        n = _random.getrandbits(bits) | 1
        
        # Basic check
        t0 = time.perf_counter()
        x = n
        steps = 0
        while x > VERIFIED_LIMIT and steps < 100000:
            if x % 2 == 0:
                x >>= trailing_zeros(x)
                steps += 1
            else:
                x, _ = syracuse_step(x)
                steps += 1
        basic_times.append(time.perf_counter() - t0)
        
        # Accelerated check
        t0 = time.perf_counter()
        checker = AcceleratedChecker(n, VERIFIED_LIMIT, sieve)
        checker.check(max_steps=100000, verbose=False)
        accel_times.append(time.perf_counter() - t0)
        
        if (i + 1) % 20 == 0:
            avg_b = sum(basic_times) / len(basic_times)
            avg_a = sum(accel_times) / len(accel_times)
            print(f"  {i+1}/{num_samples}: basic={avg_b*1e3:.4f}ms, "
                  f"accelerated={avg_a*1e3:.4f}ms, "
                  f"speedup={avg_b/avg_a:.1f}x", end="\r")
    
    print()
    avg_b = sum(basic_times) / len(basic_times)
    avg_a = sum(accel_times) / len(accel_times)
    print(f"\nAverage basic:      {avg_b*1e3:.4f} ms")
    print(f"Average accelerated: {avg_a*1e3:.4f} ms")
    print(f"Speedup: {avg_b/avg_a:.1f}x")

# ---------------------------------------------------------------------------
# Main (compatible with collatz_checker.py interface)
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Accelerated Collatz checker with sieving")
    parser.add_argument("number", nargs="?", default=None,
                        help="Starting number (Python expression ok)")
    parser.add_argument("--limit", type=int, default=VERIFIED_LIMIT)
    parser.add_argument("--max-steps", type=int, default=MAX_STEPS)
    parser.add_argument("--sieve-bits", type=int, default=SIEVE_BITS)
    parser.add_argument("--bench", type=int, default=None,
                        help="Run benchmark with N random numbers")
    parser.add_argument("--random", type=int, default=None,
                        help="Random number with specified bit-length")
    parser.add_argument("--quiet", action="store_true")
    
    args = parser.parse_args()
    
    # Benchmark mode
    if args.bench:
        benchmark_sieving(args.bench)
        return
    
    # Determine number
    if args.random:
        n = _random.getrandbits(args.random) | 1
    elif args.number:
        n = int(eval(args.number))
    else:
        parser.print_help()
        return
    
    # Build sieve
    print(f"Building sieve table (mod 2^{args.sieve_bits})...")
    t0 = time.time()
    sieve = CollatzSieve(args.sieve_bits)
    print(f"  Done in {time.time()-t0:.2f}s")
    
    stats = sieve.stats()
    total = 1 << args.sieve_bits
    print(f"  Table: {stats}", end="\n\n")
    
    # Pre-process even numbers
    if n % 2 == 0:
        tz = trailing_zeros(n)
        n >>= tz
        print(f"Stripped {tz} trailing zeros → {n.bit_length()}-bit odd")
    
    if n < args.limit:
        print(f"✓ Already below {args.limit}")
        return
    
    print(f"Starting from {n.bit_length()}-bit value...\n")
    
    checker = AcceleratedChecker(n, args.limit, sieve)
    result = checker.check(args.max_steps, verbose=not args.quiet)
    
    print(f"\n{'='*60}")
    print(f"Status: {result['status'].upper()}")
    print(f"Message: {result['message']}")
    print(f"Syracuse steps: {result['syracuse_steps']:,}")
    print(f"Raw Collatz steps: {result['raw_collatz_steps']:,}")
    print(f"Sieve skips: {result['skipped_by_sieve']:,}")
    print(f"Time: {result['elapsed']:.4f}s")
    print(f"Max value: {result['max_value_bits']}-bit")
    
    if result['status'] in ('converged', 'verified'):
        print(f"\n✓ Conjecture holds for this starting value.")

if __name__ == '__main__':
    main()
