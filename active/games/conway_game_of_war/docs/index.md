# Conway's Game of War

A browser-based game blending **Conway's Game of Life** with two-player territory warfare. Built with Flask, HTMX, and vanilla JS.

## How to Play

1. **Choose your side** — Pick Player 1 (red) or Player 2 (blue), optionally set an AI opponent.
2. **Claim cells** — Click empty cells adjacent to your territory to expand.
3. **Grow** — Your cells live, die, and reproduce according to Conway's rules.
4. **Compete** — Cells with unfriendly neighbors enter combat and die. Energy and territory are tracked in the status bar.

## Features

- **Two-player game** with Conway's Life rules on a large toroidal (wrap-around) board
- **AI opponents** — Easy (random frontier expansion), Medium (stub), Hard (stub)
- **Map-like navigation**:
  - Mouse drag pan
  - Scroll-wheel zoom (toward cursor)
  - Double-click / double-tap zoom in
  - Two-finger pinch-zoom + rotate (touch)
  - Keyboard: arrow keys to pan, +/- to zoom, 0 to reset view, R to reset rotation
- **Minimap** — Overview canvas with red viewport rectangle. Click to navigate. Toggle with 🗺 button.
- **Help overlay** — Click `?` button or press `Esc` to close.
- **Dark theme** — Full dark UI with player colors.

## Stack

- **Backend**: Python, Flask, HTMX
- **Frontend**: Vanilla JS, CSS
- **Testing**: pytest (unit), Playwright (browser E2E)

## Development

```sh
# Install
pip install -e .

# Run unit tests
pytest src/conways_game_of_war/test_game_state.py -v

# Run browser tests
npm test

# Run all tests
./test.sh

# Start dev server
python -m conways_game_of_war.main
```

## Project Structure

```
├── src/conways_game_of_war/
│   ├── main.py              # Flask routes and app
│   ├── game_state.py        # Board logic, AI, rendering
│   ├── test_game_state.py   # Python unit tests
│   ├── templates/
│   │   ├── index.html       # Main game view
│   │   └── select_player.html  # Player select screen
│   └── static/
│       ├── game-view.js     # Map navigation, minimap, help overlay
│       └── game-view.css    # Minimap styles
├── tests/
│   └── game-view.spec.js    # Playwright browser tests
├── k8s/conway.yaml          # Kubernetes deployment
├── Dockerfile               # Production container
└── docs/index.md            # This file
```

## Deployment

The game runs as a Flask + Gunicorn container. See `Dockerfile` and `k8s/conway.yaml`.
