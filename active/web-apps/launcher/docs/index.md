# Megarepo Launcher

**The starting point for all web-based work in the megarepo.**

The launcher is a dashboard that can start, stop, and link to every web-based app in the megarepo. It is the home base for all web-based development, deployment, and discovery.

- **Public dashboard**: [shsw.dev](https://shsw.dev)
- **Local dev**: [http://localhost:3001](http://localhost:3001)
- **Documentation site**: [calvinloveland.github.io/megarepo/](https://calvinloveland.github.io/megarepo/)
- **GitHub source**: [active/web-apps/launcher](https://github.com/calvinloveland/megarepo/tree/main/active/web-apps/launcher)

## Role

- **Starting point** — open the launcher first to discover what's running and what's available
- **App registry** — every web app in the megarepo is registered in `apps.yaml` with its launch config
- **Project index** — every active project is listed in `projects.yaml` with metadata
- **Canonical docs bridge** — the launcher footer links to the MkDocs documentation site

## Quick Start

## Quick Start

```bash
cd active/web-apps/launcher
bash start.sh
```

Then open **http://localhost:3001** in your browser.

## How It Works

The launcher is a small Flask server that:
- **Discovers** all web apps registered in `apps.yaml`
- **Shows** each app's status (running/stopped) in a card-grid dashboard
- **Starts** apps on unique ports (so they don't conflict — many default to 5000)
- **Stops** apps cleanly via SIGTERM, with a SIGKILL fallback after 5s
- **Auto-detects** running instances — if you started an app outside the launcher, it'll show as running and let you open it

## Included Apps

| App | Type | Port | Description |
|-----|------|------|-------------|
| Momos (Cozi) | Flask | 5101 | Family command center |
| Parambulator | Flask | 5102 | Seating chart planner |
| Sub Day Generator | Flask | 5103 | Substitute teacher plans |
| Vernissage | Next.js | 3000 | Art gallery browser |
| Let's Hold 'em Together | Flask | 5104 | Multiplayer poker |
| Code Reviewdle | Flask | 5105 | Daily code review puzzle |
| Conway's Game of War | Flask | 5106 | Life meets battle |
| Wizard Fight | Flask | 5055 | Real-time wizard dueling |
| Wizard Fight (UI) | Vite | 5175 | React frontend |
| Super Ultimate TCG | Flask | 5107 | Trading card game |
| Powder Play (Mix) | Node | 8787 | Material server |
| Powder Play (UI) | Vite | 5173 | Game frontend |
| Hivemind LLM | Flask | 5108 | LLM coordinator |
| Hivemind LLM (UI) | Vite | 5176 | Frontend |
| Operationalize | Flask | 5109 | Workflow tool |

## Configuration

Edit `apps.yaml` to add or modify apps. Each entry specifies:

- `id` — unique identifier used by the API
- `name` — display name
- `description` — shown in the card
- `path` — relative path from the launcher directory
- `type` — flask, nextjs, vite, or node
- `port` — port to listen on
- `module` — Python module to run (for Flask/Python apps)
- `start_cmd` — shell command (for non-Python apps)
- `env` — environment variable overrides

## API

- `GET /` — Dashboard UI
- `GET /api/apps` — JSON list of all apps with status
- `POST /api/start/<id>` — Start an app
- `POST /api/stop/<id>` — Stop an app (if managed by launcher)
- `GET /api/status/<id>` — Status of a single app
