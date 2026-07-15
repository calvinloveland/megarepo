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

`speakerCompensation` equalizes the discovered array to the sweet spot: every speaker is
delayed by (maxDist − itsDist)/c and attenuated by itsDist/maxDist so all contributions arrive
simultaneously and equally loud — the time/loudness alignment a real surround processor applies
after localization (surfaced in the UI report as the max delay spread + gain range).

## Multi-shot averaging (`capture.mjs` averagedCaptures)

The firmware's repeated-chirp calibration mode: each pairwise TOA is measured `avgShots` times with
independent per-shot jitter+noise (threaded via a `shotIdx` that salts the per-arrival RNG), and we
report the **median** arrival per (emitter, listener). Median — not mean — rejects occasional
shot-level outliers and turns single-shot ~few-cm matched-filter jitter into a tighter estimate.
At high capture noise (noiseSigma 0.5) median-of-3 roughly halves the localization error vs.
single-shot; on the closed path it cuts the mic-jitter floor in half. `scenario.avgShots` toggles it
(default 1 = single-shot, unchanged baseline); UI adds an "Emission shots" input and the report notes
the median-of-N shots.

## Hardware-sizing recommendation (`sweep.mjs`)

The sweep CLI now also answers the question you actually care about before buying
parts: **how many ESP32 nodes do I need?** `minNodesFor(cells, targetM)` walks a
finished sweep and, for each (captureMode, reflCoef) group, reports the smallest
node count whose *worst-case* alignment error (across all room draws tried) meets
the target — or `null` (infeasible in the tested range) with the best-available
worst error, so you know the regime is genuinely hard rather than just "didn't try
big enough." `npm run sweep` prints it after the accuracy table; `--target-m`
sets the worst-case target (default 5 cm). The browser exposes the same analysis
in a **Hardware sizing** panel that runs the sweep for the current UI settings
(mode / reverb / robust / averaging / skew) and reports the minimum recommended
node count inline. A summary card surfaces the key recommendation without having
to read the whole table, and the panel can also export the results as plain text or CSV.

The sweep reveals two actionable findings the firmware must respect:

1. **Plain matched-filter TOA cannot survive a reverberant room.** At reflCoef
   0.8 the worst-case error blows up to tens of cm even at 10 nodes — loud NLOS
   echoes get correlated above the true direct peak, and the estimator locks
   onto the wrong arrival. The 5 cm target is infeasible in the tested range.
2. **Earliest-peak selection + Huber-robust LM restore feasibility at ≤8
   nodes.** Rejecting the loud-late echoes (earliest-peak) and down-weighting
   any survivor that disagrees with the consensus (robust) collapses the worst
   case back under 5 cm at modest node counts. The regression test
   `robust LM + earliest-peak make a hard-reverb room feasible where plain
   matched fails` pins this in CI — the firmware MUST ship earliest-peak +
   robust, not plain matched, to survive a real living room.




The centralized path assumes one oracle has the whole observation matrix. The real ESP32 system is
distributed: each node only ever records the arrivals at ITS OWN microphone (its "listener row"),
then the mesh gossips those rows so any node can assemble the full matrix and run the joint solver.
`mesh.mjs` simulates that data flow — partition by listener, a full-broadcast gossip round
(n·(n−1) messages), and assemble — and proves the gossiped matrix equals the centralized one
(same multiset of (emitter,listener,arrival) observations), so the distributed protocol is a
zero-fidelity-loss drop-in for the centralized path. It also simulates **packet loss** (`meshLoss`):
a fraction of listener-row broadcasts fail to arrive, the assembler sees a partial matrix, and the
over-determined LM solver (with robust down-weighting) still recovers the geometry. Tests prove loss
drops rows and sets `meshLost`, and that 30% loss with 8 nodes still localizes within 15 cm — the
degraded-but-still-localizable regime the firmware must tolerate. `scenario.captureMode: 'distributed'`
runs the whole pipeline distributed and reports `meshMessages`/`meshLost`. UI surfaces it as a
capture-mode option plus a mesh packet-loss slider.

## Solver benchmark (`bench.mjs`)

