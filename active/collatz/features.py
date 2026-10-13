#!/usr/bin/env python3
"""
Phase 2: Ground Truth Dataset Generator

For every integer in the reverse graph, compute:
- total stopping time (Syracuse steps to 1)
- accelerated stopping time
- stopping time / log2(n)
- maximum excursion and ratio
- Hamming weight and bit density
- longest run of ones
- longest carry chain in 3n+1
- v2(3n+1) sequence statistics
- Binary pattern features
"""

import math
import time
from collections import Counter, defaultdict
from reverse_graph import ReverseCollatzGraph
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Feature extractors
# ---------------------------------------------------------------------------

def v2(x: int) -> int:
    return (x & -x).bit_length() - 1

def hamming_weight(x: int) -> int:
    return x.bit_count()

def longest_run_of_ones(x: int) -> int:
    """Longest consecutive run of 1 bits."""
    binary = bin(x)[2:]
    max_run = 0
    current = 0
    for b in binary:
        if b == '1':
            current += 1
            max_run = max(max_run, current)
        else:
            current = 0
    return max_run

def longest_carry_chain(n: int) -> int:
    """
    Longest consecutive carry propagation in n + (n<<1) + 1.
    Simulates the carry automaton and finds the longest run of carry=1.
    """
    max_chain = 0
    current_chain = 0
    carry = 1  # from +1
    
    for i in range(n.bit_length() + 5):
        b_i = (n >> i) & 1
        b_prev = (n >> (i-1)) & 1 if i > 0 else 0
        total = b_i + b_prev + carry
        carry = total >> 1
        
        if carry == 1:
            current_chain += 1
            max_chain = max(max_chain, current_chain)
        else:
            current_chain = 0
    
    return max_chain

def carry_chain_stats(n: int) -> dict:
    """Detailed carry chain statistics for n + (n<<1) + 1."""
    chains = []
    current = 0
    carry = 1
    
    for i in range(n.bit_length() + 5):
        b_i = (n >> i) & 1
        b_prev = (n >> (i-1)) & 1 if i > 0 else 0
        total = b_i + b_prev + carry
        carry = total >> 1
        
        if carry == 1:
            current += 1
        elif current > 0:
            chains.append(current)
            current = 0
    
    if current > 0:
        chains.append(current)
    
    return {
        'longest_carry_chain': max(chains) if chains else 0,
        'num_carry_chains': len(chains),
        'mean_carry_chain': sum(chains) / len(chains) if chains else 0,
        'total_carry_length': sum(chains),
    }

def syracuse_step(n: int) -> Tuple[int, int]:
    x = 3*n + 1
    k = v2(x)
    return x >> k, k

def total_stopping_time(n: int, max_steps: int = 500000) -> int:
    """Syracuse steps to reach 1."""
    x = n
    for s in range(1, max_steps + 1):
        if x == 1: return s
        if x % 2 == 0: x >>= v2(x)
        else: x, _ = syracuse_step(x)
    return -1

def stopping_time(n: int, max_steps: int = 500000) -> int:
    """Syracuse steps to drop below n."""
    x = n
    for s in range(1, max_steps + 1):
        if x < n or x == 1: return s
        if x % 2 == 0: x >>= v2(x)
        else: x, _ = syracuse_step(x)
    return -1

def max_excursion(n: int) -> Tuple[int, float]:
    """Maximum value reached in the trajectory, and ratio to n."""
    x = n
    max_val = n
    steps = 0
    while x != 1 and steps < 500000:
        if x > max_val: max_val = x
        if x % 2 == 0: x >>= v2(x)
        else: x, _ = syracuse_step(x)
        steps += 1
    return max_val, max_val / n

def trajectory_stats(n: int) -> dict:
    """
    Compute all trajectory statistics for a number n.
    This is the main feature extraction function.
    """
    # Basic properties
    bits = n.bit_length()
    hw = hamming_weight(n)
    
    # Stopping times
    total = total_stopping_time(n)
    stop = stopping_time(n)
    total_density = total / bits if bits > 0 else 0
    
    # Max excursion
    max_val, max_ratio = max_excursion(n)
    max_bits = max_val.bit_length()
    
    # Binary features
    run1 = longest_run_of_ones(n)
    density = hw / bits if bits > 0 else 0
    
    # Carry features
    carry = carry_chain_stats(n)
    v2_val = v2(3*n + 1)
    
    # Residue features
    mod2 = n % 2
    mod4 = n % 4
    mod8 = n % 8
    mod16 = n % 16
    
    # v2 sequence for first few steps (the parity vector prefix)
    v2_seq = []
    x = n
    for _ in range(min(20, total if total > 0 else 20)):
        if x == 1: break
        if x % 2 == 0:
            k = v2(x)
            v2_seq.append(k)
            x >>= k
        else:
            _, k = syracuse_step(x)
            v2_seq.append(k)
            x = x >> k
    
    # v2 sequence statistics
    if v2_seq:
        v2_counts = Counter(v2_seq)
        v2_expanding = v2_counts.get(1, 0)  # k=1 steps (expanding)
        v2_contracting = sum(c for k, c in v2_counts.items() if k >= 2)
    else:
        v2_expanding = 0
        v2_contracting = 0
    
    return {
        # Identifiers
        'n': n,
        'bits': bits,
        
        # Stopping times
        'total_stopping_time': total,
        'stopping_time': stop,
        'total_stopping_density': total_density,
        
        # Excursion
        'max_excursion': max_val,
        'max_excursion_bits': max_bits,
        'max_excursion_ratio': max_ratio,
        'excursion_bit_increase': max_bits - bits,
        
        # Binary features
        'hamming_weight': hw,
        'bit_density': density,
        'longest_run_ones': run1,
        
        # Carry features
        'longest_carry_chain': carry['longest_carry_chain'],
        'num_carry_chains': carry['num_carry_chains'],
        'mean_carry_chain': carry['mean_carry_chain'],
        'total_carry_length': carry['total_carry_length'],
        'v2_first_step': v2_val,
        
        # Residue features
        'mod4': mod4,
        'mod8': mod8,
        'mod16': mod16,
        
        # Parity vector features (first 20 steps)
        'v2_expanding_count': v2_expanding,
        'v2_contracting_count': v2_contracting,
        'v2_seq': v2_seq,
    }

