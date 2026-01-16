"""
Bingo probability solvers.

Two approaches to compute P(at least one bingo):

1. Monte Carlo: Sample board outcomes and check for completed lines.
   - Preserves all correlations naturally
   - Scales polynomially with board size
   - Provides approximate answer with confidence interval

2. Inclusion-Exclusion: Exact combinatorial computation.
   - Uses P(A∪B∪...) = Σ P(Aᵢ) - Σ P(Aᵢ∩Aⱼ) + Σ P(Aᵢ∩Aⱼ∩Aₖ) - ...
   - Requires iterating over 2^L - 1 subsets of L lines
   - Exponential in number of lines, but exact
"""

from __future__ import annotations

from itertools import combinations
from typing import Tuple

import numpy as np

from .board import BingoBoard


def monte_carlo_solver(
    board: BingoBoard,
    samples: int = 100_000,
    seed: int | None = None,
) -> Tuple[float, float]:
    """
    Estimate bingo probability using Monte Carlo simulation.
    
    For each trial:
    1. Sample each cell independently according to its probability
    2. Check if any line (row, column, diagonal) is complete
    3. Record success/failure
    
    Args:
        board: The bingo board with cell probabilities
        samples: Number of Monte Carlo samples
        seed: Random seed for reproducibility
    
    Returns:
        Tuple of (estimated_probability, standard_error)
    """
    rng = np.random.default_rng(seed)
    lines = board.get_lines()
    n = board.size
    
    # Pre-convert lines to arrays for faster checking
    line_arrays = [np.array(line) for line in lines]
    
    wins = 0
    
    for _ in range(samples):
        # Sample all cells at once
        marked = rng.random((n, n)) < board.probabilities
        
        # Check each line
        for line_arr in line_arrays:
            # Check if all cells in this line are marked
            if all(marked[i, j] for i, j in line_arr):
                wins += 1
                break  # Found a bingo, no need to check more lines
    
    # Estimate probability and standard error
    p_hat = wins / samples
    # Standard error of binomial proportion
    std_error = np.sqrt(p_hat * (1 - p_hat) / samples)
    
    return p_hat, std_error


def monte_carlo_solver_vectorized(
    board: BingoBoard,
    samples: int = 100_000,
    batch_size: int = 10_000,
    seed: int | None = None,
) -> Tuple[float, float]:
    """
    Vectorized Monte Carlo solver for better performance.
    
    Processes samples in batches using NumPy operations.
    
    Args:
        board: The bingo board with cell probabilities
        samples: Number of Monte Carlo samples
        batch_size: Number of samples to process at once
        seed: Random seed for reproducibility
    
    Returns:
        Tuple of (estimated_probability, standard_error)
    """
    rng = np.random.default_rng(seed)
    lines = board.get_lines()
    n = board.size
    
    wins = 0
    processed = 0
    
    while processed < samples:
        current_batch = min(batch_size, samples - processed)
        
        # Sample all cells for all trials at once: shape (batch, n, n)
        random_vals = rng.random((current_batch, n, n))
        marked = random_vals < board.probabilities
        
        # Check each trial for any completed line
        for trial_idx in range(current_batch):
            trial_board = marked[trial_idx]
            for line in lines:
                if all(trial_board[i, j] for i, j in line):
                    wins += 1
                    break
        
        processed += current_batch
    
    p_hat = wins / samples
    std_error = np.sqrt(p_hat * (1 - p_hat) / samples)
    
    return p_hat, std_error


def inclusion_exclusion_solver(board: BingoBoard, max_lines: int = 20) -> float:
    """
    Compute exact bingo probability using inclusion-exclusion principle.
    
    P(at least one bingo) = P(L₁ ∪ L₂ ∪ ... ∪ Lₖ)
    
    By inclusion-exclusion:
    = Σᵢ P(Lᵢ) - Σᵢ<ⱼ P(Lᵢ ∩ Lⱼ) + Σᵢ<ⱼ<ₖ P(Lᵢ ∩ Lⱼ ∩ Lₖ) - ...
    
    Where P(Lᵢ ∩ Lⱼ ∩ ...) is the probability that ALL cells in the UNION
    of those lines are marked (since cells are independent).
    
    Args:
        board: The bingo board with cell probabilities
        max_lines: Safety limit on number of lines (exponential blowup)
    
    Returns:
        Exact probability of at least one bingo
    
    Raises:
        ValueError: If board has too many lines for feasible computation
    """
    lines = board.get_lines()
    num_lines = len(lines)
    
    if num_lines > max_lines:
        raise ValueError(
            f"Board has {num_lines} lines, which requires {2**num_lines - 1} terms. "
            f"This exceeds the safety limit of {2**max_lines - 1} terms. "
            f"Use Monte Carlo instead, or increase max_lines if you're sure."
        )
    
    # Convert lines to sets of cells for efficient union operations
    line_sets = [set(line) for line in lines]
    
    probability = 0.0
    
    # Iterate over all non-empty subsets of lines
    # Subset size k contributes with sign (-1)^(k+1)
    for subset_size in range(1, num_lines + 1):
        sign = 1 if subset_size % 2 == 1 else -1
        
        for line_indices in combinations(range(num_lines), subset_size):
            # Union of all cells in these lines
            cells = set()
            for idx in line_indices:
                cells.update(line_sets[idx])
            
            # Probability that all cells in the union are marked
            subset_prob = board.cells_probability(cells)
            probability += sign * subset_prob
    
    return probability