Before firmware, we still need to know whether the joint LM is *fast enough* to
run as a one-time calibration solve on a future mesh. `bench.mjs` measures
wall-clock vs. node count using the realistic hardened path (matched capture +
earliest-peak + robust IRLS + 8 multistarts). The current benchmark on this
host is roughly:

- 4 nodes: ~35 ms
- 8 nodes: ~210 ms
- 12 nodes: ~640 ms

So the solver is comfortably inside a “re-seat the couch / run calibration once”
budget even at 12 nodes. The cost scales roughly quadratically-ish, matching the
O(n²) observation matrix times multistart/IRLS iterations, and the benchmark has
regression tests to catch accidental algorithmic blowups.

Run it with `npm run bench` or `node bin/bench.mjs --nodes 4,8,12 --repeats 3`.
The browser mirrors it in a **Calibration latency** panel that benchmarks the
current UI settings (mode / reverb / robust / averaging / skew) across node
counts and prints the per-count wall-clock right in the app. A summary card
surfaces the worst observed solve time, and the panel can export the benchmark
as plain text.

## Evaluation sweep (`sweep.mjs`)

`runSweep` runs the localization pipeline across a (node × capture-mode × wall-reflection)
grid of cells and reports median / p90 / worst alignment error and a success rate per cell, so we
can decide when the algorithm is ready without hardware. Deterministic for a fixed `seedBase`. CLI:
`npm run sweep` (or `node bin/sweep.mjs --trials 10 --nodes 4,6,8 --refl 0,0.3,0.6`). One finding the
sweep surfaces: the matched-filter path with sub-sample refinement can be *more* accurate than the
closed-form path at free field, because the closed form carries a per-arrival gaussian jitter floor
(20 µs ≈ 0.7 cm) the matched filter's parabolic peak fit can beat.

## Robust localization (`localize.mjs`, opts.robust)

Real captures contain gross TOA outliers — the documented failure mode where a loud NLOS echo gets
mis-identified as the direct arrival (a ±~ms jump ≈ tens of cm). Ordinary least-squares LM is wrecked
by these; enabling `robust` sets a Huber δ and switches the driver to IRLS (per-iteration weights,
w=1 inside δ, δ/|r| outside), down-weighting the outliers and converging on the inlier geometry.
With ~15% random-signed 2 ms outliers, OLS lands ~17 cm off while robust recovers to ~2 cm, and the
final per-observation weights drop on exactly the corrupted arrivals. MMA disable to keep OLS as the
baseline.

## End-to-end rendering (`render.mjs`)

`renderChannelAtSweetSpot` synthesizes the actual soundfield a listener receives when one virtual
5.1 channel's content (any waveform) is replayed through the discovered array: each copy is placed
at pan-gain × compensation-gain and delayed by (compensation delay + speaker→listener propagation).
This is the end-to-end correctness proof — pure node, no browser. With compensation every copy lands
at one instant (impulse concentration → 1.0, a single coherent peak); without it they smear across
the distance range (concentration < 1). Tests assert the alignment math, the concentration gain, and
that all six channels render audibly. The UI's "Play test tone" reports the compensated-vs-
uncompensated concentration per channel.

`channelSeparation` measures spatial fidelity end-to-end: the pan-gain-weighted mean arrival azimuth
of each channel at the sweet spot vs its intended ITU azimuth (Δ°). It surfaces the real cost of a
random layout — a channel with no nearby speaker bleeds toward its neighbours, and the error grows
— and the panner sharpen/bleed trade-off (a higher cosine exponent concentrates each channel at the
expense of graceful degradation on sparse arrays). Tests prove ~0° error for an aligned speaker, an
ITU ring reproduces all five channels with a sharp panner, directional polarity (L→left, R→right)
holds on mismatched layouts, and separation improves monotonically as the exponent grows.

## The graph below unobservable rigid motion

Procrustes is closed-form for 2-D (rotation angle θ = atan2(B, A) from the centered
cross-covariance), translation + rotation only — no scaling.

## DSP block (`dsp.mjs`)

