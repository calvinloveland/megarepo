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
- **JSON partial cell updates** for fast click/tap response instead of full-board swaps

## Controls

- **Pan:** drag or arrow keys
- **Zoom:** mouse wheel, pinch, `+`, `-`
- **Reset view:** `0`
- **Help:** `?`, `Esc`
- **Overlays:** toggle ⚡ Energy and 🗺 Territory buttons
- **Minimap:** 🗺 toggle button
- **Advance the game:** ⏭ End Turn

Notes:

- **Double-tap zoom is intentionally disabled** to avoid conflicts with rapid cell tapping.
- **Rotation is intentionally disabled** to keep grid interaction predictable.

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
├── main.py                 # Flask routes and test scenario seeding hooks
├── game_state.py           # Core Game of Life, combat, territory, AI logic
├── static/game-view.js     # Pan / zoom / touch / minimap behavior
├── static/game-view.css    # Shared board and minimap styles
├── templates/index.html    # Main game UI and End Turn animation logic
└── templates/select_player.html

tests/
├── end-turn.spec.js        # End Turn animation and regression coverage
├── game-view.spec.js       # Desktop navigation coverage
└── touch-gestures.spec.js  # Touch and mobile interaction coverage
```

## Deployment

The project is deployed as a Flask app behind the local launcher workflow. See:

- `Dockerfile`
- `k8s/conway.yaml`
