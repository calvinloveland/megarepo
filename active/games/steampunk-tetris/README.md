# Brass & Boiler

Steampunk Tetris for the [AI Tetris Challenge](https://github.com/ikarlinsey/ai_tetris_challenge):
a Protocol v2-compliant game plus two submitted bots.

**Calvin Loveland · agent: deepseek**

## What's here

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `src/` | The game — riveted brass cabinet, canvas 2D, no build step |
| `game-adapter.js` | The challenge's official `postMessage` adapter, unmodified |
| `bots/src/` | Bot brains (shared `core.js` + two strategies) |
| `bots/dist/` | The single-file bot bundles that get submitted |
| `tests/` | Conformance, game, and bot suites |
| `vendor/conformance/` | The challenge's conformance suite, copied verbatim |
| `docs/index.md` | Full project documentation |

## Bots

- **Boiler Stoker** (`bots/dist/boiler-stoker.js`) — plays for the highest mean score:
  real §6 points balanced against Dellacherie shape terms, one piece of lookahead, hold.
- **Four-Line Fanatic** (`bots/dist/four-line-fanatic.js`) — keeps the rightmost column as a
  well and refuses every clear that is not four rows at once.

## Run it

```bash
npm install
npm start                       # http://127.0.0.1:8099

npm test                        # engine + bot unit tests (fast, deterministic)
npm run test:e2e                # conformance + game + bot suites in a real browser
node scripts/run-bot.mjs        # bot scoreboard over a set of seeds
node scripts/verify-archive.mjs # package the zip and run conformance against it
```

Full notes, the protocol map, and tuning results: [docs/index.md](docs/index.md).
