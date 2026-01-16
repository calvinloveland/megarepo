"""Bingo board representation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np


@dataclass
class BingoBoard:
    """
    An n×n bingo board where each cell has an independent probability of being marked.
    
    Attributes:
        probabilities: n×n array of probabilities, where probabilities[i,j] is the
                      probability that cell (i,j) is marked.
    """
    probabilities: np.ndarray
    
    def __post_init__(self):
        self.probabilities = np.asarray(self.probabilities, dtype=np.float64)
        if self.probabilities.ndim != 2:
            raise ValueError("Probabilities must be a 2D array")
        if self.probabilities.shape[0] != self.probabilities.shape[1]:
            raise ValueError("Board must be square")
        if np.any((self.probabilities < 0) | (self.probabilities > 1)):
            raise ValueError("Probabilities must be in [0, 1]")
    
    @property
    def size(self) -> int:
        """Board dimension (n for an n×n board)."""
        return self.probabilities.shape[0]
    
    @classmethod
    def uniform(cls, size: int, prob: float) -> BingoBoard:
        """Create a board where all cells have the same probability."""
        return cls(np.full((size, size), prob))
    
    @classmethod
    def random(cls, size: int, low: float = 0.0, high: float = 1.0, 
               seed: int | None = None) -> BingoBoard:
        """Create a board with random probabilities in [low, high]."""
        rng = np.random.default_rng(seed)
        probs = rng.uniform(low, high, (size, size))
        return cls(probs)
    
    def get_lines(self) -> List[List[Tuple[int, int]]]:
        """
        Get all winning lines (rows, columns, diagonals).
        
        Returns:
            List of lines, where each line is a list of (row, col) cell coordinates.
        """
        n = self.size
        lines = []
        
        # Rows
        for i in range(n):
            lines.append([(i, j) for j in range(n)])
        
        # Columns
        for j in range(n):
            lines.append([(i, j) for i in range(n)])
        
        # Main diagonal (top-left to bottom-right)
        lines.append([(i, i) for i in range(n)])
        
        # Anti-diagonal (top-right to bottom-left)
        lines.append([(i, n - 1 - i) for i in range(n)])
        
        return lines
    
    def line_probability(self, line: List[Tuple[int, int]]) -> float:
        """
        Compute the probability that all cells in a line are marked.
        
        Since cells are independent, this is the product of individual probabilities.
        """
        prob = 1.0
        for (i, j) in line:
            prob *= self.probabilities[i, j]
        return prob
    
    def cells_probability(self, cells: set[Tuple[int, int]]) -> float:
        """
        Compute the probability that all cells in a set are marked.
        
        This is the probability of the intersection (AND) of independent events.
        """
        prob = 1.0
        for (i, j) in cells:
            prob *= self.probabilities[i, j]
        return prob
    
    def sample(self, rng: np.random.Generator | None = None) -> np.ndarray:
        """
        Generate a random board outcome.
        
        Returns:
            Boolean n×n array where True means the cell is marked.
        """
        if rng is None:
            rng = np.random.default_rng()
        return rng.random(self.probabilities.shape) < self.probabilities
    
    def __repr__(self) -> str:
        return f"BingoBoard({self.size}×{self.size})"
