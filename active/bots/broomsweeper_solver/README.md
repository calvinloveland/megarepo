# Broomsweeper Solver

TypeScript + Vite webapp for annotating Broomsweeper screenshots and building a labeled dataset.

## Requirements

- Node.js 18+
- npm

## Install

```bash
cd /workspaces/megarepo/active/bots/broomsweeper_solver
npm install
```

## Run

```bash
npm run dev
```

Open the URL printed by Vite (default http://localhost:5174).

## Usage

### Solver mode

1. Select Solver tab.
2. Upload a screenshot.
3. Click top-left and bottom-right of the board to set bounds (or auto-detect).
4. Enter rows/columns and run the solver.
5. Export the annotated image.

### Labeler mode

1. Place screenshots in data/ (png/jpg/jpeg).
2. Select Labeler tab.
3. Choose a dataset image from the dropdown.
4. Click top-left and bottom-right of the board to set bounds (or auto-detect).
5. Pick a label from the palette and click tiles.
6. (Optional) Auto-label tiles using existing labels.
7. Export labels to JSON.

### Diagnostics tab

Use Diagnostics to validate labels against the classifier and list any mismatches.

## Tests

```bash
npm test
```

### Saving labels next to data/

By default, exports are sent to the local dev server and written into data/.
If the server is unavailable, you can use "Pick label output folder" to select
data/ and save directly. If directory access is not supported, the label file will
download instead.

## Output format

Label exports are JSON files with:

- image: filename of the dataset image
- rows/cols: grid size
- bounds: pixel rectangle of the board
- labels: array of { row, col, label }
- createdAt: ISO timestamp

## Notes

- The labeler is intended to bootstrap tile classification for the solver.
- Add new images to data/ and refresh the page.
