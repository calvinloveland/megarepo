# Wizard Fight — Development Plan

## Vision
Create a web-based 1v1 wizard duel where players research new spells using LLMs. Spells are generated as constrained specs (not code) and executed deterministically by the engine. Research latency is a core mechanic (risk/reward). Base spell: “summon flying monkey.”

## Product Goals
- Fast, readable combat loop with clear outcomes.
- Safe, deterministic spell execution (no LLM code execution).
- Player creativity expressed through spell research prompts.
- Easy to observe/spectate.

## Non-Goals (v1)
- Mobile native apps.
- AI-controlled opponents.
- Large-scale matchmaker or ranking ladder.

## Core Gameplay Loop
1. Start match with 2 wizards, health, mana regen.
2. Players cast baseline spell (summon flying monkey).
3. Players research a new spell (enter prompt, wait, get spell).
4. LLM generates spell design + constrained DSL spec.
5. Engine executes spell deterministically.
6. Win by reducing enemy health to 0 (v1).

## Technical Approach
### Architecture
- **Frontend**: Vanilla HTML/CSS/JS (game view + HUD + research UI).
- **Backend**: Python 3.8+, Flask + Socket.IO for real-time updates.
- **Game Engine**: Deterministic simulation loop (server authoritative).
- **Persistence**: SQLite (matches, spell catalog, telemetry).
- **LLM Layer**: Two-step generation pipeline with strict validation.

### LLM Pipeline (Safe by Design)
1. **Spell Design Output** (LLM #1): name + short description with balance guidance.
2. **Spell DSL Spec** (LLM #2): JSON-only, constrained fields (includes `emoji`).
3. **Validator/Clamper**: enforces hard limits (mana cost, duration, DPS, entity cap).
4. **Engine Executor**: interprets spec, no arbitrary code.

### Spell DSL (v1 fields)
- `name`, `school`, `mana_cost`, `cooldown`, `duration`
- `spawn_units[]`: { type, hp, speed, damage, target }
- `projectiles[]`: { speed, damage, pierce, target }
- `effects[]`: { type, magnitude, duration, target }
- Hard caps for each numeric field and totals.

## Project Phases

### Phase 0 — Discovery (1 week)
**Goals**: Lock scope, validate feasibility.
- Review idea doc and define v1 rules.
- Draft DSL schema and constraints.
- Threat model LLM misuse.
- Define key UX flows.

**Status**: Complete (DSL schema documented and validated).

**Exit Criteria**:
- Signed-off v1 spec.
- DSL schema v1 documented.

### Phase 1 — Paper Prototype (1 week)
**Goals**: Simulate turns without code.
- Hand-create 5 sample spells in DSL.
- Simulate combat outcomes and adjust caps.
- Decide on timing: tick rate, cast times, research delay.

**Status**: Complete (paper prototype notes and timing defaults documented).

**Exit Criteria**:
- Balanced-ish caps and example spells.
- Confirmed combat pacing.

### Phase 2 — Engine Prototype (2–3 weeks)
**Goals**: Deterministic server simulation.
- Build engine loop and entity system.
- Implement monkeys, collisions, targeting, health/mana.
- Deterministic RNG with seed.
- Unit tests for combat outcomes.

**Status**: Complete (deterministic engine prototype + tests).

**Exit Criteria**:
- Headless simulation runs with sample spells.
- Replayable outcomes with same seed.

### Phase 3 — Multiplayer Skeleton (2 weeks)
**Goals**: Real-time match flow.
- Flask + Socket.IO server.
- Match state broadcast and input handling.
- Basic lobby creation and join.
- Serialize game state frames.

**Status**: Complete (Socket.IO lobby + state stepping + serialization).

**Exit Criteria**:
- Two players can join and cast baseline spell.
- Stable simulation under 60 FPS server tick.

### Phase 4 — LLM Research MVP (2 weeks)
**Goals**: Safe spell generation.
- Implement LLM #1 prompt and output parser.
- Implement LLM #2 JSON-only generation.
- Validator clamps all values; reject invalid specs.
- Store spells in DB.

**Status**: Complete (mocked research pipeline + SQLite storage + tests).

**Exit Criteria**:
- Players can research a spell and cast it in match.
- Invalid outputs are rejected gracefully.

### Phase 5 — Frontend MVP (2–3 weeks)
**Goals**: Playable web UI.
- Game canvas rendering (2D lanes/tower).
- HUD: health, mana, cooldowns.
- Research panel with progress indicator.
- Spell list UI.

**Status**: Complete (vanilla UI + battlefield lane + casting).

**Exit Criteria**:
- End-to-end playable match in browser.

### Phase 6 — Balance & Fun (3–4 weeks)
**Goals**: Make it feel good.
- Add 2–3 environmental effects (fog, wind, gravity).
- Add upgrade flow (mutation-based, not strict improvements).
- Add research vulnerability tuning.
- Telemetry dashboard for win rates & spell usage.

**Status**: Complete (environment effects + upgrades + telemetry endpoints).

**Exit Criteria**:
- Playtests indicate healthy variety and counterplay.

### Phase 7 — Polish & Shipping (2–3 weeks)
**Goals**: Stability, documentation, deploy.
- Error handling, logging, observability.
- Spectator view.
- Basic deployment to a single VPS.
- Minimal landing page.

**Status**: Complete (logging, landing page, spectator UI, deploy notes).

**Exit Criteria**:
- Public demo link with stable uptime.

## Testing Strategy
- **Unit tests**: engine rules, collisions, spell effects.
- **Property tests**: output caps never exceed limits.
- **Integration tests**: LLM pipeline with mocked responses.
- **Load tests**: 10–20 concurrent matches.

## Security & Safety
- LLM outputs never executed as code.
- JSON-only schema with strict parser.
- Input filtering for prompt injection attempts.
- Rate limiting for research requests.

## Observability
- Structured logs (Loguru).
- Spell generation audit log.
- Metrics: match length, spell usage, win rates.

## Repository Structure (initial)
- `src/` server + engine
- `frontend/` static HTML/CSS/JS
- `docs/` DSL schema and API
- `tests/`

## Milestones Checklist
- [x] DSL v1 approved
- [x] Engine prototype
- [x] Multiplayer skeleton
- [x] LLM research MVP
- [x] Web UI MVP
- [x] Balance pass
- [x] Public demo

## Risks & Mitigations
- **LLM latency**: make research a strategic delay.
- **Balance chaos**: strict caps and mutation upgrades.
- **Cheating**: server authoritative simulation.
- **Prompt abuse**: hard validation and rejection logic.

## Definition of Done (v1)
- Two players can play a full match in browser.
- Research generates safe, fun spells.
- Game runs without crashes for 50 consecutive matches.
- Basic documentation for setup and gameplay.
