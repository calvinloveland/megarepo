# UI Heuristic Critique Reference

Use this reference when you need a compact checklist for screenshot-first UI reviews.

## Screenshot-first workflow

1. Inspect the screenshot before proposing implementation changes.
2. Describe what the screen appears to optimize for.
3. Identify the primary action and whether it is obvious.
4. Note evidence, not just opinions.
5. Prioritize the fixes that most improve clarity, confidence, or task completion.

## Heuristic checklist

### 1. Clarity and purpose
- Can a user tell what this screen is for in a few seconds?
- Is the primary action obvious?
- Are labels and headings specific enough?

### 2. Hierarchy and scannability
- Does size, contrast, and placement guide attention well?
- Can the user scan the screen without rereading everything?
- Are important elements visually competing with secondary ones?

### 3. Layout and spacing
- Are related controls grouped together?
- Is spacing consistent enough to create rhythm?
- Do alignment or padding problems create noise?

### 4. Affordance and interaction cues
- Do buttons, links, toggles, and inputs look interactive?
- Are destructive or high-stakes actions clearly signposted?
- Is hover, selection, or focus likely to be understandable?

### 5. Accessibility and legibility
- Is contrast likely to be sufficient?
- Is text likely readable at realistic sizes?
- Are color-only distinctions creating risk?

### 6. States and feedback
- Are loading, empty, success, and error states accounted for?
- Does the screen show what changed after an action?
- Could a user recover from a mistake?

### 7. Copy and form friction
- Are labels shorter and clearer than the surrounding explanation?
- Do helper texts reduce uncertainty?
- Are forms asking only for what is necessary?

### 8. Density and responsiveness
- Would this still work on a narrower viewport?
- Is the screen cramped or overly sparse?
- Are tables, filters, and sidebars likely to collapse sensibly?

## Recommended critique style

Prefer this order:

1. what works
2. highest-impact issues
3. lower-severity polish items
4. quick wins
5. whether the next step should be an A/B comparison
6. missing screenshots or states to inspect next

If two remedies are both plausible, recommend turning them into `ab_test_visuals` options.
When later polish depends on why the winner was chosen, recommend `captureRationale: true`.

Avoid generic advice like "make it cleaner" or "improve UX" without screenshot evidence and a concrete change.
