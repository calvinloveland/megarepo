# Ammo Comparison Table

A single-page reference that puts common centerfire, rimfire, and shotgun loads
side by side, with muzzle energy and power factor **derived** from bullet weight
and velocity rather than transcribed from a chart.

![Desktop view](docs/images/desktop.png)

- Sort any column, filter by category, search across names, uses, and platforms.
- Toggle imperial (grains · fps · ft·lb) and metric (g · m/s · J) units.
- Click a row for the platforms and shooting notes behind the numbers.
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
