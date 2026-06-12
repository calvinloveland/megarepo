# Conway's Game of War

A browser-based strategy game that combines **Conway's Game of Life** with **two-player territory warfare**.

## Current Gameplay

1. **Choose a side** — Play as Player 1 or Player 2. You can also enable an AI opponent.
2. **Claim or toggle cells** — Expand from your owned territory and activate/deactivate your own cells.
3. **End the turn** — The board evolves in a **Fibonacci-sized** burst: 1, 1, 2, 3, 5, 8...
4. **Fight for space** — Conway birth/survival rules apply, but cells adjacent to enemies die from combat.
5. **Break the enemy base** — Each side keeps an immortal star/base cell, but a player loses once all of their non-immortal territory is gone.
6. **Manage energy** — Claiming a new cell costs energy. Energy is scarce and tied to crop-at-birth mechanics.

## Features

- **Two-player Conway warfare** on a toroidal wrap-around board, including edge-crossing gliders and other Life patterns
- **Turn-based play** with animated End Turn progression
- **Territory expansion** when a new cell is claimed
- **Energy economy** shown in the status bar
- **AI opponents**
  - Easy: random frontier expansion
  - Medium: stronger local frontier choices
  - Hard: more aggressive structured expansion
- **Map-like navigation**
  - mouse drag pan
  - scroll-wheel zoom
  - double-click zoom in
  - keyboard pan/zoom/reset
  - touch pan
  - pinch zoom
- **Minimap** with viewport rectangle and drag/click navigation
- **Help overlay** and compact mobile-friendly HUD
- **Toggleable board overlays**
  - ⚡ Energy overlay for harvestable crop bars
  - 🗺 Territory overlay for owned influence/claimed ground
  - 💸 Cost overlay for action-point costs per cell
- **Stats panel** with live win-probability estimate, territory counts, energy, immortal cells, and frontier reach per player (toggled with `S` or 📊 button)
- **JSON partial cell updates** for fast click/tap response instead of full-board swaps
- **Sound effects** for cell placement, undo, turn transitions, and win state
- **Keyboard shortcuts** for stats (`S`), cost overlay (`K`), help overlay (`?`)
- **Turn counter** tracked server-side and exposed via stats API
- **Undo support** with multi-step history for the current turn
- **ELO-style rankings** persisted via localStorage and server-side `/record_match`

## Controls

| Key / Action | Function |
|---|---|
| Mouse drag / Arrow keys | Pan the board |
| Scroll wheel / `+` / `-` | Zoom in / out |
| Double-click | Zoom in |
| `0` | Reset view to default |
| `?` | Toggle help overlay |
| `Esc` | Close help overlay |
| `S` | Toggle stats panel |
| `K` | Toggle cell cost overlay |
| Two-finger pinch | Pinch-zoom (mobile) |
| 📊 Stats button | Toggle live stats panel |
| 💸 Cost button | Toggle action cost overlay |
| ⚡ Energy button | Toggle energy crop bars |
| 🗺 Territory button | Toggle territory influence |
| 🗺 Minimap button | Toggle minimap |
| ⏭ End Turn | Advance the game |

## Notes

- **Stats panel auto-refreshes every 3 seconds** via HTMX polling.
- **Overlay state persists to localStorage** across page reloads.
- **Double-tap zoom is intentionally disabled** to avoid conflicts with rapid cell tapping.
- **Rotation is intentionally disabled** to keep grid interaction predictable.

## API Endpoints

| Route | Method | Description |
|---|---|---|
| `/stats` | GET | JSON with player stats, board stats, turn count |
| `/stats_html` | GET | Rendered HTML for the stats panel sidebar |
| `/update_cell?x=&y=&json=1` | POST | JSON cell action with energy and patch data |
| `/undo_cell?x=&y=&json=1` | POST | Undo last cell action, returns updated state |
| `/end_turn?json=1` | POST | End current turn, returns board patch |
| `/step?json=1` | POST | Single Fibonacci step during end-turn animation |
| `/match_status` | GET | Match state, turn timer, winner for polling |
| `/record_match` | POST | Record win/loss for ELO rankings |
| `/player_energy` | GET | Current player energy (HTMX fragment) |
| `/game_state` | GET | Full board state (HTMX fragment) |
| `/log_error` | POST | Client-side error logging endpoint |

## Stack

- **Backend:** Python, Flask
- **Frontend:** HTMX, vanilla JavaScript, CSS
- **Testing:** pytest and Playwright

## Development

```sh
# Install Python deps in the local venv or your active environment
pip install -e .

# Python tests
.venv/bin/python -m pytest src/conways_game_of_war/ -q

# Browser tests
npm test

# Start the dev server
.venv/bin/python -m conways_game_of_war.main
```

## Important Files

```text
src/conways_game_of_war/
├── main.py                 # Flask routes: /stats, /stats_html, /update_cell, /undo_cell,
│                           #   /end_turn, /step, /match_status, /record_match, /log_error
├── game_state.py           # Core Game of Life, combat, territory, AI logic
│                           #   get_stats() — player + board stats, turn count
├── static/game-view.js     # Pan / zoom / touch / minimap / keyboard shortcuts / sounds
├── static/game-view.css    # Stats panel, minimap, overlays, mobile responsive, keyframes
├── templates/index.html    # Main game UI, cell click handler, End Turn animation
└── templates/select_player.html

tests/
├── end-turn.spec.js        # End Turn animation and regression coverage
├── game-view.spec.js       # Desktop navigation coverage
└── touch-gestures.spec.js  # Touch and mobile interaction coverage

tests/game_state/
├── test_game_state.py      # Unit tests for game_state module
└── test_get_stats.py       # Tests for stats endpoint (72 total tests)
```

## Deployment

The project is deployed as a Flask app behind the local launcher workflow. See:

- `Dockerfile`
- `k8s/conway.yaml`
