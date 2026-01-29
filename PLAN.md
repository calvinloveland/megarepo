# Refactor Plan: Tag-Based Materials + Name Prompt Simplification

## Goals
- Simplify naming: prompt returns a single name (no JSON) using a mix list template.
- Replace low-level MBL primitives with high-level tags (e.g., `sand`, `flow`, `float`).
- Generate only: `name`, `tags`, `density`, `color`, and optional `reactions` metadata.
- Translate tags to movement at runtime (no LLM-generated code).

## Scope
- Frontend mix flow: new name prompt format, tag-based material payload.
- Simulation: tag-based behaviors in `sim/worker.ts` (no interpreter dependency for new materials).
- Schema/validation: add tags; relax/remove primitives requirement for new tag materials.
- Tests: update validators and LLM harness to new schema.

## Plan
1. **Define tag schema and defaults**
   - Tags: `sand` (pile), `flow` (fluid), `float` (gas-like). Optionally allow multiple tags.
   - Required fields: `type`, `name`, `tags`, `density`, `color`, `budgets` (if still needed for safety).
   - Update schema/validator to accept `tags` and allow `primitives` to be optional when tags present.

2. **Update mix name prompt**
   - Use a single prompt like:
     ```
     Mixes:
     Sand+Water=Silt
     Fire+Sand=Glass
     ...
     ${A}+${B}=
     ```
   - Parse the final name line; strip whitespace; reject empty/duplicate names; fallback naming if invalid.

3. **Replace material generation with tag-based output**
   - New LLM response for material details uses JSON but only fields:
     - `name`, `tags`, `density`, `color`, optional `description`.
   - Convert to runtime material with tag metadata stored.

4. **Simulation: tag behaviors**
   - Add per-material tag state in `sim/worker.ts`.
   - Implement movement by tag in `stepSimulation()`:
     - `sand`: fall straight, then diagonals to form piles.
     - `flow`: fall, then lateral spread.
     - `float`: rise or diffuse upward.
   - Use `density` for swaps; allow tags to bias movement priority.

5. **UI/Materials browser**
   - Display tags under discovered materials.
   - Optional filter: show by tag.

6. **Tests**
   - Update `material_validation.test.ts` to accept tag materials.
   - Update LLM prompt harness to validate tag schema instead of primitives.
   - Add small unit tests for tag movement behaviors.

7. **Migration/compat**
   - Existing materials with `primitives` keep working.
   - New materials can be tag-only; interpreter invoked only when primitives exist.

## Acceptance Criteria
- Mix name is generated without JSON parsing errors.
- New materials render and move correctly based on tags.
- All relevant tests updated and passing.
- UI shows discovered materials with tags and density/color.
