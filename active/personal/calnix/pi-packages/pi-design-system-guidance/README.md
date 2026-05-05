# pi-design-system-guidance

Prompt-only Pi package for reusable design-system guidance during UI implementation and review tasks.

## What this package includes

- one reusable prompt template: `/design-system-guidance`
- guidance for shared-component reuse before one-off UI work
- accessibility, state-design, and responsive review reminders
- a built-in reminder to use screenshots or visual artifacts when available
- a built-in reminder to use `ab_test_visuals` when the user should choose between concrete UI directions
- guidance to capture the winner's rationale when that explanation will help the next design pass

## Install from local path

```bash
pi install ./pi-packages/pi-design-system-guidance
```

## Try it immediately

```bash
pi -e ./pi-packages/pi-design-system-guidance
```

Then invoke:

```text
/design-system-guidance tighten the settings screen layout and make the primary action clearer
```

## What the prompt emphasizes

- inspect existing shared UI primitives, layout patterns, and theme tokens first
- reuse or extend common components instead of duplicating styles
- cover interactive states, empty/error/loading states, and accessibility basics
- keep hierarchy, spacing, typography, and action priority consistent
- produce two concrete variants and use `ab_test_visuals` when visual direction is still uncertain

## Local tests

```bash
cd pi-packages/pi-design-system-guidance
node --test tests/package-metadata.test.mjs
```
