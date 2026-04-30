---
name: pi-publish-package
description: Validate and publish a Pi package to npm, including package metadata checks, npm auth verification, npm pack testing, and release steps for pi.dev gallery visibility.
---

# Publish a Pi Package to npm

Use this skill when the user wants to publish a Pi extension / skill / prompt / theme package to npm and optionally prepare it for the pi.dev gallery.

## When to use

- The user has a local Pi package and wants to publish it to npm
- The user wants a repeatable release checklist
- The user wants to verify package metadata before publishing
- The user wants to know whether an npm account is required

## Important facts

- **Yes, publishing to npm requires an npm account**.
- The machine must be authenticated with `npm login`.
- For a public **scoped** package, publish with:

```bash
npm publish --access public
```

- To show up in the pi.dev package gallery, the package should include:
  - `keywords: ["pi-package"]`
  - a `pi` manifest in `package.json`

## Package checklist

A Pi package should usually have:

- `package.json`
- `README.md`
- `LICENSE`
- `keywords` containing `pi-package`
- `pi.extensions`, `pi.skills`, `pi.prompts`, and/or `pi.themes`
- a valid package `name`
- a `version`
- optional but recommended:
  - `description`
  - `author`
  - `repository`
  - `homepage`
  - `bugs`
  - `publishConfig.access = "public"` for scoped public packages

## Validation helper

Run the helper script against a package directory:

```bash
~/code/megarepo/active/personal/calnix/pi-skills/pi-publish-package/scripts/check_publish_ready.py ~/pi-packages/calvin-pi-tools
```

Or from the repo copy:

```bash
./pi-skills/pi-publish-package/scripts/check_publish_ready.py ./pi-packages/calvin-pi-tools
```

## Recommended workflow

1. Validate the package:

```bash
./pi-skills/pi-publish-package/scripts/check_publish_ready.py ./pi-packages/calvin-pi-tools
```

2. Fix any missing metadata.

3. Verify npm auth:

```bash
npm whoami
```

If that fails, run:

```bash
npm login
```

4. Pack test:

```bash
cd ./pi-packages/calvin-pi-tools
npm pack
```

5. Optional dry run:

```bash
npm publish --dry-run --access public
```

6. Publish:

```bash
npm publish --access public
```

## Optional git workflow

After publishing, it is often useful to tag the release:

```bash
git tag v0.1.0
git push origin main --tags
```

## Notes

- If the chosen npm name is unavailable, rename the package before publishing.
- Scoped packages like `@yourname/calvin-pi-tools` are often easier to get.
- If publishing fails due to auth, 2FA, or name conflicts, report the exact npm error and decide the next step from there.
