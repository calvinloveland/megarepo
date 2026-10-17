# Running the event

## Before
```bash
python dev/selftest.py && python dev/selftest_agent.py && python dev/selftest_trainer.py && python dev/selftest_server.py
```
All four must report every test passed. `dev/selftest_viewer.py` (needs `pip install playwright`) also drives the web page.

- **Freeze the world.** The speed, turn, and tag constants are still marked provisional (`env_spec.json`, key `provisional`). Playtest,
  decide, then bump `env_version` and the version in `CONTRACT.md` together. Agent files carry the version and are rejected on a mismatch.
- **Pick a secret seed.** Any text. It decides all five tournament arenas and every start position. Never share it.
- **Internet once:** the first `python server.py` run downloads three.js for the 3D view and caches it in `viewer/vendor/`.
  If that fails, the viewer uses the CDN, or a flat 2D view.

## Practice and the real thing
```bash
python server.py --secret "practice seed" --log practice.jsonl          # drag two files in, watch the series
python server.py --secret "THE REAL SECRET" --host 0.0.0.0              # let a second screen connect (same network)
python match.py a_chaser.json b_evader.json --seed "THE REAL SECRET" --out series.json    # no browser needed
```
`series.json` can be dropped into the viewer later. The same secret always gives the same arenas and the same result.
`--log` appends one line per series (names, score, winner, each match's winner) for sorting out your bracket.
A chaser file and an evader file make a pairing. To score two entrants fairly, play both ways (A chasing B, then B chasing A).

## Things to know
- Everything is deterministic: same files, same seed, same outcome.
- A file that fails validation is refused with plain-language reasons. Participants can run the same check themselves.
- Per-series time is about one second, even for the largest allowed networks.
- The server only reads the viewer folder and `baselines/`. It binds to this computer only unless you pass `--host`.

## Removing the scaffolding for a final package
The trainer, wanderers, starters, and baselines are conveniences, and none of them is part of the locked competition.
- To drop the wanderer: delete `wanderers.py`, remove its import and the `"wanderer"` branch in `trainer.py` (`partner_for`,
  `OPPONENT_CHOICES`), and change the default `--opponent`. Then update `dev/selftest_trainer.py`.
- To drop the baselines: delete `baselines/` (the viewer's "Try the baselines" button then reports they cannot be loaded; remove it from `viewer/index.html`).
- To drop the starter weights: delete `starters/` and `seed_network.py`. The trainer then starts from random weights.

## Known limitations
- The 3D view could not be tested in the build environment (no way to download three.js there). It was exercised against a stand-in;
  the flat 2D view was tested in a real browser. Check the 3D view once on your machine.
- The baseline chaser is capable (about 35% against the scripted evader, which is a strong evader). The baseline evader is weak (it survives about
  one match in seven against the baseline chaser, and almost never against the scripted chaser). The scripted evader plans with the whole map and
  the network only sees a small window, so the copy loses most of its skill; fine-tuning it by evolution made it worse on unseen arenas. Both are produced by `dev/make_baselines.py` (imitation of the scripted bots with DAgger rounds, about
  5 minutes each; `python dev/make_baselines.py chaser 8000 4 --write`).
- With the scripted bots the chaser wins about 78% of matches, so the roles may be balanced in the chaser's favor. Playtest before freezing the constants.

## What to hand out
Everything except the `dev/` folder (tests and the baseline-rebuild tool) is what participants need. You may delete `dev/` from the copy you
distribute, or leave it in; nothing in the participant workflow depends on it. Keep it yourself to re-run the checks and rebuild baselines.

## Diamond baselines
`baselines/baseline_chaser_diamond.json` and `baseline_evader_diamond.json` (names "Baseline Chaser Diamond" / "Baseline Evader Diamond") read 17 inputs: the centre block cell and the 8 cells exactly two steps away, instead of all 13 checkerboard cells. The locked catalog has no cells at (+-1,0) or (0,+-1), so a full 13-cell diamond would need a contract change and an env_version bump. Rebuild with `python dev/make_baselines.py chaser 8000 4 --diamond --write` (about 4 minutes each).
