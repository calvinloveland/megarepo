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

## Current Status

This project now has an initial Flask vertical slice with:

- daily puzzle selection from a local puzzle bank
- multi-language puzzle metadata
- clickable line-number review UI
- issue-type guessing
- progressive hints
- win / loss reveal state
- Flask test coverage for the core game loop

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
└── tests/test_app.py
```

## Next Implementation Steps

- expand the puzzle bank with more famous bugs and cleaner difficulty progression
- add optional practice mode
- improve issue taxonomy descriptions in the UI
- add streaks and shareable results
- add syntax highlighting and richer review ergonomics
