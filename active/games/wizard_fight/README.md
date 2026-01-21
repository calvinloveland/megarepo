# Wizard Fight

A web-based wizard duel game where players research spells via LLMs and battle in real time. Spells are generated as constrained JSON specs, validated, and executed by a deterministic server-side engine.

## What’s Included
- Deterministic simulation engine (server authoritative).
- Spell research pipeline with safe JSON schema validation.
- Real-time multiplayer server (Flask + Socket.IO).
- Vanilla HTML/CSS/JS frontend with casting, research, spellbook, and leaderboard.

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

Serve the static files:
- `python -m http.server 5175`

Open http://localhost:5175 in a browser.

## Tests

### Backend
From [active/games/wizard_fight](active/games/wizard_fight):
- `python -m pytest`

### Frontend
No frontend test runner is required for the vanilla setup.

## Useful Docs
- Development plan: [active/games/wizard_fight/DEVELOPMENT_PLAN.md](active/games/wizard_fight/DEVELOPMENT_PLAN.md)
- Spell DSL schema: [active/games/wizard_fight/docs/dsl_v1.md](active/games/wizard_fight/docs/dsl_v1.md)
- VPS deployment: [active/games/wizard_fight/docs/deploy_vps.md](active/games/wizard_fight/docs/deploy_vps.md)

## Notes
- The spell system never executes arbitrary code. All spells are validated against the JSON schema before use.
- Research has a built-in delay (see [active/games/wizard_fight/docs/timing_v1.json](active/games/wizard_fight/docs/timing_v1.json)).
- To point the frontend at a different backend URL, edit `frontend/app.js` (defaults to `http://localhost:5055`).
- The frontend is plain HTML/CSS/JS and can be served by any static file server.

## Local LLM (Ollama)
Set `WIZARD_FIGHT_LLM_MODE=local` and run a local model with Ollama:
- `WIZARD_FIGHT_LOCAL_BACKEND=ollama`
- `WIZARD_FIGHT_OLLAMA_URL=http://localhost:11434/api/generate`
- `WIZARD_FIGHT_OLLAMA_MODEL=llama3.2`

Start the Ollama server and pull the model:
- `ollama serve`
- `ollama pull llama3.2`

If Ollama is unavailable, the pipeline falls back to a lightweight transformers model (if installed) or a deterministic generator.
