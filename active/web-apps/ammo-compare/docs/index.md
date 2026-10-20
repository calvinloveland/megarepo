# Ammo Comparison Table — Design

![Desktop view](images/desktop.png)

One page, one job: let you compare a shelf of ammunition by the numbers that
actually differ between loads. Everything else — units, sorting, filtering — is
there so the comparison is quick, not so the page has features.

## Where the numbers come from

`data/ammo.js` stores only what a load *is*:

```js
{ id, name, category, bulletGr, velocityFps, costPerRound, recoil, use, platforms, notes }
```

Derived values are never stored. `lib/ballistics.js` computes them:

| Value | Formula | Notes |
|---|---|---|
| Muzzle energy (ft·lb) | `gr × fps² / 450437` | `450437 = 2 · 7000 · 32.174` folds in grains-per-pound and gravity |
| Muzzle energy (J) | `ft·lb × 1.3558179` | |
| Power factor | `gr × fps / 1000` | Imperial shooting-sports momentum figure; 125 minor / 165 major |
| Metric momentum | `kg × m/s` | What the metric toggle shows in that column |
| Velocity (m/s) | `fps × 0.3048` | |
| Bullet mass (g) | `gr × 0.06479891` | |

Keeping the math in one module is the point: the UI, the tests, and anything
added later all read the same implementation, so an energy column can never
disagree with a velocity column.

## Data caveats (deliberate, and stated on the page)

- **Typical, not maximum loads.** Pistol ≈ 4″, rifle ≈ 22–24″, shotgun ≈ 28″.
  The same cartridge in a different barrel reads differently — that is physics,
  not an error in the table.
- **Shotgun rows use the whole payload** (9 pellets of 00 buck, a 1 oz slug).
  Their energy is real, but their power factor is not comparable to a single
  projectile, and the page says so.
- **Cost per round is a rough retail estimate** used only for relative ranking.

## Layout and interaction

- Sticky header row; the load column stays pinned on narrow screens so you never
  lose track of which row you are reading.
- Sortable headers use `aria-sort`; the default is energy, descending, because
  that is what most comparisons are actually about. Clicking a header cycles
  descending → ascending; text columns start ascending.
- Energy cells draw a bar scaled to the highest-energy load in the whole dataset
  (not the filtered view), so the bar means the same thing no matter what is
  filtered out.
- Rows are `tabindex="0"` and toggle detail with Enter/Space as well as click.
- Empty filter states keep the summary line honest rather than showing a blank
  table.

### On a phone

![Mobile view](images/mobile.png)

Below 720 px the table keeps only the load and its energy, which fits without
sideways scrolling; bullet weight, velocity, power factor, recoil, cost, and use
reappear as the window widens. The category chips wrap, the unit selector drops
to its own row, and the detail rows still work.

## Tests

`tests/ballistics.test.mjs` (node:test, no dependencies) checks:

- reference energies against hand-computed values (9mm 124/1150 ≈ 364 ft·lb),
- the `v²` relationship,
- unit conversions,
- that every load carries the fields the table renders,
- unique ids (row expansion is keyed on them),
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
