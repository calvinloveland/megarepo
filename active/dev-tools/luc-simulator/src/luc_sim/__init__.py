"""luc-sim: pure-Python simulator + prototype for the DARPA Lightweight Universal Codec (LUC) concept.

The LUC program (DARPA BAA HR001126S0014) seeks a *universal, adaptive encoder-decoder*
that can communicate using any known error-correcting code -- or one developed in the
future -- switching code classes on the fly while a link is operating, and supporting
field-updatable code books without hardware redesign.

This package is a small-scale, dependency-free prototype of that idea:

* ``codes``  -- a registry of code families (repetition, Hamming, BCH, Reed-Solomon,
  Polar, LDPC, Turbo-lite) implemented as linear block codes with exact membership tests.
* ``grand``  -- the GRAND-style *universal decoder*: one algorithm decodes every family,
  needing only a codebook/syndrome membership oracle (it never looks inside a code).
* ``codec``  -- the universal codec: in-band code signaling, decoder-driven channel
  estimation, adaptive code selection, and a field-updatable code registry.
* ``channel``-- BPSK/AWGN channel models with dynamic SNR schedules and burst noise.
* ``sim``    -- Monte-Carlo link simulation, BLER sweeps, cached performance profiles.
* ``metrics``-- a report mirroring the LUC program's Table-1 metrics.

Run ``luc-sim --help`` (or ``python -m luc_sim``) for the CLI: ``codes``, ``sweep``,
``metrics``, ``demo``, ``plot``.
"""

__version__ = "0.1.0"

from luc_sim import bits, channel, codes, codec, gf, grand, linear, metrics, sim  # noqa: F401
