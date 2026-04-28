# Megarepo

A consolidated monorepo for active projects, archived experiments, shared tooling, and repository-level documentation.

## Start Here

- [**active/**](active/README.md) - maintained projects grouped by area
- [**archive/**](archive/README.md) - legacy projects, experiments, and third-party forks kept for reference
- [**docs/**](docs/README.md) - repository-wide guides and generated page indexes
- [**ideas/**](ideas/README.md) - project concepts and brainstorming notes
- [**meta/**](meta/README.md) - repository analysis and maintenance notes
- [**scripts/**](scripts/README.md) - utilities that build and index repository documentation
- [**.devcontainer/**](.devcontainer/README.md) - local development container setup
- [**.github/skills/**](.github/skills/README.md) - Copilot skill experiments and repository guidance

`site/` is generated output; rebuild it with [`scripts/build_pages.py`](scripts/README.md).

## Active Projects

### 🛠️ Development Tools

| Project | Description | Language |
|---------|-------------|----------|
| [**full-auto-ci**](active/dev-tools/full-auto-ci/README.md) | CI automation and local dogfooding tools | Python |
| [**full-auto-de-pdf**](active/dev-tools/full-auto-de-pdf/README.md) | Scanned PDF to EPUB conversion and OCR benchmarking toolkit | Python |
| [**cli-to-web**](active/dev-tools/cli-to-web/README.md) | Framework for turning CLI workflows into web interfaces | Python |
| [**browser-error-logger**](active/dev-tools/browser-error-logger/README.md) | Browser-side JavaScript error capture library | TypeScript |
| [**copilot-lint-fixer**](active/dev-tools/copilot-lint-fixer/README.md) | Copilot-assisted `pylint` fixer for Python files | Python |
| [**plaintext_project_management**](active/dev-tools/plaintext_project_management/README.md) | Plain-text project management tooling | Python |
| [**markdown-orphan-finder**](active/dev-tools/markdown-orphan-finder/README.md) | Markdown graph tool for finding orphaned docs | Python |
| [**bingo-probability**](active/dev-tools/bingo-probability/README.md) | Exact and Monte Carlo bingo probability solver | Python |
| [**operationalize**](active/dev-tools/operationalize/README.md) | Party game and interactive development framework | Python |
| [**operationalize_vscode_ext**](active/dev-tools/operationalize_vscode_ext/README.md) | VS Code extension for operationalize | JavaScript |
| [**hivemind-llm**](active/dev-tools/hivemind-llm/README.md) | LLM integration and orchestration experiments | Python |
| [**tci-framework**](active/dev-tools/tci-framework/README.md) | Reusable Trust-Capability-Intelligence framework primitives | Python |
| [**manifold-mcp**](active/dev-tools/manifold-mcp/README.md) | Repo-local integration helpers for the adopted upstream Manifold MCP server | Python |
| [**time_function_with_timeout**](active/dev-tools/time_function_with_timeout/README.md) | Python timing helper with timeout support | Python |
| [**tough_bugs**](active/dev-tools/tough_bugs/README.md) | Debugging challenge collection | Python |

### 🎮 Games

| Project | Description | Language |
|---------|-------------|----------|
| [**lets-holdem-together**](active/games/lets-holdem-together/README.md) | Multiplayer poker game with AI players | Python |
| [**super_ultimate_trading_card_game**](active/games/super_ultimate_trading_card_game/README.md) | LLM-driven trading card game simulation prototype with AI playtesting | Python |
| [**wizard_fight**](active/games/wizard_fight/README.md) | Turn-based wizard battle game | Python |
| [**conway_game_of_war**](active/games/conway_game_of_war/README.md) | Browser-based Conway variant with competitive rules | Python |
| [**powder_play**](active/games/powder_play/README.md) | Falling-sand style particle sandbox | Python |
| [**MancalaAI**](active/games/MancalaAI/README.md) | Mancala AI experiments | Python |
| [**vroomon**](active/games/vroomon/README.md) | Vehicle simulation and physics experiments | Python |

### 🤖 Bots

| Project | Description | Language |
|---------|-------------|----------|
| [**OpenClaw**](active/bots/openclaw/README.md) | Cluster-hosted OpenClaw gateway with Telegram, Gmail triage, and model fallback routing | Shell / YAML |
| [**manifold-trading-framework**](active/bots/manifold-trading-framework/README.md) | Manifold trading workflows built on top of the reusable TCI framework | Python |
| [**CryptoRoleBot**](active/bots/CryptoRoleBot/README.md) | Discord bot for crypto-related role management | Python |
| [**broomsweeper_solver**](active/bots/broomsweeper_solver/README.md) | Screenshot annotation and solver tooling for Broomsweeper | TypeScript |

### 🌐 Web Apps

| Project | Description | Language |
|---------|-------------|----------|
| [**parambulator**](active/web-apps/parambulator/README.md) | Seating-chart builder for classroom constraints | Python |
| [**sub-day-generator**](active/web-apps/sub-day-generator/README.md) | Substitute-ready classroom day plan prototype | Python |
| [**momos**](active/web-apps/momos/README.md) | Family command center prototype | Python |
| [**vernissage**](active/web-apps/vernissage/README.md) | Art Nouveau visual-art review salon for artworks, artists, exhibitions, and museum visits | TypeScript |
| [**shared**](active/web-apps/shared/README.md) | Shared web feedback components used by multiple apps | Python |

### 👤 Personal Configuration

| Project | Description | Language |
|---------|-------------|----------|
| [**calnix**](active/personal/calnix/README.md) | Personal NixOS configuration and dotfiles | Nix |

For curated project indexes and related docs, start from [active/README.md](active/README.md).

## Archived Material

Archived work is indexed in [archive/README.md](archive/README.md), including:

- coursework and old class projects
- legacy websites and prototypes
- older experiments and learning projects
- third-party forks retained for reference

## Repository Documentation

- [**PHILOSOPHY.md**](PHILOSOPHY.md) - core development principles
- [**PLAN.md**](PLAN.md) - repository roadmap and planning notes
- [**ISSUES.md**](ISSUES.md) - known issues and follow-up work
- [**docs/MEGAREPO_PAGES.md**](docs/MEGAREPO_PAGES.md) - generated documentation page index
