//---
name: Profile README design
description: Design bold, high-contrast GitHub profile READMEs with HTML layout primitives, dynamic image widgets, and distinct visual systems.
version: 0.1.0
owners: - team: engineering
tags: - design - markdown - github-profile - html
inputs:
- Existing profile README content
- Desired visual mood and references
- Constraints for GitHub markdown rendering

---

# Profile README design

## Intent

Create striking profile README designs that are visually distinct while preserving clear information hierarchy and reliable GitHub rendering.

## When to use

- A profile README looks generic or repetitive.
- You need several dramatically different concepts from the same content.
- You want a design system approach instead of only changing copy.

## Core design insight

- Start with **layout language first** (dashboard, editorial catalog, sci-fi console), then map content into that structure.
- Use GitHub-safe HTML primitives to create composition:
  - `<table>` and `<td>` for multi-column grids
  - `<details>` and `<summary>` for collapsible depth
  - `<blockquote>`, `<pre>`, and heading scale for voice and rhythm
  - `<p align="center">` wrappers for hero assets
- Combine static and dynamic visuals for contrast:
  - Hero/banner generators (capsule-render, dummyimage)
  - Stats/graph widgets (readme stats, streak, activity graph)
  - Signals (badges for followers/stars/views)
- Keep each concept intentionally different in at least three dimensions:
  - **Palette** (light/minimal vs neon/high-contrast)
  - **Structure** (single-flow narrative vs split dashboard)
  - **Tone** (calm editorial vs technical control panel)

## Workflow

1. Define concept direction
   - Pick a strong visual archetype and one sentence design goal.
2. Build hero first
   - Add title treatment and one bold visual anchor.
3. Lay out information architecture
   - Place about/stack/projects/AI workflow in a clear reading path.
4. Add telemetry and social signals
   - Insert stats, language panels, contribution views, and badges.
5. Stress-test for rendering constraints
   - Prefer supported tags and avoid CSS/script dependence.
6. Differentiate variants aggressively
   - Avoid only color swaps; change structure and voice.

## Safety and compatibility notes

- Assume no custom CSS or JavaScript support.
- Treat external widgets as optional enhancements; core content should still read clearly if an image fails to load.
- Keep links canonical and stable (`https://github.com/<user>/<repo>`).

## Output checklist

- Distinct concept name and visual identity
- Clear “about” signal in first screenful
- Project links and social signals present
- AI workflow or engineering approach documented
- Renders cleanly in GitHub markdown preview
