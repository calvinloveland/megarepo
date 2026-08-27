# ⌚ Watch Forge

**Evolve the perfect mechanical watch.**

A genetic algorithm breeds a population of watch chromosomes toward the charter
you choose — then the champion renders as a **live, animated skeletonized
movement**: barrels wind, the gear train meshes, the escape wheel ticks and the
balance swings on the dial.

![Champion skeleton dial](screenshots/02-evolved.png)

## The Charters

Pick the scoring equation the population optimises:

| Charter | Objective |
|---|---|
| 🔍 **Glass Palace** | Show every gear. Expose as many components as possible — crank the skeletonization, pile on parts. |
| 🪶 **Less Is More** | Chronometric perfection with the fewest possible parts. |
| 👑 **Thin King** | As many complications as possible in the slimmest package. Haute finishing in a watch that still slips under the cuff. |
| 🎯 **Chronometer Trials** | Pure rate accuracy and long-term reliability. No excuses. |
| ⏳ **Eight-Day Pocket Hero** | Barrel stacks and dependability — a power reserve that outlasts the week. |

Each charter is a transparent scoring equation (it is shown under the
champion). Rebalance one and the behavioural tests in `tests/fitness.test.mjs`
will tell you.

## The Domain

A watch chromosome carries:

- **Base genes** — escapement (lever / co-axial / detent chronometer /
  constant force), balance, hairspring (steel / Glucydur / silicon), beat rate
  (18,000–36,000 vph), barrels (1–3), gear-train wheels (3–9),
  skeletonization (0–100%), case diameter
- **17 complications**, each gradeable 1–3: date, big date, day, month, leap
  year, perpetual calendar, moon phase, equation of time, GMT, world timer,
  chronograph, rattrapante, power reserve, regulator display, jumping hour,
  tourbillon, minute repeater

Every component shifts thickness, weight, cost, complexity, accuracy,
visibility and power draw. Traits fight each other: silicon hairsprings
improve rate but raise cost; triple barrels stack height for reserve;
a minute repeater is a cathedral of parts that wrecks a slim profile.

## Features

- **Live evolution** — speed control from pause to 1000×, population slider,
  seed control, adaptive mutation that escapes stalls, and a **population
  diversity readout** (when it collapses, inject new seeds)
- **Themed founding cohorts** — each charter opens with a fitting archetype:
  the skeleton atelier starts with an openworked monster, the chronometer lab
  with a bare silicon precision engine
- **Watchmaker bench** — hand-tune a build (every gene + complication grade)
  and seed the population with it. Your build is the founding genotype.
- **Live rendering** — skeletonized dial, thickness side-profile, and a
  best/avg fitness curve across generations
- **Hall of Fame** — save champions to `localStorage`, reload and continue
  evolving from them
- **Score breakdowns** — every charter's equation is broken into live terms

## Run it

```bash
npm start            # → http://localhost:5120
npm test             # node:test unit suite (phenotype, fitness, GA)
npm run test:e2e     # Playwright specs (Nix-managed Chrome, see config)
```

Also registered in the [Megarepo Launcher](https://shsw.dev) as **“Watch
Forge”** (`watch` subdomain).

## Tech

Vanilla JS + Canvas 2D, no build step, no framework. The engine is a tiny
inspectable genetic algorithm (< 300 lines). Docs live in [`docs/index.md`](docs/index.md).

## Project layout

```
index.html · style.css · data.js · watch.js · evolution.js · render.js ·
game.js · server.mjs · playwright.config.cjs
tests/          # unit suite
tests/e2e/      # browser spec
scripts/        # smoke probe
docs/           # web docs
screenshots/    # captured champions
```