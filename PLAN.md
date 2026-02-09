# Refactor Plan: Tag-Based Materials + Name Prompt Simplification

## Repository Context
- Repo: megarepo
- Project: Powder Play (falling-sand game)
- Root: /workspaces/megarepo/active/games/powder_play
- Frontend: /workspaces/megarepo/active/games/powder_play/frontend
- Simulator (worker): /workspaces/megarepo/active/games/powder_play/sim/worker.ts
- Mix generation flow: /workspaces/megarepo/active/games/powder_play/frontend/src/ui/app.ts
- LLM API: /workspaces/megarepo/active/games/powder_play/frontend/src/material_api.ts
- Schema/validator: /workspaces/megarepo/active/games/powder_play/material_gen/schema.json and /workspaces/megarepo/active/games/powder_play/material_gen/validator.ts
- Tests: /workspaces/megarepo/active/games/powder_play/frontend/tests and /workspaces/megarepo/active/games/powder_play/frontend/e2e/playwright

## Goals
- Simplify naming: prompt returns a single name (no JSON) using a mix list template.
- Replace low-level MBL primitives with high-level tags (e.g., `sand`, `flow`, `float`).
- Generate only: `name`, `tags`, `density`, `color`, and optional `reactions` metadata.
- Translate tags to movement at runtime (no LLM-generated code).

## Scope
- Frontend mix flow: new name prompt format, tag-based material payload in [active/games/powder_play/frontend/src/ui/app.ts](active/games/powder_play/frontend/src/ui/app.ts).
- LLM API parsing updates in [active/games/powder_play/frontend/src/material_api.ts](active/games/powder_play/frontend/src/material_api.ts).
- Simulation: tag-based behaviors in [active/games/powder_play/sim/worker.ts](active/games/powder_play/sim/worker.ts) (no interpreter dependency for new materials).
- Schema/validation: add tags; relax/remove primitives requirement in [active/games/powder_play/material_gen/schema.json](active/games/powder_play/material_gen/schema.json) and [active/games/powder_play/material_gen/validator.ts](active/games/powder_play/material_gen/validator.ts).
- UI/Materials browser updates in [active/games/powder_play/frontend/src/ui/material_browser.ts](active/games/powder_play/frontend/src/ui/material_browser.ts).
- Tests update in [active/games/powder_play/frontend/tests](active/games/powder_play/frontend/tests) and [active/games/powder_play/frontend/e2e/playwright](active/games/powder_play/frontend/e2e/playwright).

## Plan
1. **Define tag schema and defaults**
   - Tags: `sand` (pile), `flow` (fluid), `float` (gas-like). Optionally allow multiple tags.
   - Required fields: `type`, `name`, `tags`, `density`, `color`, `budgets` (if still needed for safety).
    - Update schema/validator to accept `tags` and allow `primitives` to be optional when tags present.
       - [active/games/powder_play/material_gen/schema.json](active/games/powder_play/material_gen/schema.json)
       - [active/games/powder_play/material_gen/validator.ts](active/games/powder_play/material_gen/validator.ts)

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
       - [active/games/powder_play/frontend/src/ui/app.ts](active/games/powder_play/frontend/src/ui/app.ts)

3. **Replace material generation with tag-based output**
   - New LLM response for material details uses JSON but only fields:
     - `name`, `tags`, `density`, `color`, optional `description`.
    - Convert to runtime material with tag metadata stored.
       - [active/games/powder_play/frontend/src/ui/app.ts](active/games/powder_play/frontend/src/ui/app.ts)

4. **Simulation: tag behaviors**
   - Add per-material tag state in [active/games/powder_play/sim/worker.ts](active/games/powder_play/sim/worker.ts).
   - Implement movement by tag in `stepSimulation()`:
     - `sand`: fall straight, then diagonals to form piles.
     - `flow`: fall, then lateral spread.
     - `float`: rise or diffuse upward.
   - Use `density` for swaps; allow tags to bias movement priority.

5. **UI/Materials browser**
    - Display tags under discovered materials.
       - [active/games/powder_play/frontend/src/ui/material_browser.ts](active/games/powder_play/frontend/src/ui/material_browser.ts)
   - Optional filter: show by tag.

6. **Tests**
   - Update [active/games/powder_play/frontend/tests/material_validation.test.ts](active/games/powder_play/frontend/tests/material_validation.test.ts) to accept tag materials.
   - Update [active/games/powder_play/frontend/e2e/playwright/llm_prompt_score.spec.ts](active/games/powder_play/frontend/e2e/playwright/llm_prompt_score.spec.ts) to validate tag schema instead of primitives.
   - Add unit tests for tag movement behaviors in [active/games/powder_play/frontend/tests](active/games/powder_play/frontend/tests).

7. **Migration/compat**
   - Existing materials with `primitives` keep working.
   - New materials can be tag-only; interpreter invoked only when primitives exist.

## Acceptance Criteria
- Mix name is generated without JSON parsing errors.
- New materials render and move correctly based on tags.
- All relevant tests updated and passing.
- UI shows discovered materials with tags and density/color.
