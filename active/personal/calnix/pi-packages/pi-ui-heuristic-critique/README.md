# pi-ui-heuristic-critique

Prompt-only Pi package for screenshot-first heuristic UI critiques.

## What it does

- adds a `/ui-heuristic-critique` prompt template
- pushes the review to start from screenshots or visual artifacts before code-level advice
- critiques UI using practical heuristics instead of vague taste-based comments
- returns prioritized issues, concrete evidence, and actionable recommendations
- can recommend when two plausible remedies should become an `ab_test_visuals` comparison and when rationale capture would help the next iteration

## Best use cases

Use this when you want Pi to critique:

- screenshots from a local app or website
- design mockups or staging captures
- before/after UI changes
- specific screens such as forms, dashboards, settings pages, tables, and onboarding flows

## Install from local path

```bash
pi install ./pi-packages/pi-ui-heuristic-critique
```

## Try it immediately

```bash
pi -e ./pi-packages/pi-ui-heuristic-critique
```

Then run:

```text
/ui-heuristic-critique dashboard filters and empty state
```

Attach or reference screenshots when possible for the strongest critique.

If the critique reveals two credible fixes, turn them into an `ab_test_visuals` comparison and set `captureRationale: true` when the winner's explanation will matter in the next pass.

## Companion skill

For when to use this prompt and how to structure screenshot-first reviews, see the companion repo-local skill:

- `../../pi-skills/pi-ui-heuristic-critique`

## Local test

```bash
node --test ./pi-packages/pi-ui-heuristic-critique/tests/package.test.mjs
```
