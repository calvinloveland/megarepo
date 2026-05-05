# UI Automation Demo

This demo shows off the new Pi UI automation techniques without requiring a live Pi window first.

It walks through:

1. generating a baseline/current screenshot pair
2. producing `diff.png` + `diff.json`
3. running the heuristic scoring prompt
4. invoking the bounded `/ui-autopolish` subagent workflow

## 1. Generate demo artifacts

From `active/personal/calnix/` run:

```bash
python3 ./pi-skills/pi-extension-testing/scripts/demo_ui_automation.py
```

This creates a demo bundle under:

```text
artifacts/ui-automation-demo/
```

Expected files:

- `baseline.png`
- `current.png`
- `diff.png`
- `diff.json`
- `README.md`

## 2. Re-run the diff manually

```bash
python3 ./pi-skills/pi-extension-testing/scripts/compare_pi_screenshots.py \
  artifacts/ui-automation-demo/baseline.png \
  artifacts/ui-automation-demo/current.png \
  --output-dir artifacts/ui-automation-demo
```

That lets you inspect the diff tooling directly.

## 3. Run the heuristic score prompt

```bash
pi -p --no-extensions \
  -e ./pi-packages/pi-ui-heuristic-critique \
  @artifacts/ui-automation-demo/baseline.png \
  @artifacts/ui-automation-demo/current.png \
  @artifacts/ui-automation-demo/diff.png \
  "/ui-heuristic-score demo dashboard regression"
```

What to look for:

- overall score
- severity counts
- ship decision
- whether it recommends A/B testing or direct revision

## 4. Run the bounded subagent workflow

```bash
pi -e ./pi-packages/pi-subagents
```

Then run:

```text
/ui-autopolish tighten the demo dashboard layout using artifacts/ui-automation-demo/diff.json and artifacts/ui-automation-demo/README.md as context
```

What to look for:

- a bounded worker/reviewer loop
- focus on the top 1-2 issues instead of broad rewrites
- recommendation to use `ab_test_visuals` if two plausible directions remain

## 5. Live-window version

Once you want to use the same flow on a real Pi surface, replace the synthetic artifacts with the live capture loop:

```bash
python3 ./pi-skills/pi-extension-testing/scripts/ui_regression_loop.py \
  --output-dir artifacts/ui-regression \
  --skip-judge
```

Then remove `--skip-judge` when you want Pi to invoke the scoring prompt automatically.

## Why this demo matters

This demo separates the layers clearly:

- **artifact generation** — `demo_ui_automation.py`
- **pixel evidence** — `compare_pi_screenshots.py`
- **machine-friendly review** — `/ui-heuristic-score`
- **bounded automated polish** — `/ui-autopolish`

So you can demo each part independently before using the full loop on a real UI.
