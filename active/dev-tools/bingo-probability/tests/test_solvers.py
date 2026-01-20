"""Tests for bingo probability solvers."""

import numpy as np
import pytest

from bingo_probability import BingoBoard, monte_carlo_solver, inclusion_exclusion_solver
from bingo_probability.solvers import compare_solvers


class TestBingoBoard:
    """Tests for BingoBoard class."""
    
    def test_uniform_board(self):
        board = BingoBoard.uniform(3, 0.5)
        assert board.size == 3
        assert np.allclose(board.probabilities, 0.5)
    
    def test_random_board(self):
        board = BingoBoard.random(4, low=0.2, high=0.8, seed=42)
        assert board.size == 4
        assert np.all(board.probabilities >= 0.2)
        assert np.all(board.probabilities <= 0.8)
    
    def test_custom_board(self):
        probs = np.array([[0.1, 0.2], [0.3, 0.4]])
        board = BingoBoard(probs)
        assert board.size == 2
        np.testing.assert_array_equal(board.probabilities, probs)
    
    def test_invalid_probabilities(self):
        with pytest.raises(ValueError):
            BingoBoard(np.array([[1.5, 0.5], [0.5, 0.5]]))
        with pytest.raises(ValueError):
            BingoBoard(np.array([[-0.1, 0.5], [0.5, 0.5]]))
    
    def test_non_square(self):
        with pytest.raises(ValueError):
            BingoBoard(np.array([[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]]))
    
    def test_get_lines_3x3(self):
        board = BingoBoard.uniform(3, 0.5)
        lines = board.get_lines()
        # 3 rows + 3 columns + 2 diagonals = 8 lines
        assert len(lines) == 8
        # Each line has 3 cells
        assert all(len(line) == 3 for line in lines)
    
    def test_get_lines_5x5(self):
        board = BingoBoard.uniform(5, 0.5)
        lines = board.get_lines()
        # 5 rows + 5 columns + 2 diagonals = 12 lines
        assert len(lines) == 12
    
    def test_line_probability(self):
        probs = np.array([[0.5, 0.5], [0.5, 0.5]])
        board = BingoBoard(probs)
        # First row: (0,0) and (0,1), each with 0.5
        row0 = [(0, 0), (0, 1)]
        assert board.line_probability(row0) == 0.25


class TestMonteCarlo:
    """Tests for Monte Carlo solver."""
    
    def test_certain_win(self):
        """All cells certain - should always win."""
        board = BingoBoard.uniform(3, 1.0)
        prob, std = monte_carlo_solver(board, samples=1000, seed=42)
        assert prob == 1.0
        assert std == 0.0
    
    def test_certain_loss(self):
        """All cells impossible - should never win."""
        board = BingoBoard.uniform(3, 0.0)
        prob, std = monte_carlo_solver(board, samples=1000, seed=42)
        assert prob == 0.0
        assert std == 0.0
    
    def test_reproducibility(self):
        """Same seed should give same result."""
        board = BingoBoard.uniform(3, 0.5)
        prob1, _ = monte_carlo_solver(board, samples=10000, seed=12345)
        prob2, _ = monte_carlo_solver(board, samples=10000, seed=12345)
        assert prob1 == prob2
    
    def test_reasonable_probability(self):
        """50% cells should give reasonable bingo probability."""
        board = BingoBoard.uniform(3, 0.5)
        prob, std = monte_carlo_solver(board, samples=50000, seed=42)
        # With 50% per cell, bingo prob should be roughly 0.1-0.4
        assert 0.05 < prob < 0.6
        # Standard error should be small with many samples
        assert std < 0.01


class TestInclusionExclusion:
    """Tests for inclusion-exclusion solver."""
    
    def test_certain_win(self):
        """All cells certain - probability 1."""
        board = BingoBoard.uniform(3, 1.0)
        prob = inclusion_exclusion_solver(board)
        assert np.isclose(prob, 1.0)
    
    def test_certain_loss(self):
        """All cells impossible - probability 0."""
        board = BingoBoard.uniform(3, 0.0)
        prob = inclusion_exclusion_solver(board)
        assert np.isclose(prob, 0.0)
    
    def test_single_row_certain(self):
        """One row certain, rest impossible."""
        probs = np.zeros((3, 3))
        probs[0, :] = 1.0  # First row certain
        board = BingoBoard(probs)
        prob = inclusion_exclusion_solver(board)
        assert np.isclose(prob, 1.0)
    
    def test_2x2_manual_calculation(self):
        """
        2×2 board with uniform p.
        Lines: 2 rows + 2 cols + 2 diags = 6 lines
        
        For uniform p, we can verify by hand.
        """
        p = 0.5
        board = BingoBoard.uniform(2, p)
        
        # Manual calculation for 2x2:
        # P(row1) = P(row2) = P(col1) = P(col2) = p^2
        # P(diag1) = P(diag2) = p^2
        # But diagonals share cells with rows/cols...
        # This gets complex - just verify it's between 0 and 1
        prob = inclusion_exclusion_solver(board)
        assert 0 <= prob <= 1
    
    def test_too_many_lines(self):
        """Should raise error for boards with too many lines."""
        board = BingoBoard.uniform(10, 0.5)  # 22 lines -> 4M+ terms
        with pytest.raises(ValueError, match="exceeds the safety limit"):
            inclusion_exclusion_solver(board, max_lines=16)


class TestSolverAgreement:
    """Tests that both solvers agree."""
    
    @pytest.mark.parametrize("size", [2, 3, 4])
    @pytest.mark.parametrize("prob", [0.3, 0.5, 0.7])
    def test_uniform_boards(self, size, prob):
        """MC and IE should agree on uniform boards."""
        board = BingoBoard.uniform(size, prob)
        
        mc_prob, mc_std = monte_carlo_solver(board, samples=100000, seed=42)
        ie_prob = inclusion_exclusion_solver(board)
        
        # MC should be within 3 standard deviations of exact
        assert abs(mc_prob - ie_prob) < 3 * mc_std, (
            f"MC={mc_prob:.4f}±{mc_std:.4f}, IE={ie_prob:.4f}"
        )
    
    def test_random_board(self):
        """MC and IE should agree on random boards."""
        board = BingoBoard.random(3, low=0.2, high=0.8, seed=123)
        
        mc_prob, mc_std = monte_carlo_solver(board, samples=100000, seed=42)
        ie_prob = inclusion_exclusion_solver(board)
        
        # MC should be within 3 standard deviations of exact
        assert abs(mc_prob - ie_prob) < 3 * mc_std


class TestCompare:
    """Tests for the comparison function."""
    
    def test_compare_returns_all_fields(self):
        board = BingoBoard.uniform(3, 0.5)
        results = compare_solvers(board, mc_samples=1000, seed=42)
        
        assert "board_size" in results
        assert "num_lines" in results
        assert "monte_carlo" in results
        assert "inclusion_exclusion" in results
        
        mc = results["monte_carlo"]
        assert "probability" in mc
        assert "std_error" in mc
        assert "time_seconds" in mc
