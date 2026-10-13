#!/usr/bin/env python3
"""
Phase 1: Reverse Collatz Graph Generator

The reverse Collatz graph: for each odd n, predecessors are:
  m = 2n  (always valid)
  m = (2^k * n - 1) / 3  when this is an odd integer > 0

We start from 1 and expand outward, generating nodes in breadth-first
order (by graph depth from 1).

Key design:
- Lazy generation with configurable expansion limits
- Deduplication via hash set
- Rich node metadata tracking
- Support for millions of nodes
"""

import math
from collections import defaultdict, deque
from typing import Iterator, Dict, List, Tuple, Optional, Set
import time

class ReverseCollatzGraph:
    """
    Generates and manages the reverse Collatz graph.
    
    The graph expands from 1 outward. Each node n has reverse predecessors:
      - n → 2n (always)
      - n → (2^k * n - 1) / 3 when this produces an odd integer > 0
    
    The graph depth is the minimum number of reverse steps from 1.
    """
    
    def __init__(self, max_nodes: int = 1_000_000, max_depth: int = 100):
        self.max_nodes = max_nodes
        self.max_depth = max_depth
        
        # Node storage: node_id → {value, depth, parent, reverse_k, ...}
        self.nodes: Dict[int, dict] = {}
        
        # Quick lookup for deduplication
        self.seen: Set[int] = set()
        
        # BFS queue
        self.queue: deque = deque()
        
        # Statistics
        self.total_generated = 0
        self.duplicates_skipped = 0
        
        # Initialize with root
        self._add_node(1, depth=0, parent=None, reverse_k=None)
    
    def _add_node(self, value: int, depth: int, parent: Optional[int], 
                  reverse_k: Optional[int]) -> bool:
        """Add a node if not already seen. Returns True if added."""
        if value in self.seen:
            self.duplicates_skipped += 1
            return False
        
        if len(self.nodes) >= self.max_nodes:
            return False
        
        self.seen.add(value)
        self.nodes[value] = {
            'value': value,
            'depth': depth,
            'parent': parent,
            'reverse_k': reverse_k,
            'bit_length': value.bit_length(),
        }
        self.queue.append((value, depth))
        self.total_generated += 1
        return True
    
    def _reverse_predecessors(self, n: int) -> List[Tuple[int, int]]:
        """
        Generate all reverse predecessors of n.
        Returns list of (predecessor_value, k) where k is the reverse exponent.
        
        Predecessors:
          1. m = 2n (always, k=0 for the doubling step)
          2. m = (2^k * n - 1) / 3 for k >= 1 where the division is exact
             and m is odd and positive.
        """
        preds = []
        
        # Type 1: simple doubling
        preds.append((2 * n, 0))
        
        # Type 2: (2^k * n - 1) / 3
        # For this to be an integer: 2^k * n ≡ 1 (mod 3)
        # Since 2 ≡ -1 (mod 3): (-1)^k * n ≡ 1 (mod 3)
        # If n ≡ 1 (mod 3): need k even
        # If n ≡ 2 (mod 3): need k odd
        # If n ≡ 0 (mod 3): impossible
        
        n_mod3 = n % 3
        if n_mod3 == 0:
            return preds  # No type-2 predecessors
        
        # Determine parity of k needed
        if n_mod3 == 1:
            k_parity = 0  # k must be even
        else:  # n_mod3 == 2
            k_parity = 1  # k must be odd
        
        # Try increasing k values
        # k starts at 1 (or 2 if even needed)
        k = 1 if k_parity == 1 else 2
        pow2 = 1 << k
        
        # Limit: we don't want predecessors to explode too much
        # A reasonable bound: k up to ~6 to keep numbers manageable
        max_k = 20
        
        while k <= max_k:
            num = pow2 * n - 1
            if num % 3 == 0:
                m = num // 3
                if m > 0 and m % 2 == 1:  # Must be odd positive
                    preds.append((m, k))
            k += 2  # Same parity
            pow2 = 1 << k
        
        return preds
    
    def expand(self, num_steps: int = 1000) -> int:
        """
        Expand the graph by processing num_steps nodes from the BFS queue.
        Returns number of new nodes added.
        """
        added = 0
        for _ in range(num_steps):
            if not self.queue:
                break
            
            n, depth = self.queue.popleft()
            
            if depth >= self.max_depth:
                continue
            
            for pred, k in self._reverse_predecessors(n):
                if self._add_node(pred, depth + 1, n, k):
                    added += 1
                
                if len(self.nodes) >= self.max_nodes:
                    break
            
            if len(self.nodes) >= self.max_nodes:
                break
        
        return added
    
    def expand_all(self, report_interval: int = 100000):
        """Expand until max_nodes is reached. Reports progress."""
        print(f"Expanding reverse Collatz graph (max {self.max_nodes:,} nodes)...")
        t0 = time.time()
        
        while len(self.nodes) < self.max_nodes:
            added = self.expand(10000)
            if added == 0:
                break
            
            if len(self.nodes) % report_interval < 10000:
                elapsed = time.time() - t0
                rate = len(self.nodes) / elapsed if elapsed > 0 else 0
                print(f"  Nodes: {len(self.nodes):,} | "
                      f"Depth: {max(n['depth'] for n in self.nodes.values())} | "
                      f"Rate: {rate:,.0f} nodes/s | "
                      f"Duplicates: {self.duplicates_skipped:,}")
        
        elapsed = time.time() - t0
        print(f"\nExpansion complete: {len(self.nodes):,} nodes in {elapsed:.1f}s")
        print(f"  Duplicates skipped: {self.duplicates_skipped:,}")
        print(f"  Max depth: {max(n['depth'] for n in self.nodes.values())}")
        
        self._print_stats()
    
    def _print_stats(self):
        """Print graph statistics."""
        depths = [n['depth'] for n in self.nodes.values()]
        from collections import Counter
        depth_counts = Counter(depths)
        
        print(f"\n  Depth distribution (top 10):")
        for depth in sorted(depth_counts.keys())[:10]:
            count = depth_counts[depth]
            print(f"    depth {depth:3d}: {count:>10,d} nodes")
        
        # How many type-1 vs type-2 edges?
        type1 = sum(1 for n in self.nodes.values() if n['reverse_k'] == 0)
        type2 = sum(1 for n in self.nodes.values() if n['reverse_k'] and n['reverse_k'] > 0)
        print(f"\n  Edge types:")
        print(f"    Type 1 (×2):  {type1:,}")
        print(f"    Type 2 (3x+1): {type2:,}")
    
    def get_node(self, value: int) -> Optional[dict]:
        """Get node metadata by value."""
        return self.nodes.get(value)
    
    def get_nodes_at_depth(self, depth: int) -> List[int]:
        """Get all node values at a given depth."""
        return [v for v, n in self.nodes.items() if n['depth'] == depth]
    
    def get_path_to_root(self, value: int) -> List[int]:
        """Trace a node's path back to 1 through the graph."""
        path = []
        curr = value
        while curr is not None:
            path.append(curr)
            node = self.nodes.get(curr)
            curr = node['parent'] if node else None
        return path
    
    def __len__(self):
        return len(self.nodes)
    
    def __iter__(self):
        return iter(self.nodes.items())


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    graph = ReverseCollatzGraph(max_nodes=200000)
    graph.expand_all(report_interval=50000)
    
    # Show some interesting nodes
    print("\n" + "=" * 60)
    print("Sample reverse paths:")
    
    for target in [27, 31, 41, 703]:
        node = graph.get_node(target)
        if node:
            path = graph.get_path_to_root(target)
            print(f"\n  Path to {target} (depth {node['depth']}):")
            # Show first few and last few
            for i, v in enumerate(path[:5]):
                n = graph.get_node(v)
                print(f"    {'→' if i > 0 else ' '} {v} (k={n['reverse_k']})", end="")
            if len(path) > 10:
                print(f" → ... ({len(path)-10} more) ... →", end="")
                for v in path[-5:]:
                    print(f" {v}", end="")
            print()
    
    # How many nodes at what depths?
    print("\n" + "=" * 60)
    print("Reverse graph growth (tree width at each depth):")
    max_d = max(n['depth'] for n in graph.nodes.values())
    for d in range(min(15, max_d + 1)):
        nodes_at_d = graph.get_nodes_at_depth(d)
        print(f"  depth {d:2d}: {len(nodes_at_d):>8,d} nodes")
