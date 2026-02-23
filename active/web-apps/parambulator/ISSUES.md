# Parambulator Issue Triage (User Walkthrough)

Source: `/home/calvin/code/megarepo/notes.txt`  
Date triaged: 2026-02-23

## P0 - Fix Next

- [x] **PB-001: Undo/redo buttons are obscured by feedback button**
  - Type: UX bug
  - Acceptance: Undo/redo controls remain visible/clickable on all common viewport sizes.

- [x] **PB-002: "Avoid" values reset after chart generation**
  - Type: State persistence bug
  - Acceptance: Generating a chart preserves all existing avoid entries and related form state.

- [x] **PB-003: Reading-mix status appears incorrectly unmet for everyone**
  - Type: Scoring/display bug
  - Acceptance: Reading-mix indicators match actual scored output and no false global-failure state appears.

- [x] **PB-004: Validate avoid-list names against roster**
  - Type: Data validation bug
  - Acceptance: Unknown names are rejected with clear error messaging before generation/save.

## P1 - High Value UX

- [ ] **PB-005: Add guidance/examples for each column type**
  - Type: UX clarity
  - Acceptance: Each type (mix/avoid/group/directional/ignore) has inline explanation + example.

- [ ] **PB-006: Move "Add person" action to bottom of people list**
  - Type: UX workflow improvement
  - Acceptance: Primary add action is available at the bottom of the table/list.

- [ ] **PB-007: Show current student count while editing people**
  - Type: UX visibility
  - Acceptance: People editor shows live student count near the table/actions.

- [ ] **PB-008: Auto-create reciprocal avoid pair**
  - Type: Workflow enhancement
  - Acceptance: If A avoids B, user can one-click (or automatic) apply B avoids A.

- [ ] **PB-009: Add "must sit by" constraint**
  - Type: New feature
  - Acceptance: Users can define required adjacency pairs and see them scored/violations reported.

## P2 - Product Enhancements

- [ ] **PB-010: Add prefilled seat-layout templates**
  - Type: New feature
  - Acceptance: Layout tab offers selectable starter layouts (with preview/apply).

- [ ] **PB-011: Remove reading-level column/constraint by default**
  - Type: Default configuration change
  - Acceptance: New sessions start without reading-level enabled, with opt-in toggle.

- [ ] **PB-012: Add constraint priority controls**
  - Type: Feature refinement
  - Acceptance: Users can set ordering/priority model in addition to or instead of weights.

- [ ] **PB-013: Create onboarding tutorial**
  - Type: Documentation/UX feature
  - Acceptance: First-time users can complete a short walkthrough of people, constraints, layout, and generate flow.
