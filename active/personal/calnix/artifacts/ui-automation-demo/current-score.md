/ui-heuristic-score — demo dashboard regression

**Overall score:** 76/100  
**Confidence:** high  
**Severity counts:** blocker 0, major 2, minor 2, nit 1  
**Ship decision:** needs revision

## Overall read
The dashboard is still clean and readable, but the regression introduces **state ambiguity** and **mixed semantic color signals**. The screen’s biggest visual changes are concentrated in two places, which makes the regression easy to spot: the **Primary action** shifted from blue to green, and **Metric 2** now shows a red “Needs attention” pill. Those two changes now compete for attention and weaken the previous calm, consistent hierarchy.

## What still works
- Layout remains simple and scannable.
- Card structure and spacing are stable.
- Dark theme contrast for most large containers still appears acceptable.
- The dashboard title, three metric cards, and recent activity block are easy to locate.

## Highest-impact issues

### 1. Error state appears without supporting context
- **Severity:** major
- **Heuristic:** States and feedback
- **Evidence:** Metric 2 changed from a neutral “Healthy” pill to a red “Needs attention” pill, but the surrounding card still only shows “3 alerts” with no explanation, drilldown cue, timestamp, or next step.
- **Impact:** Users see urgency but not what is wrong or what to do next. This creates anxiety instead of actionable feedback.
- **Recommendation:** Pair the red state with at least one of:
  - a short reason: “3 alerts — 1 critical”
  - a linked cue: “View alerts”
  - stronger card-level emphasis if this is truly the most important issue

### 2. Semantic color system is now inconsistent
- **Severity:** major
- **Heuristic:** Clarity and purpose
- **Evidence:** The primary CTA changed from blue to green while an alert state is also present in red. Green commonly reads as success/healthy, so the CTA now carries status-like meaning rather than action-like meaning.
- **Impact:** The screen now has two competing semantic anchors: green implies success, red implies problem. That makes the primary action feel less like the main control and more like another status badge.
- **Recommendation:** Keep CTA color distinct from status colors. If red/yellow/green are used for health states, the main action should stay in a neutral brand/action color.

## Lower-severity issues

### 3. Visual hierarchy is split between CTA and alert chip
- **Severity:** minor
- **Heuristic:** Hierarchy and scannability
- **Evidence:** In the baseline, the blue CTA was the dominant accent. In the current version, the bright green CTA and bright red status pill both pull strong attention.
- **Impact:** Users must decide whether to focus on acting or diagnosing.
- **Recommendation:** Let one element lead. If the alert is critical, elevate the whole Metric 2 card and slightly reduce CTA saturation. If not, tone down the alert pill.

### 4. Alert styling relies heavily on color alone
- **Severity:** minor
- **Heuristic:** Accessibility and legibility
- **Evidence:** The only apparent change in Metric 2 is the pill color/text.
- **Impact:** Users with reduced color discrimination may miss severity differences or not understand urgency level.
- **Recommendation:** Add an icon, severity label, or secondary text such as “Warning” / “Attention needed”.

### 5. Primary CTA color may imply success completion
- **Severity:** nit
- **Heuristic:** Affordance and interaction cues
- **Evidence:** The green button reads more like a “success” or “enabled” state than a general-purpose action.
- **Impact:** Small but noticeable semantic mismatch.
- **Recommendation:** Reserve green for successful outcomes or positive health states unless the product already uses green as the action brand color everywhere.

## Quick wins
1. Revert the **Primary action** button to the previous action color.
2. Add supporting copy to Metric 2:  
   `3 alerts • Needs attention` or `3 alerts • 1 critical`
3. Add a direct affordance under the alert state:  
   `Review alerts`
4. Add a non-color cue to the alert pill, such as an icon.

## Suggested next step
If the team is unsure whether the CTA or the alert should dominate, run a small A/B comparison:

- **Option A:** neutral/brand CTA + stronger alert card
- **Option B:** current CTA treatment + softer alert pill with more explanatory text

## Missing states to review next
- hover/focus state for the CTA
- expanded alert details state
- empty recent activity state
- narrow/mobile layout
- screen with multiple unhealthy metrics

## Regression summary
- **Baseline strength:** calm, consistent, single primary accent
- **Current regression:** stronger urgency but worse semantic consistency and less actionable feedback
- **Net:** visually noticeable change, but not yet well resolved into a clearer experience