The signal-processing block the ESP32 firmware will run on each capture, surfaced in
the simulator so we iterate the *real* estimator here:
- `linearChirp(opts)` — linear-FM chirp template, Hann-windowed to tame correlation sidelobes.
- `matchedFilter(signal, template)` — normalized cross-correlation.
- `estimateTOA(signal, template, sr, opts)` — TOA via matched filter, with two modes: `strongest`
  (argmax-|correlation|; a loud **later** echo can hijack it — documented & tested) and
  `earliest` (earliest clustered peak above a threshold — rejects loud later echoes).

## Realistic capture path (`capture.mjs` + `room.mjs`)

Beyond the closed-form baseline, captures can go through the **real** estimator: `room.mjs`
produces image-source wall reflections (+ axis-aligned occluders that drop the line-of-sight
direct path → non-line-of-sight case), `capture.mjs` builds the resulting waveform (direct +
echoes + noise) and `estimateTOA` from `dsp.mjs` recovers a TOA. `scenario.captureMode: 'matched'`
switches this on in a full run; `'closed'` (default) keeps the closed-form delay as an isolated
baseline. The UI exposes a capture-mode selector, a wall-reflection coefficient, and echo ripples
on the room canvas.

The UI also ships with presets for the simulator's most interesting stories:
- dry matched DSP
- hard living-room reverb (hardened with earliest-peak + robust)
- lossy distributed mesh (30% packet loss)
- clock-skew + multi-shot averaging

and it serializes the full control state into the URL fragment (`#n=8&mode=distributed&...`), so
an interesting success/failure case is shareable and exactly reproducible from a link.

A pure `advisories.mjs` ruleset also feeds the UI's **Known risks / suggestions** panel. These are
not vague design opinions: each rule corresponds to a failure mode the simulator already demonstrated
and tested — e.g. heavy reverb + plain matched TOA, very high mesh packet loss, or minimal 4-node
geometry. The panel explains *why* a regime is risky and which knob (earliest-peak, robust LM,
more nodes, shot averaging) usually fixes it. For common cases it now exposes one-click fixes
right in the panel (enable earliest-peak, enable robust LM, bump to 3-shot averaging, or jump to
the hardened reverb preset).

A single-mic matched filter with sub-sample parabolic refinement around the |correlation| peak
lands the TOA within ~2 cm (near the sample-quantization floor); a fractional-lag chirp is recovered
to <0.15 samples. The estimator has two modes:
- `strongest` (default): argmax-of-|correlation|. A loud **later** echo can hijack it
  (documented; tested).
- `earliest`: earliest clustered peak above `peakThreshold`×global max — rejects loud later echoes
  when the direct arrival is strong enough.

## Tests

`node --test` (40 specs): acoustics, the Jacobian (analytic vs numeric), the JOINT LM solver on
random/deterministic seeds (mirror-resolved, ~cm free-field), image-source geometry + occluder LOS,
mild-reverb & hard-wall matched capture, occluder echo bias, earliest-vs-strongest echo handling,
nearby TOA matched-filter accuracy, the surround routing edge cases, and a live server smoke test.

## Clock model & skew estimation (`world.mjs`, `localize.mjs`)

Each node's clock is `offset_i + (1 + skew_i) · true_time` — a residual offset *and*
a fractional rate error (skew) left after the coarse WiFi sync, mirroring real crystal
tolerance. `cfg.clockSkew` arms random skews (±50 ppm by default) and the joint LM
solver estimates one skew per node (gauge: skew₀ = 0) alongside positions+offsets.
The extra free block is opt-in (`withSkew`); the free-field baseline is unchanged.
Observability is weak over the short (~1.8 s) default sweep, so recovery is loose —
a longer calibration sweep or a higher-skew crystal tightens it. Tests show skew-aware
estimation recovers geometry and skews, while ignoring skew degrades it.

## Open follow-ups

- Browser E2E (Playwright) once a Nix-managed Chromium is wired via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- Distributed, streaming variant of the solver suitable to actually run on ESP32s (mesh gossip).
- Real audio I/O on the simulator (Web Audio chirp playback + capture) before porting to firmware.
- Register esp-array-sim in scripts/check_web_app.py with a generic node-app checker.
- Firmware skeleton (ESP-IDF) for one node: chirp emission, mic capture, cross-correlation TOA,
  clock-sync protocol, surround gain application.