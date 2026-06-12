# Conway's Game of War

A hybrid of **Conway's Game of Life** and the card game **War**, built to pit LLMs against each other using the **pi harness**.

<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Gospers_glider_gun.svg/440px-Gospers_glider_gun.svg.png" width="120" align="right" />

## How It Works

**Grid**: 5×5. Two players start with 2×2 blocks of rank-3 cells — Red in the top-left, Blue in the bottom-right, separated by just one column of empty space.

**Each turn** (order matters!):
1. **War Phase** — Adjacent enemy cells fight. Higher rank wins (loser dies). Equal rank = both die.
2. **Life Phase** — Conway's Rules: <2 or >3 neighbors = die. Exactly 3 neighbors = birth (majority owner).
3. **Action Phase** — Each player chooses one:
   - `DEPLOY <cell>` — Place a rank-1 cell on any empty cell
   - `FORTIFY <cell>` — +1 rank to one of your cells (max 10)
   - `SABOTAGE <cell>` — -1 rank to an enemy cell (rank 1 → destroyed)
   - `PASS` — Costs 1 rank on a random cell (morale penalty)

**Win conditions**: 
- Eliminate all opponent cells → immediate victory
- After 10 turns, the player with more live cells wins
- Tie if equal

## Quick Start

```bash
# Install deps (Python 3.13+)
cd active/games/conway-game-of-war

# Run a single match (default: gpt-5.4-mini vs claude-sonnet-4.6)
python run_match.py

# Run best-of-5 with live board
python run_match.py --best-of 5 --board

# Run with custom models
python run_match.py --models "github-copilot/gpt-5.5,github-copilot/claude-opus-4.7"

# Run with a deterministic seed for reproducibility
python run_match.py --seed 42 --best-of 3

# Run with different max turns
python run_match.py --turns 5
```

### How the LLM plays

Each turn, the game engine:
1. Runs the automated War and Life phases
2. Formats the current board + score into a short prompt
3. Calls `pi -p` (print mode) with the prompt
4. Parses the LLM's response for a valid action
5. If the LLM doesn't produce a valid action, the game auto-generates one

## Matches

Match logs are saved to `results/` as Markdown files with full turn-by-turn detail.

## Using the Subagent Extension

You can also pit Pi subagents against each other using the subagent tool:

```bash
# From within a Pi session, use the subagent tool:
subagent {
  mode: "parallel",
  tasks: [
    { agent: "conway-red", task: "Play Conway's Game of War as Red. Current state: ..." },
    { agent: "conway-blue", task: "Play Conway's Game of War as Blue. Current state: ..." }
  ]
}
```

The agent markdown files in `agents/` define the player personas:
- `red.md` — Aggressive Red (gpt-5.4-mini)
- `blue.md` — Strategic Blue (claude-sonnet-4.6)

## Game Engine

`game_engine.py` exports:
- `GameState` — Full game state with grid, turns, and history
- `format_player_prompt()` — Builds the prompt sent to LLMs
- `GRID_SIZE`, `MAX_TURNS`, `MAX_RANK` — Configuration constants

The engine is model-agnostic — any LLM accessible via `pi -p` can play.

## Architecture

```
active/games/conway-game-of-war/
├── game_engine.py      # Game rules, rendering, prompt building
├── run_match.py         # Match orchestrator (calls pi CLI)
├── agents/
│   ├── red.md           # Red player agent definition (for subagent tool)
│   └── blue.md          # Blue player agent definition
├── results/             # Match log output
└── README.md            # This file
```

The runner calls `pi -p --no-session --model <model>` for each player's turn. Each call is stateless (fresh context), so the player sees only the current board and must decide based on that.
