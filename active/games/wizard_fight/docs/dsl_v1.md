# Spell DSL v1

This document defines the Wizard Fight spell specification for LLM-generated spells. The engine will only execute spells that validate against the JSON schema in [docs/dsl_v1.json](docs/dsl_v1.json).

## Core Fields
- `name`: Spell name (3–40 chars)
- `school`: Descriptive school (3–30 chars)
- `mana_cost`: $0$–$100$
- `cooldown`: $0$–$30$ seconds
- `duration`: $0$–$20$ seconds
- `emoji`: Short visual marker (1–10 chars)

### Lanes
The battlefield has three lanes. Units can spawn in any lane; spell effects and projectiles apply to the middle lane.

## Unit Spawns
`spawn_units[]` spawns simple AI units with capped stats.
- `type`: `flying_monkey` | `arcane_sprite` | `stone_golem`
- `lane`: `0` | `1` | `2` (optional)
- `element`: short tag used for weaknesses/immunities (optional)
- `weaknesses`: list of element tags that amplify incoming damage (optional)
- `immunities`: list of element tags that negate incoming damage (optional)
- `hp`: $1$–$120$
- `speed`: $0.5$–$6.0$
- `damage`: $0.5$–$25.0$
- `target`: `wizard` | `units` | `area`

## Projectiles
`projectiles[]` fires direct projectiles.
- `speed`: $1.0$–$15.0$
- `damage`: $1.0$–$30.0$
- `element`: short tag used for weaknesses/immunities (optional)
- `pierce`: $0$–$3$
- `target`: `wizard` | `units` | `area`

## Effects
`effects[]` applies temporary status effects.
- `type`: `slow` | `haste` | `shield` | `burn` | `knockback` | `fog` | `wind` | `gravity` | `buff` | `debuff`
- `magnitude`: $0.1$–$5.0$
- `duration`: $0.5$–$10.0$ seconds
- `target`: `self` | `enemy` | `allies` | `area`

## Validation Rules
- Schema validation must pass (JSON Schema Draft 7).
- No additional properties allowed.
- Arrays capped at 5 items each.
- Totals (combined unit counts, DPS budgets) will be enforced by a clamping layer in the engine.

## Examples
See [docs/spells](docs/spells) for example spell JSON.
