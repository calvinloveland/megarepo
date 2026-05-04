# Code Reviewdle

Daily code review puzzle game.

Players inspect a larger code snippet, identify the flawed line, and classify the issue type. The initial build focuses on curated, famous-bug-inspired puzzles across multiple languages.

## MVP Direction

- one daily puzzle
- snippets are typically **25 to 60 lines**
- exactly one intended flaw per puzzle
- line-number guess + issue-type guess
- one new hint unlocked after each wrong guess
- curated puzzle bank rather than generated puzzles
- multi-language support from the start
- shared in-app feedback widget with persisted submissions

## Current Status

This project now has an initial Flask vertical slice with:

- daily puzzle selection from a local puzzle bank
- multi-language puzzle metadata
- clickable line-number review UI
- issue-type guessing
- progressive hints
- win / loss reveal state
- Flask test coverage for the core game loop
- feedback submission and review endpoints via the shared feedback system

## Quickstart

```bash
cd active/games/code_reviewdle
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
python -m code_reviewdle.app
```

Open http://127.0.0.1:5000

## Testing

```bash
cd active/games/code_reviewdle
.venv/bin/pytest
```

## Feedback Admin Access

The shared feedback system exposes:

- `POST /feedback`
- `GET /feedback`
- `POST /feedback/mark-addressed`

Admin review routes require:

- `FEEDBACK_ADMIN_USERNAME`
- `FEEDBACK_ADMIN_PASSWORD`

## Project Structure

```text
code_reviewdle/
├── data/puzzles.json
├── src/code_reviewdle/
│   ├── app.py
│   ├── content.py
│   └── game.py
├── static/app.css
├── templates/index.html
├── tests/test_app.py
└── Dockerfile
```

## Deployment

This project now includes thinker deployment assets:

- `Dockerfile`
- `k8s/code-reviewdle.yaml`
- `scripts/publish-to-thinker-registry.sh`
- `scripts/deploy-to-thinker.sh`
- `DEPLOYMENT.md`

## Next Implementation Steps

- expand the puzzle bank with more famous bugs and cleaner difficulty progression
- add optional practice mode
- improve issue taxonomy descriptions in the UI
- add streaks and shareable results
- add syntax highlighting and richer review ergonomics
