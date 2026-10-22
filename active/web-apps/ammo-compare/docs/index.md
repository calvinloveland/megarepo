# Ammo Comparison Table — Design

![Desktop view](images/desktop.png)

One page, one job: let you compare a shelf of ammunition by the numbers that
actually differ between loads. Everything else — units, sorting, filtering — is
there so the comparison is quick, not so the page has features.

## Where the numbers come from

`data/ammo.js` stores what a load *is*:

```js
{ id, name, category, bulletGr, velocityFps, costPerRound, recoil, use, platforms, notes }
```

Reference rows may also carry `introduced`, `nation`, `diameterIn`, `bc`,
`caseLengthMm`, `factoryLoadings`, `commonGrains`, and `source`. These are
display metadata; they never feed the ballistics math. `commonGrains` is a
`[low, high]` pair describing the bullet weights normally sold for the
cartridge — the row's own `bulletGr` always sits inside it.

Derived values are never stored. `lib/ballistics.js` computes them:

| Value | Formula | Notes |
|---|---|---|
| Muzzle energy (ft·lb) | `gr × fps² / 450437` | `450437 = 2 · 7000 · 32.174` folds in grains-per-pound and gravity |
| Muzzle energy (J) | `ft·lb × 1.3558179` | |
| Power factor | `gr × fps / 1000` | Imperial shooting-sports momentum figure; 125 minor / 165 major |
| Momentum (lbf·s) | `gr × fps / 225218.34` | The `P` column in Wikipedia's cartridge table |
| Metric momentum | `kg × m/s` | What the metric toggle shows in the power-factor column |
| Velocity (m/s) | `fps × 0.3048` | |
| Bullet mass (g) | `gr × 0.06479891` | |

Keeping the math in one module is the point: the UI, the tests, and anything
added later all read the same implementation, so an energy column can never
disagree with a velocity column.

## Coverage

The curated section covers the loads someone is most likely to compare. The
extended reference set adds every cartridge in Wikipedia's [Table of handgun and
rifle cartridges](https://en.wikipedia.org/wiki/Table_of_handgun_and_rifle_cartridges)
that has usable published data, plus current-production rounds (`.22 ARC`, 6.5
PRC, 7mm PRC, `.300 PRC`, `.277 Fury`, 8.6 Blackout, `.400 Legend`) and shotgun
loads that the Wikipedia table does not include (10 ga, 16 ga, 20 ga target,
3″ 00 buck, sabot slugs, `.410` slug).

Cost per round for the extended rows is a heuristic based on how many
manufacturers list the cartridge and how large the case is. It is a ranking aid,
not a price quote.

## Data caveats (deliberate, and stated on the page)

- **Curated rows are typical, not maximum loads.** Pistol ≈ 4″, rifle ≈ 22–24″,
  shotgun ≈ 28″. The same cartridge in a different barrel reads differently — that
  is physics, not an error in the table.
- **Wikipedia rows are built from independent maxima.** The source table reports
  the highest velocity and the highest energy it found, which may come from
  different loads. To keep each row physically coherent, bullet weight is derived
  from the published momentum column (or from velocity and energy when momentum
  is missing). The resulting energy can therefore differ from the source table's
  maximum-energy figure.
- **Shotgun rows use the whole payload** (9 pellets of 00 buck, a 1 oz slug).
  Their energy is real, but their power factor is not comparable to a single
  projectile, and the page says so.
- **Cost per round is a rough retail estimate** used only for relative ranking.

## Layout and interaction

- The table spans the full window width; it is a reference grid, so there is no
  reason to squeeze it into a reading column.
- Each row carries the cartridge's origin, introduction year, bullet diameter,
  and case length under its name, plus the usual bullet-weight range in the
  bullet cell. Those fields came from the detail panel because they answer
  questions people ask while scanning, not after clicking.
- Sticky header row; the load column stays pinned on narrow screens so you never
  lose track of which row you are reading.
- Sortable headers use `aria-sort`; the default is energy, descending, because
  that is what most comparisons are actually about. Clicking a header cycles
  descending → ascending; text columns start ascending.
- Energy cells draw a logarithmic bar scaled to the highest-energy load in the
  whole dataset, so the bar means the same thing no matter what is filtered out.
  A linear scale would collapse everything below `.50 BMG` once the anti-materiel
  rounds are included.
- Scrollbars inside the table and on the page are themed to match the panel;
  the default light scrollbar reads as a rendering bug on a dark surface.
- Rows are `tabindex="0"` and toggle detail with Enter/Space as well as click.
- Empty filter states keep the summary line honest rather than showing a blank
  table.

### Narrower windows

Columns drop in priority order rather than shrinking into unreadable slivers:
typical use below 1300 px, cost and recoil below 1050 px, introduction year
below 900 px, and bullet/velocity/power factor on phones.

### On a phone

![Mobile view](images/mobile.png)

Below 720 px the table keeps only the load and its energy, which fits without
sideways scrolling; the name keeps its origin-and-dimensions subline. The
category chips wrap, the unit selector drops to its own row, and the detail rows
still work.

## Tests

`tests/ballistics.test.mjs` (node:test, no dependencies) checks:

- reference energies against hand-computed values (9mm 124/1150 ≈ 364 ft·lb),
- the `v²` relationship,
- unit conversions, including momentum in lbf·s,
- that every load carries the fields the table renders,
- unique ids (row expansion is keyed on them),
- that the extended reference set is present (≥290 loads, Wikipedia provenance,
  plausible bullet weights, spot checks for the long tail),
- that curated rows carry the same origin/year/dimension metadata as the
  reference set,
- that every `commonGrains` range is ordered and contains the load it describes,
- introduction years that fall between 1800 and today,
- energy ordering that matches shooter intuition (`.22 LR < 9mm < .223`,
  `.308 < .300 Win Mag`, and the 1 oz 12 ga slug outgunning a .30-06).

```
node --test tests/*.test.mjs
```

`tests/interaction.check.mjs` drives the real page over the Chrome DevTools
Protocol — no Playwright install and no browser download, which matters on this
NixOS host — and asserts filtering, sorting, row expansion, the unit toggle, and
the empty state:

```
node server.mjs &
google-chrome --headless=new --no-sandbox --remote-debugging-port=9222 \
  --user-data-dir=/tmp/ammo-chrome about:blank &
APP_URL=http://localhost:5113/ node tests/interaction.check.mjs
```
