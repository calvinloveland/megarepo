# Design System Guidance Checklist

## Discover before changing

- read the nearest UI docs, task context, and related component files
- identify existing shared components, partials, helpers, and theme tokens
- inspect screenshots or visual artifacts when available so you can derive the current visual language from real output, not just code
- confirm whether the change belongs in a shared primitive instead of a page-specific override

## Visual consistency

- maintain consistent spacing, typography, border radius, icon treatment, and color roles
- keep hierarchy obvious: title, supporting text, primary action, and secondary actions
- avoid introducing a one-off pattern when an existing component already solves the problem

## Interaction states

- cover default, hover, focus, active, disabled, loading, empty, error, and success states
- make busy and error states legible without depending on color alone
- ensure controls remain understandable with long labels or constrained widths

## Accessibility and responsiveness

- preserve semantic structure and keyboard navigation
- keep focus indicators visible and contrast adequate
- respect reduced motion when animation is present
- verify the layout still works at narrow widths and with dynamic content

## Final verification

- compare the result against adjacent screens or components for consistency
- use `ab_test_visuals` when the user should choose between two concrete visual directions
- set `captureRationale: true` when the user's explanation of the winning direction will help the next revision
- summarize rationale, files changed, and any remaining design debt
