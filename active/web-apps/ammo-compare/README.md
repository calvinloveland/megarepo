# Ammo Comparison Table

A single-page reference that puts common centerfire, rimfire, and shotgun loads
side by side, with muzzle energy and power factor **derived** from bullet weight
and velocity rather than transcribed from a chart.

![Desktop view](docs/images/desktop.png)

- Every cartridge in Wikipedia's handgun and rifle table, plus shotgun loads and
  current-production rounds such as 6.5 PRC, 7mm PRC, `.300 PRC`, and `.277 Fury`.
- Rows carry the cartridge's origin, introduction year, bullet diameter, case
  length, and the usual bullet-weight range — not just the numbers for one load.
- Each row also draws a cartridge profile generated from its case length, bullet
  diameter, and bullet weight, so the shapes are data, not bespoke artwork.
- Full-width table on a wide screen, with columns shedding in priority order as
  the window narrows.
- Sort any column, filter by category, search across names, uses, and platforms.
- Toggle imperial (grains · fps · ft·lb) and metric (g · m/s · J) units.
- Cost is priced only for current commercial loads; obsolete, surplus, and
  collector cartridges are left blank instead of given an invented figure.
- Click a row for platforms, reference metadata (nation, year, bullet diameter,
  case length, BC), and shooting notes.
- On a phone it collapses to loads and their energy, with no sideways scrolling.

No build step, no dependencies: plain HTML, CSS, and native ES modules. Registered
in the megarepo launcher as `ammo-compare` on port 5113.

```
node server.mjs                    # http://localhost:5113
node --test tests/*.test.mjs       # ballistics + data integrity
```

The interaction checks need a running server and a remote-debugging Chrome; see
[`docs/index.md`](docs/index.md#tests). Numbers live in
[`data/ammo.js`](data/ammo.js), math in [`lib/ballistics.js`](lib/ballistics.js).
