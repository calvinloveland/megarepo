---
description: Run a bounded worker/reviewer UI polish chain using existing screenshot regression artifacts
argument-hint: "[ui-task-or-screen]"
---
Use the subagent tool with the chain parameter to run a bounded UI polish workflow for: $@

Assume the repo may already contain screenshot regression artifacts under `artifacts/ui-regression/`, especially:

- `baseline.png`
- `current.png`
- `diff.png`
- `diff.json`
- `report.md`

Execute this chain:

1. First, use the `worker` agent to inspect the relevant UI files and the regression artifacts (when present), then make **one focused polish pass** for "$@".
2. Then use the `reviewer` agent to critique the result, explicitly referencing the regression artifacts and recommending either:
   - done
   - one more small polish pass
   - convert the next step into `ab_test_visuals`
3. If the reviewer recommends exactly one more small polish pass, run `worker` once more using the reviewer's findings via `{previous}`.
4. Finish with `reviewer` again to decide whether the UI is done, still needs A/B comparison, or should stop.

Constraints:

- keep the loop bounded to at most two worker passes
- prefer top 1-2 fixes, not broad rewrites
- if two plausible design directions remain, do **not** guess; recommend `ab_test_visuals`
- if later polish will depend on why a human chooses a variant, recommend `captureRationale: true`
- keep handoff output compact and file-specific
