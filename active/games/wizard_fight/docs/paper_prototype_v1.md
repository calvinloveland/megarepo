# Paper Prototype v1

## Inputs
- Sample spells in [docs/spells](docs/spells)
- DSL caps in [docs/dsl_v1.json](docs/dsl_v1.json)

## Timing Decisions
See [docs/timing_v1.json](docs/timing_v1.json).

- Tick rate: 30 Hz
- Cast time: 0.6 s
- Research delay: 8.0 s (player is vulnerable while researching)
- Mana regen: 5.0/s
- Starting mana: 50
- Starting health: 120

## Outcome Notes
- Base monkey pressure lands in ~6–9 seconds depending on collisions.
- Direct damage spells (e.g., Arcane Bolt) cannot outpace monkey pressure without committing mana.
- Defensive effects (Stone Skin) buy time but do not stall indefinitely due to cooldowns.

## Adjustments
- Unit damage cap kept at 25 to prevent burst one-shots.
- Projectile damage cap kept at 30 to preserve counterplay.
- Research delay stays at 8 seconds to keep risk meaningful.
