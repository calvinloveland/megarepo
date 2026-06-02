export type PeriodicEntry = {
  atomicNumber: number;
  symbol: string;
  row: number;
  col: number;
};

export type PeriodicCell = PeriodicEntry & {
  state: "discovered" | "unknown";
};

// Enough for the current game arc (through Gold/Lead) while keeping the table shape.
export const PERIODIC_LAYOUT: PeriodicEntry[] = [
  { atomicNumber: 1, symbol: "H", row: 1, col: 1 },
  { atomicNumber: 2, symbol: "He", row: 1, col: 18 },
  { atomicNumber: 3, symbol: "Li", row: 2, col: 1 },
  { atomicNumber: 4, symbol: "Be", row: 2, col: 2 },
  { atomicNumber: 5, symbol: "B", row: 2, col: 13 },
  { atomicNumber: 6, symbol: "C", row: 2, col: 14 },
  { atomicNumber: 7, symbol: "N", row: 2, col: 15 },
  { atomicNumber: 8, symbol: "O", row: 2, col: 16 },
  { atomicNumber: 9, symbol: "F", row: 2, col: 17 },
  { atomicNumber: 10, symbol: "Ne", row: 2, col: 18 },
  { atomicNumber: 11, symbol: "Na", row: 3, col: 1 },
  { atomicNumber: 12, symbol: "Mg", row: 3, col: 2 },
  { atomicNumber: 13, symbol: "Al", row: 3, col: 13 },
  { atomicNumber: 14, symbol: "Si", row: 3, col: 14 },
  { atomicNumber: 15, symbol: "P", row: 3, col: 15 },
  { atomicNumber: 16, symbol: "S", row: 3, col: 16 },
  { atomicNumber: 17, symbol: "Cl", row: 3, col: 17 },
  { atomicNumber: 18, symbol: "Ar", row: 3, col: 18 },
  { atomicNumber: 19, symbol: "K", row: 4, col: 1 },
  { atomicNumber: 20, symbol: "Ca", row: 4, col: 2 },
  { atomicNumber: 21, symbol: "Sc", row: 4, col: 3 },
  { atomicNumber: 22, symbol: "Ti", row: 4, col: 4 },
  { atomicNumber: 23, symbol: "V", row: 4, col: 5 },
  { atomicNumber: 24, symbol: "Cr", row: 4, col: 6 },
  { atomicNumber: 25, symbol: "Mn", row: 4, col: 7 },
  { atomicNumber: 26, symbol: "Fe", row: 4, col: 8 },
  { atomicNumber: 27, symbol: "Co", row: 4, col: 9 },
  { atomicNumber: 28, symbol: "Ni", row: 4, col: 10 },
  { atomicNumber: 29, symbol: "Cu", row: 4, col: 11 },
  { atomicNumber: 30, symbol: "Zn", row: 4, col: 12 },
  { atomicNumber: 31, symbol: "Ga", row: 4, col: 13 },
  { atomicNumber: 32, symbol: "Ge", row: 4, col: 14 },
  { atomicNumber: 33, symbol: "As", row: 4, col: 15 },
  { atomicNumber: 34, symbol: "Se", row: 4, col: 16 },
  { atomicNumber: 35, symbol: "Br", row: 4, col: 17 },
  { atomicNumber: 36, symbol: "Kr", row: 4, col: 18 },
  { atomicNumber: 37, symbol: "Rb", row: 5, col: 1 },
  { atomicNumber: 38, symbol: "Sr", row: 5, col: 2 },
  { atomicNumber: 39, symbol: "Y", row: 5, col: 3 },
  { atomicNumber: 40, symbol: "Zr", row: 5, col: 4 },
  { atomicNumber: 41, symbol: "Nb", row: 5, col: 5 },
  { atomicNumber: 42, symbol: "Mo", row: 5, col: 6 },
  { atomicNumber: 43, symbol: "Tc", row: 5, col: 7 },
  { atomicNumber: 44, symbol: "Ru", row: 5, col: 8 },
  { atomicNumber: 45, symbol: "Rh", row: 5, col: 9 },
  { atomicNumber: 46, symbol: "Pd", row: 5, col: 10 },
  { atomicNumber: 47, symbol: "Ag", row: 5, col: 11 },
  { atomicNumber: 48, symbol: "Cd", row: 5, col: 12 },
  { atomicNumber: 49, symbol: "In", row: 5, col: 13 },
  { atomicNumber: 50, symbol: "Sn", row: 5, col: 14 },
  { atomicNumber: 51, symbol: "Sb", row: 5, col: 15 },
  { atomicNumber: 52, symbol: "Te", row: 5, col: 16 },
  { atomicNumber: 53, symbol: "I", row: 5, col: 17 },
  { atomicNumber: 54, symbol: "Xe", row: 5, col: 18 },
  { atomicNumber: 55, symbol: "Cs", row: 6, col: 1 },
  { atomicNumber: 56, symbol: "Ba", row: 6, col: 2 },
  { atomicNumber: 57, symbol: "La", row: 8, col: 3 },
  { atomicNumber: 58, symbol: "Ce", row: 8, col: 4 },
  { atomicNumber: 59, symbol: "Pr", row: 8, col: 5 },
  { atomicNumber: 60, symbol: "Nd", row: 8, col: 6 },
  { atomicNumber: 61, symbol: "Pm", row: 8, col: 7 },
  { atomicNumber: 62, symbol: "Sm", row: 8, col: 8 },
  { atomicNumber: 63, symbol: "Eu", row: 8, col: 9 },
  { atomicNumber: 64, symbol: "Gd", row: 8, col: 10 },
  { atomicNumber: 65, symbol: "Tb", row: 8, col: 11 },
  { atomicNumber: 66, symbol: "Dy", row: 8, col: 12 },
  { atomicNumber: 67, symbol: "Ho", row: 8, col: 13 },
  { atomicNumber: 68, symbol: "Er", row: 8, col: 14 },
  { atomicNumber: 69, symbol: "Tm", row: 8, col: 15 },
  { atomicNumber: 70, symbol: "Yb", row: 8, col: 16 },
  { atomicNumber: 71, symbol: "Lu", row: 8, col: 17 },
  { atomicNumber: 72, symbol: "Hf", row: 6, col: 4 },
  { atomicNumber: 73, symbol: "Ta", row: 6, col: 5 },
  { atomicNumber: 74, symbol: "W", row: 6, col: 6 },
  { atomicNumber: 75, symbol: "Re", row: 6, col: 7 },
  { atomicNumber: 76, symbol: "Os", row: 6, col: 8 },
  { atomicNumber: 77, symbol: "Ir", row: 6, col: 9 },
  { atomicNumber: 78, symbol: "Pt", row: 6, col: 10 },
  { atomicNumber: 79, symbol: "Au", row: 6, col: 11 },
  { atomicNumber: 80, symbol: "Hg", row: 6, col: 12 },
  { atomicNumber: 81, symbol: "Tl", row: 6, col: 13 },
  { atomicNumber: 82, symbol: "Pb", row: 6, col: 14 },
];

export function buildPeriodicCells(discoveredAtomics: Set<number>): PeriodicCell[] {
  const maxAtomic = discoveredAtomics.size ? Math.max(...discoveredAtomics) : 0;
  return PERIODIC_LAYOUT
    .filter((entry) => entry.atomicNumber <= maxAtomic)
    .map((entry) => ({
      ...entry,
      state: discoveredAtomics.has(entry.atomicNumber) ? "discovered" : "unknown",
    }));
}

export function getHeaviestDiscoveredAtomic(discoveredAtomics: Set<number>) {
  return discoveredAtomics.size ? Math.max(...discoveredAtomics) : 0;
}
