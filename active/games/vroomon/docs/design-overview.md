# How Vroomon fits together

*Last verified against the game at **457 unit + 56 e2e** (2026-09-15). The
measured sections below — progression, the wild, the economy — were true when
written; if those counts have moved a long way, re-measure before trusting the
numbers in them.*

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

- **Tier I is the campaign's requirement** (one Brand per biome), and it is a
  *formality by design*: measured over 400 freshly generated cars, the middle
  one runs **160** and the best of a hundred clears the bar — **2% of cars
  reach 1,000, and none reach 1,220**. So the first Brand teaches the loop
  (find your best, record it, race it) and **the ladder starts asking at tier
  II**, which luck never reaches. A bot rancher clearing five Brands takes **94
  generations** (9 / 20 / 25 / 38 / 2, in `tests/pacing.test.ts`).
- **From tier II, the ground asks what the car is *made of*** as well as what
  it runs: two driven wheels, then three wheels with two driven, then four with
  three, then four driven behind three engines. Calibrated against random herds
  so each rung is a real filter (60% / 39% / 12% / 4% of cars pass), and stated
  by the keeper before every race. Hunting can answer it — the wild drifts
  toward driven wheels on its own — but the far grounds answer it faster, which
  is the point of walking them.
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
tutorial unwinnable. Measured, twenty meetings in, the strongest ground's pack
sends **1,622** while a tended herd is past **2,400** — so the wild is a real
route and never a shortcut, and breeding stays the answer. The other half of
that finding: **where you hunt matters**, and not in the obvious direction —
the Ice perimeter's pack is the strongest on the map while the grass behind the
house plateaus near 1,000.

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

**23 maps** across five biomes: a town with a schoolhouse and a store, the
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
  night. Weather changes race outcomes in two places: a wild encounter is run on
  wet ground, and **a shower raises a feud's bar** while your recorded champion
  does not move — so the same car can clear a Brand at dawn and lose it by
  midday. The lab, heritage and test drive stay dry, because a fitness that
  drifted with the wall clock would be a bug.

## The invariant suite

The bugs worth having now live *between* systems, so a growing set of content
invariants reads the shipped maps, catalogs and docs rather than a fixture.
Adding content is what gets checked.

**Walking the world.** Every gate on standable ground · every landing inside a
room and never on a gate · no dead doors · every building cluster has a door ·
every NPC reachable *and* with somewhere to stand and talk to them · the map
graph walkable from town with no stranding dead ends · every on-duty keeper on
passable, reachable ground at every hour of the clock (swept in hundredths) ·
no two people on one tile at any hour · decor walkable *and* reachable · no map
fences off its tall grass · **every outdoor ground with people can take at least
one decoration**.

**Content that references content.** Every dialogue link resolves · every
`goto:` lands on real ground and hands off to a node that exists · every flag
read is set by something · every job offerable, chained without loops, paying in
spendable things, naming ground that can provide them, from a giver near that
ground · **a job on another map says which map** · every rival's car actually
races · earned-only decor is earned by some quest · circuit terrain agrees with
wild terrain · **every map with wild grass declares its own terrain** (three
were silently breeding Grassland stock) · **every rule the HUD states is
explained by a person** (weather, the wild's purpose, where you hunt, the shape
demand, feed and credits, and why a title's bar rises).

**Registers, which fail in both directions.** One-line walk-ons · dated doc
entries in the notes index · source modules with no test · the coverage reasons
those modules cite. A list that can only grow becomes a lie; a list checked both
ways stays a decision.

**Behaviour and measurement.** Breeding beats random search · the herd climbs ·
the wild improves but slower than a tended herd, and never collapses to one
build · each biome settles on its own build and its own pace · no hunting ground
is a shortcut past the bench · the tier shapes filter a real share of random
cars without locking anyone out · the loaner beats the yard's median and loses
to its champion · the campaign is reachable on a poor seed and not trivial on a
lucky one.

**Pipelines and docs.** The exported sprites match the drawing code that made
them (`source-hash.json`) · every manifest entry has its file · every doc link
and heading anchor resolves · the notes index is complete · every code fence is
closed.

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
npm test                 # engine + game   (~5s)   <- the default
npm run test:engine      # simulation core (~1.3s)  46 tests
npm run test:game        # rules + content (~4.3s) 378 tests
npm run test:balance     # measurements    (~38s)   27 tests, on demand
npm run test:unit        # all of the above (~42s)
npm run test:e2e:fast    # browser, no build   (~2.7m)
npm run test:e2e         # build + browser     (~3m)
npm run test:e2e:smoke   # the @smoke subset   (~2.1m)
npm run test:all         # everything
npm run build && node scripts/web-server.mjs   # local play session
npm run export:sprites   # redraw every sprite as a PNG (needs a browser)
npm run verify:sprites   # re-export and prove nothing changed (~30s)
```

**Why the suite is split three ways.** Twenty-seven of the 457 unit tests are
*measurements* — they race hundreds of cars across dozens of generations to
answer a question about balance ("does the herd out-climb random search", "is
tier II reachable by hunting"). They were 110 of the suite's 120 seconds of CPU.
They are not less important for being slow; they are simply a different kind of
test, and running them on every edit makes the fast feedback loop useless. So:

- **engine** — the simulation core: DNA decoding, frame geometry, the physics
  harness, the population. Pure, no content.
- **game** — the rules and the shipped content: quests, maps, economy, the
  panels' view models, plus the content invariants that read the real catalogs.
- **balance** — the measurements, run when you are tuning something.

`npm test` runs the first two, which is what you want while working. The
measurements are still in the repository and still assert their claims; they
just do not stand between you and a red-green signal.

`verify:sprites` is the determinism check: it re-exports and diffs, then puts
the committed files back, so it is always safe to run. It exists because the
runtime prefers the PNGs over drawing anything itself, which makes a stale
export **invisible** — and because art that reads a clock or `Math.random`
would otherwise only be noticed by whoever looked at two commits.
