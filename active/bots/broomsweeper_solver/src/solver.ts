import type { BoardSpec, SolverResult, TileAnalysis } from "./types";
import { detectSlugTiles } from "./image";

export function solveBoard(imageData: ImageData, board: BoardSpec): SolverResult {
  const slugTiles = detectSlugTiles(imageData, board);
  const annotations = buildAnnotations(slugTiles);
  return { annotations, slugTiles };
}

function buildAnnotations(slugTiles: TileAnalysis[]): SolverResult["annotations"] {
  return slugTiles
    .filter((tile) => tile.slugLie)
    .map((tile) => ({
      row: tile.row,
      col: tile.col,
      label: "Slug?",
      color: "#a855f7"
    }));
}
