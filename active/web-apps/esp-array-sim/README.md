# ESP Speaker Array Simulator

A simulator for a **mesh of ESP32 nodes**, each carrying a **speaker + microphone**, scattered
randomly around a room. The nodes localize themselves acoustically and then render a standard
**5.1** input onto their irregular, discovered layout — the first step toward a self-deploying
wireless surround system before touching real hardware.

## Why a simulator

We iterate the *algorithms* (acoustic localization, clock handling, surround panning) in the
browser without baking ESP32 firmware each time. The same pure ES modules that drive the canvas
are tested with `node --test`, so the physics/solver is one source of truth.

## Run

```bash
npm run check     # syntax + unit + server tests
npm start         # serve the UI at http://127.0.0.1:5193
npm run sweep     # localization-accuracy sweep across node counts & reverb (+ min node-count recommendation)
npm run sweep:csv # same sweep as CSV (for external plotting/analysis)
npm run bench     # solver wall-clock benchmark vs node count
```

Open the simulator, set the node count / room size / seed, hit **Run localization**, and watch the
calibration sweep, the recovered positions, and the 5.1→speaker mapping. **Play test tone per
channel** highlights which real speakers each virtual 5.1 channel is routed to.

For hardware planning, `npm run sweep` answers “how many ESP32 nodes do I need?” by printing the
minimum node count that keeps the **worst-case** localization error under a target (5 cm by default)
for each capture mode / reverb level. `npm run bench` answers the complementary performance question:
how long a one-time calibration solve takes as node count grows.

## How it works

See [`docs/index.md`](docs/index.md) for the full design.

## Status

Sandbox/early prototype — algorithm development, not productized. No browser E2E yet (see
follow-ups in docs).