export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoardSpec = {
  rows: number;
  cols: number;
  bounds: Rect;
};

export type TileAnalysis = {
  row: number;
  col: number;
  slugLie: boolean;
};

export type Annotation = {
  row: number;
  col: number;
  label: string;
  color: string;
};

export type SolverResult = {
  annotations: Annotation[];
  slugTiles: TileAnalysis[];
};

export type TileLabel = {
  row: number;
  col: number;
  label: string;
};

export type LabelExport = {
  image: string;
  rows: number;
  cols: number;
  bounds: Rect;
  labels: TileLabel[];
  createdAt: string;
};
