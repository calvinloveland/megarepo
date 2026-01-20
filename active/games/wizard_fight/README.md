# Wizard Fight

A web-based wizard duel game where players research spells via LLMs and battle in real time. Spells are generated as constrained JSON specs, validated, and executed by a deterministic server-side engine.

## What’s Included
- Deterministic simulation engine (server authoritative).
- Spell research pipeline with safe JSON schema validation.
- Real-time multiplayer skeleton (Flask + Socket.IO).
- Frontend MVP (React + Vite) with casting, research, and spectator view.

## Quick Start

### One Command (Backend + Frontend)
From [active/games/wizard_fight](active/games/wizard_fight):

- `./scripts/dev.sh`

Defaults:
- Backend: `5055`
- Frontend: `5175`

Override with env vars:
- `WIZARD_FIGHT_PORT=6060 WIZARD_FIGHT_FRONTEND_PORT=6061 ./scripts/dev.sh`

### Backend
From [active/games/wizard_fight](active/games/wizard_fight):

1. Create a virtual environment and install dependencies:
	- `python -m venv .venv`
	- `. .venv/bin/activate`
	- `pip install .`

2. Run the server:
	- `WIZARD_FIGHT_PORT=5055 python -m wizard_fight.server`

The backend listens on port `5055` by default.

### Frontend
From [active/games/wizard_fight/frontend](active/games/wizard_fight/frontend):

1. Install dependencies:
	- `npm install`

2. Start the dev server:
	- `npm run dev -- --port 5175`

The frontend dev server defaults to port `5175` and connects to the backend at `http://localhost:5055` via `VITE_SOCKET_URL`.

## Tests

### Backend
From [active/games/wizard_fight](active/games/wizard_fight):
- `python -m pytest`

### Frontend
From [active/games/wizard_fight/frontend](active/games/wizard_fight/frontend):
- `npm test`

## Useful Docs
- Development plan: [active/games/wizard_fight/DEVELOPMENT_PLAN.md](active/games/wizard_fight/DEVELOPMENT_PLAN.md)
- Spell DSL schema: [active/games/wizard_fight/docs/dsl_v1.md](active/games/wizard_fight/docs/dsl_v1.md)
- VPS deployment: [active/games/wizard_fight/docs/deploy_vps.md](active/games/wizard_fight/docs/deploy_vps.md)

## Notes
- The spell system never executes arbitrary code. All spells are validated against the JSON schema before use.
- Research has a built-in delay (see [active/games/wizard_fight/docs/timing_v1.json](active/games/wizard_fight/docs/timing_v1.json)).