def inclusion_exclusion_solver_optimized(board: BingoBoard, max_lines: int = 20) -> float:
    """
    Optimized inclusion-exclusion with early termination for negligible terms.
    
    Same algorithm as inclusion_exclusion_solver but skips terms that
    contribute less than machine epsilon.
    
    Args:
        board: The bingo board with cell probabilities
        max_lines: Safety limit on number of lines
    
    Returns:
        Probability of at least one bingo (exact within floating point precision)
    """
    lines = board.get_lines()
    num_lines = len(lines)
    
    if num_lines > max_lines:
        raise ValueError(
            f"Board has {num_lines} lines, exceeds safety limit. Use Monte Carlo."
        )
    
    line_sets = [set(line) for line in lines]
    
    # Precompute line probabilities for potential pruning
    line_probs = [board.line_probability(line) for line in lines]
    
    probability = 0.0
    terms_computed = 0
    terms_skipped = 0
    
    for subset_size in range(1, num_lines + 1):
        sign = 1 if subset_size % 2 == 1 else -1
        
        for line_indices in combinations(range(num_lines), subset_size):
            # Quick upper bound check: product of individual line probs
            # The actual probability (with overlapping cells counted once) is >= this
            # but if even this is negligible, we can skip
            upper_bound = 1.0
            for idx in line_indices:
                upper_bound *= line_probs[idx]
            
            if upper_bound < 1e-15:
                terms_skipped += 1
                continue
            
            # Compute actual probability
            cells = set()
            for idx in line_indices:
                cells.update(line_sets[idx])
            
            subset_prob = board.cells_probability(cells)
            probability += sign * subset_prob
            terms_computed += 1
    
    return probability


def compare_solvers(
    board: BingoBoard,
    mc_samples: int = 100_000,
    seed: int | None = None,
) -> dict:
    """
    Run both solvers and compare results.
    
    Args:
        board: The bingo board
        mc_samples: Number of Monte Carlo samples
        seed: Random seed
    
    Returns:
        Dictionary with results from both methods
    """
    import time
    
    results = {
        "board_size": board.size,
        "num_lines": len(board.get_lines()),
    }
    
    # Monte Carlo
    start = time.perf_counter()
    mc_prob, mc_std = monte_carlo_solver(board, samples=mc_samples, seed=seed)
    mc_time = time.perf_counter() - start
    
    results["monte_carlo"] = {
        "probability": mc_prob,
        "std_error": mc_std,
        "samples": mc_samples,
        "time_seconds": mc_time,
        "95_ci": (mc_prob - 1.96 * mc_std, mc_prob + 1.96 * mc_std),
    }
    
    # Inclusion-Exclusion (only if feasible)
    num_lines = len(board.get_lines())
    if num_lines <= 16:  # Up to 65535 terms
        try:
            start = time.perf_counter()
            ie_prob = inclusion_exclusion_solver(board)
            ie_time = time.perf_counter() - start
            
            results["inclusion_exclusion"] = {
                "probability": ie_prob,
                "terms": 2 ** num_lines - 1,
                "time_seconds": ie_time,
            }
            
            # Compare
            results["difference"] = abs(mc_prob - ie_prob)
            results["mc_within_1_std"] = abs(mc_prob - ie_prob) <= mc_std
            results["mc_within_2_std"] = abs(mc_prob - ie_prob) <= 2 * mc_std
        except ValueError as e:
            results["inclusion_exclusion"] = {"error": str(e)}
    else:
        results["inclusion_exclusion"] = {
            "error": f"Skipped: {2**num_lines - 1} terms would be required"
        }
    
    return results
