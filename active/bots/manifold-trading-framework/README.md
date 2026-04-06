# Manifold Trading Framework

Live and shadow Manifold trading workflows built on top of the reusable `tci-framework` project.

This project owns:

- Manifold REST API access
- live market ingestion
- shadow/live execution controls
- trading CLI workflows

The TCI core logic now lives in `active/dev-tools/tci-framework/`.

## Quickstart

```bash
cd active/dev-tools/tci-framework
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

cd ../../bots/manifold-trading-framework
pip install -e '.[dev]'
```

Set your API key only if you want authenticated endpoints or live trading:

```bash
export MANIFOLD_API_KEY=your-key-here
```

## Usage

Capture a live market trace:

```bash
manifold-trading-framework ingest MARKET_ID
```

Run a variant against live data in shadow mode:

```bash
manifold-trading-framework run-agent MARKET_ID --variant v4 --mode shadow
```

Replay an authored adversarial scenario from the framework project:

```bash
manifold-trading-framework replay ../../dev-tools/tci-framework/data/scenarios/high-intel-low-trust.json --variant v4
```

Compare all variants on the same trace:

```bash
manifold-trading-framework compare-agents ../../dev-tools/tci-framework/data/scenarios/reputation-betrayal.json
```

## Safety model

- live data is used from day one
- the default execution mode is `shadow`
- `live` mode requires an API key and still enforces hard risk caps
- replay and authored scenarios remain first-class for regression testing

## Data

- `data/runs/` stores local run artifacts and is gitignored

## Testing

```bash
pytest -q
```
