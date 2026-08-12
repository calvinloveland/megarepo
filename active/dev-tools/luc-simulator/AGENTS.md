# luc-simulator project notes

Pure-Python (stdlib only) simulator + prototype of the DARPA LUC (Lightweight
Universal Codec) concept.

## Conventions

- Python >= 3.10, **no runtime dependencies**. Tests use pytest.
- Bits are Python ints, **MSB-first**: `bit(x, i, n)` reads position i (0 = MSB).
- Every code family is exposed as a `LinearCode` with a single membership oracle
  (`contains`); the GRAND decoder and the policy use nothing else.
- Run tests: `uv run pytest` (or `.venv/bin/python -m pytest`).
- CLI entry point: `luc-sim` (see `pyproject.toml` `[project.scripts]`).
- Profile cache lives at `$LUC_SIM_CACHE` (default `~/.cache/luc-sim/profiles.json`);
  set it to a temp dir in tests (`cache=False` also disables it).

## Layout

- `src/luc_sim/` — the package (bits, gf, linear, codes, grand, channel, codec,
  profiles, sim, metrics, plot, cli).
- `tests/` — pytest suite (code construction, GRAND decoding, codec roundtrips,
  channel math, link/metrics behavior).
- `docs/index.md` — project documentation.

## Gotchas

- `LinearCode.encode` uses the RREF basis; `info_positions` are the pivot columns.
- rs(15,11) has k=44 -> no codebook; `contains` uses its GF(16) syndrome oracle and
  it is excluded from the default adaptive policy (`params["policy"] = False`) for
  speed.
- GRAND's query budget makes very robust codes (e.g. rep31) impractical; the policy
  consults *measured* profiles and falls back to the least-bad code, not the most
  robust one.
- Hamming codes are perfect: a 2-error word can be distance-1 from a different
  codeword, so GRAND (ML) may legitimately decode to it — the CRC-16 frame check is
  what turns that into a detected error.