# ---------------------------------------------------------------------------
# Dataset builder
# ---------------------------------------------------------------------------

class CollatzDataset:
    """Collects features for all nodes in the reverse graph."""
    
    def __init__(self, graph: ReverseCollatzGraph):
        self.graph = graph
        self.features: List[dict] = []
        self._extracted = set()
    
    def extract_all(self, max_nodes: int = None, report_interval: int = 10000):
        """Extract features for all (or up to max_nodes) graph nodes."""
        nodes = list(self.graph.nodes.items())
        if max_nodes:
            nodes = nodes[:max_nodes]
        
        print(f"Extracting features for {len(nodes):,} nodes...")
        t0 = time.time()
        
        for i, (value, meta) in enumerate(nodes):
            if value in self._extracted:
                continue
            
            try:
                feats = trajectory_stats(value)
                feats['graph_depth'] = meta['depth']
                feats['reverse_k'] = meta['reverse_k']
                feats['parent'] = meta['parent']
                self.features.append(feats)
                self._extracted.add(value)
            except Exception as e:
                continue  # Skip problematic numbers
            
            if (i + 1) % report_interval == 0:
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                print(f"  {i+1:,}/{len(nodes):,} features ({rate:,.0f}/s)", end='\r')
        
        elapsed = time.time() - t0
        print(f"\n  Done: {len(self.features):,} features in {elapsed:.1f}s")
    
    def to_dict_list(self) -> List[dict]:
        """Return features as list of dicts (for pandas/ML)."""
        return [{k: v for k, v in f.items() if k != 'v2_seq'} 
                for f in self.features]
    
    def stats(self):
        """Print summary statistics."""
        if not self.features:
            print("No features extracted yet.")
            return
        
        keys = ['total_stopping_time', 'total_stopping_density', 'bit_density',
                'longest_carry_chain', 'v2_expanding_count', 'max_excursion_ratio',
                'longest_run_ones', 'mean_carry_chain']
        
        print("\nDataset statistics:")
        print(f"  Samples: {len(self.features):,}")
        print(f"  {'feature':>30s}  {'min':>10s}  {'max':>10s}  {'mean':>10s}  {'std':>10s}")
        print("  " + "-" * 75)
        
        for key in keys:
            vals = [f[key] for f in self.features if key in f]
            if vals:
                import statistics
                mean = statistics.mean(vals)
                std = statistics.stdev(vals) if len(vals) > 1 else 0
                print(f"  {key:>30s}  {min(vals):>10.4f}  {max(vals):>10.4f}  {mean:>10.4f}  {std:>10.4f}")


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("Phase 2: Building ground truth dataset")
    print("=" * 60)
    print()
    
    # Generate graph
    graph = ReverseCollatzGraph(max_nodes=50000)
    graph.expand_all()
    
    # Extract features
    dataset = CollatzDataset(graph)
    dataset.extract_all()
    dataset.stats()
    
    # Find record-holders (longest stopping time per bit-length)
    print("\n" + "=" * 60)
    print("Record holders (longest total stopping time):")
    print(f"  {'n':>15s}  {'bits':>6s}  {'total':>8s}  {'density':>10s}  {'max rise':>10s}")
    print("  " + "-" * 55)
    
    by_bits = defaultdict(list)
    for f in dataset.features:
        by_bits[f['bits']].append(f)
    
    for bits in sorted(by_bits.keys())[:15]:
        best = max(by_bits[bits], key=lambda f: f['total_stopping_time'])
        print(f"  {best['n']:>15,d}  {bits:>6d}  {best['total_stopping_time']:>8d}  "
              f"{best['total_stopping_density']:>10.4f}  {best['excursion_bit_increase']:>10d}")
