# How Vroomon fits together

One page for the whole design: what the game *is*, how its systems feed each
other, and where the numbers came from. Everything here is implemented and
covered by tests — see the test suite for the invariants that hold it in
place.

## The fantasy

Vroomon are **beetle- and mouse-sized wheeled livestock**. You are a rancher on
the Isles of Speid: you keep a herd, breed it, race it, and defend a Brand on
each biome's circuit. You never ride a vroomon — you run them, and you tend
the line that makes them fast.

## The body: two paths

A vroomon's DNA encodes **one chain, read twice** (see `shared/dna-v2.ts`):

- **Structure** — plates (`R`) and wheels (`W`) in a chain. Every plate is a
  part of one rigid frame, joined along the chain and each keeping its own
  tilt, so a run of plates can **arch** (good breakover) or fold at a bad
  angle. Wheels are pinned at their own centres.
- **Power** — cylinders (`C`) make power, driveshafts (`D`) lose a little of
  it, gearsets (`G`) hand a share to the wheel in their own slot and pass the
  rest on. The arrays share indices, so **order matters**: a wheel with no
  cylinder upstream is dead weight.

Most combinations don't work, which is the point: finding the ones that do, and
breeding them, is the game. The inspector (`📖` any vroomon in the Pocket
Ranch) prints the structure, the power path and **the drive at every wheel**.

## The loop

1. **Catch** — walk tall grass with `SEEKING` on, meet a wild vroomon, and
   **beat it in a race** to take its genome. A wild animal is a floor; never a
   ceiling.
2. **Breed** — the Herd bench runs generations against a bar you set: pick the
   retain ratio, mutation rate, DNA length, then `▶ AUTO` to grind unattended
   until the herd plateaus or the feed runs out.
3. **Race** — the circuit: five biomes in order, each defended by a household.
   Winning a sweep raises that circuit a tier (×1.22), and the bar is keyed by
   the **Brand**, so a sweep raises the bar area-wide.
4. **Sweep** — five Brands earns the Grand Roundup.

## Progression, measured

- **Tier I is the campaign's requirement** (one Brand per biome), so it is
  calibrated between two measured bounds: **above** what a random 32-car herd
  already does on that ground (750 / 1,145 / 1,097 / 1,052 / 875), and **below**
  what a herd reaches even on a poor seed (1,271 / 1,673 / 1,519 / 2,068 /
  3,239). A bot rancher clearing five Brands takes **94 generations**.
- **Later tiers are a title defence.** They rise, the record books keep the
  scores, and a wall there is a challenge rather than a dead end — the ledger
  says exactly how short you are.
- **The ranch economy**: upgrades cost 38,190 credits end to end, against
  roughly 28,000 earned across a five-terrain campaign, so buying everything is
  a mastery goal rather than a mid-game wall. All of it is in
  `tests/pacing.test.ts`.

## The wild evolves too

Each biome keeps an **evolving pack of 24** (`core/wild.ts`). The ground is the
selector; nobody steers it. Every meeting turns the pack over a generation —
**two generations after dark** — and the champions are carried, so the wild
never gets easier. You meet the pack's *median* animal, not its champion: the
alpha is where the difficulty lives, and meeting it every time made the
tutorial unwinnable. The wild improves at roughly **half the rate of a tended
herd**, which is what keeps breeding the answer.

## The economy, and where the Herd Book pays

- **Oxide's trade counter** buys caught specimens (priced by a short race) and
  sells road stock drawn from the wild packs **in your save** — so the shelf is
  ground you have walked, and it improves as those packs evolve. Buying always
  costs more than selling the same animal.
- **The Herd Book (`📖 Dex`)** remembers where each specimen came off, what it
  ran and when, so a collection has provenance rather than a list of strings.
- **The ledger** in the Record Barn puts every circuit's bar against your best
  there, with the car that set it and the margin — and a **go** button that
  loads that car and ground into the paddock.

## The world

**25 maps** across five biomes: a town with a schoolhouse and a store, the
ranch house and yard, an orchard, two routes, two arenas with back rooms,
three biome grounds, a Salt Road waystation with two interiors, and three road
landmarks with an office and a shed.

- **People have days.** NPCs follow **routines** (Jess works the market in the
  morning and drinks by the well at dusk) and **shifts** (Pell the watchman and
  four other night keepers exist *only* after dark).
- **They know you.** Opening lines follow your standing (`new` / `known` /
  `champion`), and rivals remember the last race.
- **Jobs** are declarative objectives (`win-wild-on`, `dex-biomes`,
  `champion-on`, `release`, `visit`, …), progress is *derived* from the world
  and the run, accepting one is a dialogue `setFlag`, and rewards pay once.
  Chains gate behind paid prerequisites.
- **A four-minute day** drives the light, the windows, the shifts and the
  **weather**: clear mornings, showers in the afternoon, gales at dusk, mist by
  night. Weather is the one thing that changes a race outcome — and it applies
  **only to wild encounters**, never to the lab, heritage, circuit or test
  drives, because a fitness that drifted with the wall clock would be a bug.

## The invariant suite

The bugs worth having now live *between* systems, so a growing set of
content invariants reads the shipped maps and catalogs:

every gate on standable ground · every landing inside a room and never on a
gate · no dead doors · every building cluster has a door · every NPC reachable
· the map graph walkable from town with no stranding dead ends · every dialogue
link resolves · no two people on one tile at any hour · every person has
something to say · every job offerable, chained without loops, paying in
spendable things, naming ground that can provide them, from a giver near that
ground · every rival's car actually races · circuit terrain agrees with wild
terrain · decor walkable *and* reachable · no map fences off its tall grass ·
every outdoor ground with a wild pack has grass you can reach.

Plus the behavioural guards: the wild improves but slower than a tended herd ·
breeding beats random search · the campaign is reachable on a poor seed and not
trivial on a lucky one.

## Where things live

- `shared/dna-v2.ts` — DNA → parts, power path, chain layout.
- `simulation/matter-simulation.ts` — bodies, drive, clamps, `SIM_TUNING`.
- `core/population.ts` — evaluation, breeding, generations.
- `core/wild.ts`, `core/market.ts`, `core/economy.ts` — the wild, trade, ranch.
- `renderer/` — the game: overworld, hub scenes, lab, ledger, inspector.
- `renderer/world/` — maps, quests, routines, weather, ambience, specimens.

## Running it

```
cd electron
npm test                 # unit        (~10s)
npm run test:e2e:smoke   # smoke       (~25s)
npm run test:e2e         # full        (~1.5m)
VROOMON_SLOW_TESTS=1 npx vitest run tests/pacing.test.ts   # re-measure the curve
npm run build && node scripts/web-server.mjs               # local play session
```
