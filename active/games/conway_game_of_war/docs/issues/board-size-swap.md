# Board size x/y swap convention

## Summary

`board_size_x` is used as the row (y) index limit and `board_size_y` as the
column (x) index limit throughout the codebase. The names are backwards from
their literal meaning but the convention is internally consistent.

## Root cause

In `GameState.__init__`:

```python
self.board = [
    [CellState() for _ in range(board_size_x)] for _ in range(board_size_y)
]
```

The board is constructed as a list of rows (y dimension), each row being a
list of cells (x dimension). After construction the code sets:

```python
self.board_size_x = len(self.board)       # number of rows (should be x)
self.board_size_y = len(self.board[0])    # number of columns (should be y)
```

These assignments are **swapped**: `board_size_x` gets the row count and
`board_size_y` gets the column count. Every use of these values throughout the
codebase follows this swapped convention (e.g., `self.board[x][y]` treats
`x` as the row index).

## Why it works

The default board is 127×131, which is nearly square, so the swap causes no
visible problems. Player start points are hard-coded to fit within both the
correct and swapped sizes.

## Why it matters

1. **Misleading logs**: `Board size x (rows): 131, Board size y (cols): 127`
   is confusing when `DEFAULT_BOARD_SIZE_X=127` and `DEFAULT_BOARD_SIZE_Y=131`.
2. **Testing issues**: Any unit test that creates a non-square board (e.g.
   4×8 instead of 8×4) will crash or produce wrong results because the
   iteration bounds are inverted.
3. **Maintenance burden**: New contributors who read the variable names
   literally will introduce bugs.

## Recommended fix

Swap the assignments **and** swap all `for x`/`for y` iterators and array
indexes throughout `game_state.py`. There are roughly 40 usages of
`board_size_x`/`board_size_y` and ~15 `self.board[x][y]` / `self.board[y][x]`
accesses that would need to change together.

Steps:

1. Fix the post-construction assignments:
   ```python
   self.board_size_y = len(self.board)     # rows
   self.board_size_x = len(self.board[0])  # columns
   ```
2. Fix the rectangle assertion:
   ```python
   assert len(row) == self.board_size_x    # each row should have board_size_x cells
   ```
3. Audit every `self.board[y][x]` and `self.board[x][y]` access to use
   correct indexing (`board[row][col]` = `board[y][x]`).
4. Audit every `for x in range(board_size_x)` / `for y in range(board_size_y)`
   to use correct iteration.
5. Update `get_stats()` return keys if external consumers depend on
   `size_x`/`size_y`.
6. Run ALL tests (Python + Playwright) to validate.

## Related files

- `src/conways_game_of_war/game_state.py` — main source
- `tests/test_game_state.py` — tests that caught this
