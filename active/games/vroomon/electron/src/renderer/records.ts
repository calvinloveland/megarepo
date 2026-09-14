import type { RecordEntry, RecordsBoard } from "../shared/parity-contract.js";

/** Per-terrain bests from Test Drive laps. Pure + unit-testable. */

export function bestRecord(
  board: RecordsBoard,
  terrainName: string,
): RecordEntry | null {
  return board.entries.find((entry) => entry.terrainName === terrainName) ?? null;
}

/** Propose a new lap; returns the updated board + whether it improved. */
export function proposeRecord(
  board: RecordsBoard,
  terrainName: string,
  dna: string,
  score: number,
  nowIso: string,
): { board: RecordsBoard; improved: boolean } {
  const existing = bestRecord(board, terrainName);
  if (existing && existing.score >= score) {
    return { board, improved: false };
  }
  const entry: RecordEntry = { terrainName, dna, score, savedAt: nowIso };
  const entries = existing
    ? board.entries.map((candidate) =>
        candidate.terrainName === terrainName ? entry : candidate,
      )
    : [...board.entries, entry];
  entries.sort((left, right) => right.score - left.score);
  return { board: { version: 1, entries }, improved: true };
}
