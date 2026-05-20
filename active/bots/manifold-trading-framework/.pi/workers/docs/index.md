# Project-local workers for Manifold trading

These worker profiles are meant to be used by `active/dev-tools/pi-hiring-harness`.

The active Pi session acts as the CEO. These markdown files define narrow specialist workers for market research, arbitrage, narrative analysis, risk review, red-team review, and execution planning.

Notes:

- the profiles intentionally keep tool access narrow
- prices are left at `0` as starter values; set real model pricing if you want budget estimates to be meaningful
- no worker here should bypass deterministic execution or risk controls in the Python framework
- the `pr-analyst` role is for public-narrative analysis, not deceptive promotion or market manipulation

Typical flow:

1. run the hiring harness from this project root
2. use `workerScope: "project"` or `"both"`
3. start in `mode: "plan"`
4. keep the Python trading framework in `shadow` mode until the process is calibrated
