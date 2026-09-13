# Ranch economy inspiration — generated from dictionary.csv

_Draw: 31791 · 105145 dictionary words · 2026-09-13T22:01:58Z_

## Upgrades (wallet sinks — 9 tiers, escalating costs)

| Name | Flavor | Cost (cr) | Effect | Tier |
|---|---|---:|---|---|
| Rended-Scrupling Barn | "Restuffed stamped on the ledger." | 66 | +25 population_cap | 1 |
| Stanines-Gleeked Feedbin | Ranchers who bought in swear by the doblas weaning. | 112 | +11 retain_bonus | 2 |
| Divided-Pater Rack | Ranchers who bought in swear by the blastomas weaning. | 594 | +33 mutation_control | 3 |
| Upstep-Psychotic Cart | Ranchers who bought in swear by the coeditor weaning. | 1440 | +25 race_duration | 4 |
| Anergy-Buffos Loft | Ranchers who bought in swear by the agnail weaning. | 2075 | +29 hof_slots | 5 |
| Blackfins-Wanters Lean-To | Ranchers who bought in swear by the laders weaning. | 2412 | +33 income_boost | 6 |
| Cole-Pimiento Silo | Ranchers who bought in swear by the barbicel weaning. | 1813 | +10 draft_bonus | 7 |
| Rampoles-Gunkhole Gate | Ranchers who bought in swear by the hangared weaning. | 4032 | +6 wild_encounter_reroll | 8 |
| Toughly-Knowingly Barn | Ranchers who bought in swear by the crooked weaning. | 4536 | +35 faction_discount | 9 |

## Supplies & fodder (consumables)

| Name | Flavor | Cost (cr) | Effect |
|---|---|---:|---|
| Shadflies-Patronage Mash | "Chocolaty" — the old hands chew on it; the young stock love it. | 19 | +sugar rush (1 race) |
| Strucken-Mango Gruel | "Underage" — the old hands chew on it; the young stock love it. | 14 | +draft calm (−10% wobble) |
| Paradigm-Kaffiyeh Curry | "Displaces" — the old hands chew on it; the young stock love it. | 18 | +stamina (+steps) |
| Misliving-Hardiness Tincture | "Byrled" — the old hands chew on it; the young stock love it. | 18 | +grip wax |
| Antiking-Privets Salve | "Humanised" — the old hands chew on it; the young stock love it. | 14 | +muster edge |
| Salivary-Leucemia Bale | "Handily" — the old hands chew on it; the young stock love it. | 15 | +lineage spark |

## Biome storefront goods

| Biome | Good | Cost (cr) | Flavor |
|---|---|---:|---|
| Grassland | Reconvert-Perchance piolet | 154 | "Vignetted" — meadow pasture |
| Flat | Fulfiller-Gladier remix | 120 | "Dahabiehs" — highway spec-herd |
| Sand | Hake-Mollah guillemot | 53 | "Centrum" — dune water rights |
| Hills | Urinous-Knobbiest cowflop | 56 | "Layovers" — vent leases |
| Rocky | Relaters-Georgic bluehead | 137 | "Omitters" — quarry salvage claims |
| Ice | Corral-Troupials remotes | 63 | "Whiny" — perimeter freight chits |

## Tuning observations (from today's numbers)

- Wallet income: `+floor(bestScore/50)` per generation; a 1620-score herd pays ~32 cr/gen.
- Only real sink today: HOF rename (1 cr). Upgrades above give the wallet a campaign-length purpose.
- Proposed sinks ~10× income: the most expensive upgrade ≈ 40 generations of a good herd;
  consumables ≈ 1-2 generations each. Tune the table to taste.

_Status: six of these (pasture cap, HOF stalls, retain, race duration, mutation,
income) are implemented in the game as the RANCH YARD store (src/core/economy.ts).
Draft_bonus / wild_encounter_reroll / faction_discount are reserved for future tiers._
