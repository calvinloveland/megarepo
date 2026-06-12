"""Command-line interface for bingo probability solver."""

import argparse

import numpy as np

from . import __version__
from .board import BingoBoard
from .solvers import (
    monte_carlo_solver,
    inclusion_exclusion_solver,
    compare_solvers,
)


def main():
    parser = argparse.ArgumentParser(
        description="Calculate bingo probability using Monte Carlo and/or inclusion-exclusion",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --size 3 --prob 0.5
  %(prog)s --size 4 --prob 0.6 --samples 200000
  %(prog)s --size 3 --random --seed 42 --compare
  %(prog)s --size 5 --prob 0.3 --method ie
        """,
    )
    
    parser.add_argument(
        "--version",
        action="store_true",
        help="Show version and exit",
    )

    parser.add_argument(
        "--size", "-n",
        type=int,
        default=3,
        help="Board size (n×n). Default: 3",
    )
    
    parser.add_argument(
        "--prob", "-p",
        type=float,
        default=None,
        help="Uniform probability for all cells. Default: 0.5",
    )
    
    parser.add_argument(
        "--random", "-r",
        action="store_true",
        help="Use random probabilities for each cell",
    )
    
    parser.add_argument(
        "--seed", "-s",
        type=int,
        default=None,
        help="Random seed for reproducibility",
    )
    
    parser.add_argument(
        "--samples",
        type=int,
        default=100_000,
        help="Number of Monte Carlo samples. Default: 100000",
    )
    
    parser.add_argument(
        "--method", "-m",
        choices=["mc", "ie", "both"],
        default="both",
        help="Method: mc=Monte Carlo, ie=Inclusion-Exclusion, both. Default: both",
    )
    
    parser.add_argument(
        "--compare", "-c",
        action="store_true",
        help="Run comparison and show detailed statistics",
    )
    
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show board probabilities",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON (machine-readable)",
    )
    
    args = parser.parse_args()

    if args.version:
        print(f"bingo-probability v{__version__}")
        return

    # Create board
    if args.random:
        board = BingoBoard.random(args.size, low=0.2, high=0.8, seed=args.seed)
    else:
        prob = args.prob if args.prob is not None else 0.5
        board = BingoBoard.uniform(args.size, prob)

    if args.json:
        import json
        result = _collect_results(board, args)
        print(json.dumps(result, indent=2))
        return

    print(f"Bingo Board: {board.size}×{board.size}")
    print(f"Number of lines: {len(board.get_lines())} (rows + columns + diagonals)")
    
    if args.verbose or args.random:
        print("\nCell probabilities:")
        print(np.array2string(board.probabilities, precision=3, suppress_small=True))
    
    print()
    
    if args.compare:
        _run_comparison(board, samples=args.samples, seed=args.seed)
        return
    
    # Run requested method(s)
    if args.method in ("mc", "both"):
        prob, std = monte_carlo_solver(board, samples=args.samples, seed=args.seed)
        print(f"Monte Carlo ({args.samples:,} samples):")
        print(f"  P(bingo) = {prob:.6f} ± {std:.6f}")
        print(f"  95% CI: [{prob - 1.96*std:.6f}, {prob + 1.96*std:.6f}]")
    
    if args.method in ("ie", "both"):
        num_lines = len(board.get_lines())
        if num_lines > 18:
            print(f"\nInclusion-Exclusion: Skipped (would require {2**num_lines - 1:,} terms)")
        else:
            try:
                prob = inclusion_exclusion_solver(board)
                print(f"\nInclusion-Exclusion ({2**num_lines - 1:,} terms):")
                print(f"  P(bingo) = {prob:.6f} (exact)")
            except ValueError as e:
                print(f"\nInclusion-Exclusion: {e}")


def _collect_results(board: BingoBoard, args) -> dict:
    """Collect results into a dict for JSON output."""
    result = {
        "version": __version__,
        "board_size": board.size,
        "num_lines": len(board.get_lines()),
    }

    if args.method in ("mc", "both"):
        prob, std = monte_carlo_solver(board, samples=args.samples, seed=args.seed)
        result["monte_carlo"] = {
            "samples": args.samples,
            "probability": round(prob, 6),
            "std_error": round(std, 6),
            "ci_95": [round(prob - 1.96*std, 6), round(prob + 1.96*std, 6)],
        }

    if args.method in ("ie", "both"):
        num_lines = len(board.get_lines())
        if num_lines <= 18:
            try:
                prob = inclusion_exclusion_solver(board)
                result["inclusion_exclusion"] = {
                    "terms": 2**num_lines - 1,
                    "probability": round(prob, 6),
                }
            except ValueError as e:
                result["inclusion_exclusion"] = {"error": str(e)}

    return result


def _run_comparison(board: BingoBoard, samples: int, seed: int | None) -> None:
    results = compare_solvers(board, mc_samples=samples, seed=seed)

    mc = results["monte_carlo"]
    print(f"Monte Carlo ({mc['samples']:,} samples):")
    print(f"  Probability: {mc['probability']:.6f} ± {mc['std_error']:.6f}")
    print(f"  95% CI: [{mc['95_ci'][0]:.6f}, {mc['95_ci'][1]:.6f}]")
    print(f"  Time: {mc['time_seconds']*1000:.2f} ms")

    ie = results.get("inclusion_exclusion", {})
    if "error" not in ie:
        print(f"\nInclusion-Exclusion ({ie['terms']:,} terms):")
        print(f"  Probability: {ie['probability']:.6f} (exact)")
        print(f"  Time: {ie['time_seconds']*1000:.2f} ms")

        print("\nComparison:")
        print(f"  Absolute difference: {results['difference']:.2e}")
        print(f"  MC within 1σ of exact: {'✓' if results['mc_within_1_std'] else '✗'}")
        print(f"  MC within 2σ of exact: {'✓' if results['mc_within_2_std'] else '✗'}")
    else:
        print(f"\nInclusion-Exclusion: {ie['error']}")


if __name__ == "__main__":
    main()
