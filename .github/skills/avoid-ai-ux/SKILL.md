//---
name: Avoid AI-feeling UX
description: Identify and remove the common signals that make interfaces feel generic, low-effort, or obviously AI-generated.
version: 0.1.0
owners: - team: design
tags: - ux - trust - copy - polish - product
inputs:
- Product area, flow, or screenshots to review
- Brand voice or product positioning
- Primary user tasks and trust-sensitive moments
---

# Avoid AI-feeling UX

## Intent

Prevent interfaces from feeling like low-effort AI output by removing sameness, filler, context-free decisions, and robotic language before they reach users.

## When to use

- A page or flow looks polished but still feels strangely generic.
- Copy sounds correct but hollow.
- A team is using AI drafts for UI, UX writing, or layout generation.
- You need a review pass focused on trust, specificity, and human judgment rather than visual correctness alone.

## Core finding

UX feels “AI” when it is **statistically plausible but contextually thin**. The recurring failure mode across design critiques is not that the work looks broken; it is that it feels averaged, interchangeable, and insufficiently shaped by real users, real constraints, and real product judgment.

## Commonalities that make UX feel low-effort AI

### 1. Generic averages instead of a point of view

- Hero sections, cards, gradients, and layouts feel like defaults.
- The UI borrows familiar patterns but says nothing specific about the product.
- The result is competent sameness rather than brand presence.

**Replace with**

- One clear visual or structural opinion per screen.
- Brand-specific motifs, language, and hierarchy.
- Components that reflect the product’s actual job, not just a template.

### 2. Correct visual hierarchy, wrong information hierarchy

- The screen looks organized, but the most important information is not where users need it.
- CTA emphasis follows visual symmetry rather than user readiness.
- Trust signals, pricing implications, constraints, and next steps are buried.

**Replace with**

- Prioritize what reduces uncertainty first.
- Put the “decision-making” information before the “marketing” information.
- Tune hierarchy using real user hesitation points, not generic layout rules.

### 3. Robotic, buzzword-heavy, or frictionless-but-empty copy

- Copy is technically clean but could belong to any product.
- Headlines overuse abstractions like “innovative,” “seamless,” or “tailored.”
- Error states, empty states, and forms explain too little.

**Replace with**

- Concrete nouns, real examples, and product-specific details.
- Microcopy that explains why, what happens next, and what the user should do.
- Language a teammate or customer would actually say out loud.

### 4. Screen-level polish with flow-level hollowness

- Individual screens look presentable, but the journey feels emotionally unaware.
- Signup, checkout, onboarding, and recovery flows ignore user state: uncertainty, urgency, distrust, fatigue.
- The design is optimized as a set of mockups instead of an experience.

**Replace with**

- Review full flows, not isolated screens.
- Design for the user’s likely emotional state at each step.
- Make transitions, confirmations, and reversibility explicit.

### 5. Placeholder logic and filler decisions

- Stock structure remains where product thinking should be.
- Navigation labels, CTAs, testimonials, and supporting copy feel interchangeable.
- Placeholder images or decorative flourishes outnumber meaningful cues.

**Replace with**

- Remove any element that cannot justify its existence.
- Prefer one precise support element over three generic ones.
- Treat “looks complete” and “is informative” as separate checks.

### 6. Context-free spacing, density, and rhythm

- The interface is uniformly balanced in a way that ignores the task.
- Spacing looks mathematically tidy but does not help scanning or calm.
- Data-heavy areas feel floaty; reflective areas feel cramped.

**Replace with**

- Use spacing to signal effort, importance, and pace.
- Compress for comparison, expand for reflection, isolate for decisions.
- Tune rhythm by task type, not by aesthetic average.

### 7. Inconsistent detail quality

- Main sections are polished while edge states feel default.
- Hover, focus, loading, empty, error, and success states lag behind.
- Icons, illustrations, and copy style come from visibly different worlds.

**Replace with**

- Review the “boring” states with the same care as the hero.
- Keep iconography, tone, spacing, and interaction feedback in one design language.
- Fix sharp edges that reveal the generated scaffold underneath.

### 8. Missing evidence of human judgment

- The design shows no signs of tradeoffs, prioritization, or restraint.
- Everything is equally polished, equally vague, and equally noncommittal.
- It feels like no one made a hard decision.

**Replace with**

- Make explicit tradeoffs: what matters most, what is deferred, what is intentionally omitted.
- Show domain knowledge in the flow, not just the copy.
- Let constraints shape the interface instead of hiding them.

## Review workflow

1. Start with the trust-critical moments
   - Homepage, pricing, onboarding, signup, checkout, settings, recovery, and empty states.
   - Ask where a skeptical user would hesitate.

2. Run the “could this be any product?” test
   - If the headline, CTA, or card could fit ten competitors unchanged, it is too generic.
   - Rewrite until the page reveals a specific product and audience.

3. Check information order before visual polish
   - Identify the three facts users need before acting.
   - Move those higher, clarify them, and reduce decorative competition.

4. Rewrite AI-sounding copy aggressively
   - Cut abstraction, corporate filler, and empty enthusiasm.
   - Replace with specifics, examples, stakes, and next steps.

5. Review full flows, not isolated screens
   - Walk the happy path, the confused path, and the error path.
   - Look for places where the product acts like a system instead of a guide.

6. Inspect edge-state craftsmanship
   - Empty, error, loading, validation, success, and undo states.
   - These are where low-effort generation is easiest to spot.

7. Remove decorative surplus
   - If an element adds motion, imagery, or copy without reducing uncertainty or deepening meaning, cut it.

## Fast smell tests

- **Template test:** Does this look like a starter theme with nicer colors?
- **Swap test:** Could you swap in another company name without rewriting the page?
- **Specificity test:** Are there concrete examples, constraints, or tradeoffs?
- **Flow test:** Does the design still make sense when used in sequence?
- **Edge-state test:** Do failure and recovery states feel authored?
- **Trust test:** Does the interface explain enough for a cautious user to proceed?

## Rewrite rules

- Prefer **specific** over impressive.
- Prefer **decision support** over decoration.
- Prefer **one strong opinion** over five safe patterns.
- Prefer **flows** over screens.
- Prefer **edited AI draft** over untouched AI draft.
- Prefer **real user tension** over idealized happy-path polish.

## Failure modes

- Confusing “modern” with “credible.”
- Shipping AI draft copy because it is grammatically clean.
- Optimizing layout symmetry before user comprehension.
- Letting generated components set the product’s tone by default.
- Treating brand personality as a visual theme instead of an interaction quality.

## References

- Nielsen Norman Group summaries surfaced via web research on trustworthy content, credibility vs. trust, microcopy, and low-quality-site red flags.
- Vandelay Design: `https://www.vandelaydesign.com/ai-ux-feels-off/`
- Fuselab Creative: `https://fuselabcreative.com/ai-generated-ui-design/`
- Devlofox: `https://blog.devlofox.com/hidden-risks-of-ai-generated-ui-design/`
- Pagecloud: `https://www.pagecloud.com/blog/why-your-ai-generated-website-copy-feels-robotic-and-how-to-fix-it`
