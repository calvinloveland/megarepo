# vroomon

Vroomon is being rewritten from the legacy Python/pygame/pymunk prototype into an Electron-based implementation inside this project.

## Current layout

- `src/vroomon/`: legacy Python simulation and tests kept as a behavioral reference during the rewrite
- `electron/`: new Electron + TypeScript rewrite target

## Electron rewrite goals

The rewrite is targeting the richer standalone Godot branch feature set rather than only the current Python baseline. The first implementation slice focuses on:

- establishing the Electron app shell
- porting the DNA v2 core into TypeScript
- keeping deterministic, locality-preserving genome decoding covered by tests

## Electron development

From `active/games/vroomon/electron/`:

- `npm install`
- `npm test`
- `npm run build`
- `npm run profile:sim`
- `npm run package:dir`
- `npm start`
