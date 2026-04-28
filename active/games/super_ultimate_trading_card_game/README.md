# Super Ultimate Trading Card Game

Python-only prototype of **Super Ultimate Trading Card Game** focused on deterministic simulation, AI playtesting, and LLM-backed card generation.

## What this prototype includes

- deterministic 1v1 simulation with two tracks
- persistent owned-card collections across matches
- custom reusable base cards
- OpenRouter-backed structured card generation with validation and balancing
- sandboxed scripted unit and base abilities with a restricted Python event API
- deterministic fallback generation for offline testing
- simple AI deckbuilding and playtesting bots
- SQLite-backed persistence for owned cards, bases, and saved match logs

## Quick start

```bash
cd active/games/super_ultimate_trading_card_game
python -m venv .venv
. .venv/bin/activate
pip install -e .[dev]
sutcg-sim playtest --matches 25 --generator deterministic
```

## OpenRouter generation

The prototype can read an API key from `~/.openrouter_free_key`.

```bash
cd active/games/super_ultimate_trading_card_game
. .venv/bin/activate
sutcg-sim playtest --matches 10 --generator auto
```

Generator modes:

- `deterministic` - offline fallback generator
- `openrouter` - force OpenRouter generation
- `auto` - use OpenRouter when a key is available, otherwise fall back

Optional environment variables:

- `SUTCG_OPENROUTER_MODEL` - override the default OpenRouter model
- `SUTCG_OPENROUTER_URL` - override the OpenRouter endpoint
- `SUTCG_OPENROUTER_REFERER` - optional referer header
- `SUTCG_OPENROUTER_TITLE` - optional client title header

By default, the OpenRouter generator prefers a live free-model list and retries across several candidates before falling back to deterministic generation. This makes free-tier playtesting much more resilient to temporary provider 404/429 failures.

Generated cards now include `ability_summary` plus `ability_script`. Unit scripts can react to `round_start`, `combat`, and `attack_base`; base scripts can react to `round_start` and `base_attacked`. Both run through a restricted sandbox with whitelisted helper calls like `api.heal_ally(2)`, `api.gain_card_points(1)`, `api.reduce_incoming_damage(2)`, and `api.add_base_damage(1)`.

## Commands

```bash
sutcg-sim playtest --matches 50 --generator deterministic
sutcg-sim match --generator deterministic --seed 123
sutcg-sim generate-card --prompt "A glass-cannon phoenix sniper" --generator deterministic
sutcg-sim collection --owner-id alpha
sutcg-sim match-history --limit 5
sutcg-sim show-match --id 1
```

Generated cards can be saved to the SQLite collection store with:

```bash
sutcg-sim generate-card --prompt "A flying medic" --owner-id alpha --save
```

By default, data is stored in `active/games/super_ultimate_trading_card_game/data/sutcg.sqlite3`.

## Tests

```bash
cd active/games/super_ultimate_trading_card_game
. .venv/bin/activate
pytest
```
