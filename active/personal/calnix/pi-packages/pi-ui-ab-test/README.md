# pi-ui-ab-test

Pi extension that gives the model an interactive A/B testing workflow for UI and visual changes.

## What it does

- adds an `ab_test_visuals` tool the model can call
- nudges the model to create two concrete visual variants for UI/design/image-look requests
- displays both options in an interactive picker
- shows preview images inline when image paths are provided
- returns the user's chosen variant so the model can continue with the winning look

## How the model should use it

When working on a UI or visual change, the model should:

1. create two variants, `A` and `B`
2. optionally generate or save preview images/screenshots for each variant
3. call `ab_test_visuals` with:
   - a title/question
   - labels and summaries for both variants
   - relevant artifact paths
   - preview image paths when available
4. continue with the chosen variant after the tool returns the user's preference

## Local test

```bash
cd pi-packages/pi-ui-ab-test
node --test tests/ab-test-utils.test.mjs
pi -e .
```

## Install from local path

```bash
pi install ./pi-packages/pi-ui-ab-test
```
