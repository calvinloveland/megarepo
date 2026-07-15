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
channel** highlights which real speakers each virtual 5.1 channel is routed to. The UI now also has
built-in **presets** (dry matched DSP, hard living-room reverb, lossy distributed mesh, clock-skew +
shot averaging) and keeps the full scenario in the URL fragment, so you can copy a share link and
reproduce an interesting case exactly. The controls are now also context-aware: knobs that the
current capture mode ignores are dimmed/disabled, and a small helper line explains which settings
actually matter for the chosen mode. In distributed mode there's also an advanced toggle to switch
from closed-form mic rows to **matched-filter DSP rows**, which makes reverb / earliest-peak matter
across the mesh too. Matched paths now expose **noise σ** as a first-class control, so you can study
SNR sensitivity directly in both one-off runs and the planning panels.

For hardware planning, `npm run sweep` answers “how many ESP32 nodes do I need?” by printing the
minimum node count that keeps the **worst-case** localization error under a target (5 cm by default)
for each capture mode / reverb level. The browser now exposes the same analysis in a **Hardware
sizing** panel, scoped to the current mode / reverb / robust / averaging settings, so you can answer
that question without leaving the app. `npm run bench` answers the complementary performance
question: how long a one-time calibration solve takes as node count grows, and the browser mirrors
that too in a **Calibration latency** panel for the current algorithm settings. Both browser panels
now surface a one-line takeaway summary, and can export their results (text for latency, text/CSV
for sizing). The UI also includes an evidence-based **Known risks / suggestions** panel that flags
regimes the simulator has already proved are risky and now offers one-click fixes for common issues
(enable earliest-peak, enable robust LM, increase shot averaging, or jump to the hardened preset).
proved are risky (for example, heavy reverb with plain matched TOA, or very lossy distributed mesh).

## How it works

See [`docs/index.md`](docs/index.md) for the full design.

## Status

Sandbox/early prototype — algorithm development, not productized. No browser E2E yet (see
follow-ups in docs).