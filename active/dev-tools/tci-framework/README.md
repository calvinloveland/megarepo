# TCI Framework

Reusable Trust-Capability-Intelligence framework primitives extracted from the Manifold trading work.

This project owns the reusable parts of the system:

- typed models for actors, inputs, decisions, and replay bundles
- trust scoring and trust update helpers
- intelligence scoring heuristics
- belief updates and counterfactual helpers
- capability policy enforcement
- decision-engine logic for `v1` through `v4`
- replay helpers and framework-level adversarial fixtures

## Quickstart

```bash
cd active/dev-tools/tci-framework
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

## Testing

```bash
pytest -q
```

## Included adversarial fixtures

- `data/scenarios/high-intel-low-trust.json`
- `data/scenarios/reputation-betrayal.json`

These traces are intended for replay, regression testing, and policy comparisons across `v1`-`v4`.
