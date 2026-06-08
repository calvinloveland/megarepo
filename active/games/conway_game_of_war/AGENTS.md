# AGENTS.md

Project-local guidance for `active/games/conway_game_of_war`.

## Setup

- Install project dependencies with `pip install -e .` when working in a fresh environment.
- Read the local `README.md` for project-specific run and test commands.

## Validation

### Python unit tests
```sh
.venv/bin/python -m pytest src/conways_game_of_war/test_game_state.py -v
```

### Playwright browser tests (map UI, gestures, minimap)
```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium npm test
```

The Playwright tests start the Flask server automatically, so no separate server command is needed.

### Reference
- Use `npm test -- --list` to see all available tests.
- Use `npm run test:headed` to visually observe tests in a browser window.
- Use `npm run test:debug` to step through tests with the Playwright inspector.
- For quick iteration, filter tests: `npm test -- -g "mouse drag"`
