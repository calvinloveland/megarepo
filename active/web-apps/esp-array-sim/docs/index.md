# ESP Speaker Array Simulator — Design

Goal: a mesh of ESP32 nodes (each with a speaker **and** a microphone) placed arbitrarily around a
room that **self-localizes using audio** and then **recreates a 5.1 experience** by panning the
canonical channels onto whichever speakers it actually found. This simulator lets us develop and
test those algorithms before committing to hardware.

## Pipeline

```
random layout  →  calibration sweep (chirps)  →  TOA captures  →  joint position+clock solve
   (N nodes)        (one node emits at a time)      (shared clock)   (Levenberg–Marquardt)
   world.mjs        capture.mjs                                       localize.mjs
                                            ↓
                    Procrustes align + mirror resolve  →  5.1→speaker panning  →  canvas
                         localize.mjs                        surround.mjs            app.js
```

`scenario.mjs` wires the stages together; both the UI (`app.js`) and the tests drive it through
that single entry point.

## Node model (`world.mjs`)

Each ESP32 gets a true 2-D position, a **residual clock offset** (left over after a coarse WiFi
clock-sync that the real firmware would run first), and mic jitter (chirp cross-correlation error).
Layouts are produced by a seeded `mulberry32` RNG so every scenario is reproducible.

## Capture model (`capture.mjs`)

For an emission from node *s* at shared-clock time *T<sub>e</sub>*, every listener *i* records

> a<sub>e,i</sub> = T<sub>e</sub> + dist(s, i) / c + offset<sub>i</sub> + jitter

The emitter listens to its own speaker through a tiny fixed self-path, which **anchors each node's
clock offset** (the only value that pins it). Because every node emits once and everyone listens,
the full pairwise distance matrix is observable.

## Localization (`localize.mjs`)

We minimize ∑ residual² over all node positions **and** clock offsets jointly with
Levenberg–Marquardt + a numerical Jacobian. The gauge fixes N0 at the origin and N1 on the +x axis,
leaving the unobservable translation/rotation; the speed of sound fixes scale. We multistart from
the grid init plus random restarts to dodge local minima.

### The mirror ambiguity

Pure TDOA can't distinguish a layout from its mirror image across the N0–N1 axis — both satisfy
every acoustic constraint identically. The simulator resolves it by Procrustes-aligning **both**
chiralities to ground truth and keeping the lower-error one. **Real firmware will resolve handedness
from a known cue** (a designated "front" anchor / which wall the TV is on); the simulator takes that
cue from ground truth, and it is the *only* place truth is used — it never informs the positions or
offsets the solver produces.

## Surround mapping (`surround.mjs`)

Each real speaker is a directional source at the angle it makes from the listener's sweet spot. Each
virtual 5.1 channel has an ITU-R BS.775 azimuth (L –30°, R +30°, C 0°, Ls –110°, Rs +110°, LFE
omnidirectional). A channel is panned with a cosine-power law `g ∝ max(0, cos Δθ)^p`, distance-
compensated, and normalized so the channel keeps constant energy. The exponent and distance law are
the same knobs the firmware will expose. This deliberately degrades gracefully for sparse layouts
where strict VBAP would leave channels silent.

## The graph below unobservable rigid motion

Procrustes is closed-form for 2-D (rotation angle θ = atan2(B, A) from the centered
cross-covariance), translation + rotation only — no scaling.

## Tests

`node --test` covers acoustics constants, the mirror-resolved localization accuracy on random and
deterministic seeds, the Surround channel routing edge cases, and a live server smoke test. The
solver recovers random 6–10-node meshes within a couple of centimetres across 200 seeds.

## DSP block (`dsp.mjs`)

The signal-processing block the ESP32 firmware will run on each capture, surfaced in
the simulator so we iterate the *real* estimator here:
- `linearChirp(opts)` — linear-FM chirp template, Hann-windowed to tame correlation sidelobes.
- `matchedFilter(signal, template)` — normalized cross-correlation.
- `estimateTOA(signal, template, sr)` — argmax-|correlation| TOA. **Documented limitation:**
  it returns the *strongest* peak, so a loud non-line-of-sight echo can bias it (exercised by a
  test). Firmware will guard with earliest-peak / echo-rejection.

The capture module still uses the closed-form delay; the next milestone routes captures through
the matched filter with image-source wall echoes so the estimator — not the geometry — drives
localization and its failure modes are visible.

## Open follow-ups

- Route `capture.mjs` through `dsp.mjs` validated estimator with image-source wall echoes, so
  the estimator — not the closed-form delay — drives localization and its failure modes
  (loud echoes, NLO) are observable.
- Earliest-peak / NLO-echo rejection for the TOA estimator.
- Browser E2E (Playwright) once a Nix-managed Chromium is wired via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- Per-listener clock skew (not just offset) and the joint skew/offset solver.
- Distributed, streaming variant of the solver suitable to actually run on ESP32s (mesh gossip).
- Real audio I/O on the simulator (Web Audio chirp playback + capture) before porting to firmware.
- Firmware skeleton (ESP-IDF) for one node: chirp emission, mic capture, cross-correlation TOA,
  clock-sync protocol, surround gain application.