# Prediction Market Agent

An experimental Manifold prediction market agent for validating the Trust-Capability-Intelligence (TCI) framework.

The project is built for clarity and iteration speed over raw profit. It ingests live `manifold.markets` data, scores inputs on trust and intelligence, constrains capability through policy, and starts in shadow mode before any live execution.

## Goals

- model adversarial pressure across trust, capability, and intelligence
- compare agent variants `v1` through `v4`
- persist traces for replay and counterfactual analysis
- make live trading opt-in and tightly constrained

## Architecture

- `manifold_api.py` - Manifold client using `https://api.manifold.markets`
- `ingestion.py` - live market/comment/user capture and signal extraction
- `trust.py` - dynamic trust scoring and decay helpers
- `intelligence.py` - persuasion/manipulation heuristics
- `belief.py` - belief updates with damping
- `policy.py` - TCI capability controls
- `decision.py` - `v1` through `v4` agent variants
- `execution.py` - shadow or live execution
- `replay.py` - trace persistence and deterministic replay
- `metrics.py` - calibration, regret, exploitability, and counterfactual deltas

## Quickstart

```bash
cd active/bots/prediction-market-agent
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

Set your API key only if you want authenticated endpoints or live trading:

```bash
export MANIFOLD_API_KEY=your-key-here
```

## Usage

Capture a live market trace:

```bash
prediction-market-agent ingest MARKET_ID
```

Run a variant against live data in shadow mode:

```bash
prediction-market-agent run-agent MARKET_ID --variant v4 --mode shadow
```

Replay a captured trace or an authored adversarial scenario:

```bash
prediction-market-agent replay data/scenarios/high-intel-low-trust.json --variant v4
```

Compare all variants on the same trace:

```bash
prediction-market-agent compare-agents data/scenarios/reputation-betrayal.json
```

## Safety model

- live data is used from day one
- the default execution mode is `shadow`
- `live` mode requires an API key and still enforces hard risk caps
- replay and authored scenarios remain first-class for regression testing

## Data

- `data/scenarios/` contains committed adversarial fixtures for replay
- `data/runs/` stores local run artifacts and is gitignored

## Testing

```bash
pytest -q
```
