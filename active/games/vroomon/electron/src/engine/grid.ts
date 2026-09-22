/**
 * A tile grid and the traversals every map needs.
 *
 * Grids are the one data structure the whole engine agrees on: maps, mazes,
 * collision and reachability all speak in `"x,y"` cell keys so a path found by
 * the maze generator is a path the player can walk.
 */

export interface Cell {
  x: number;
  y: number;
}

export interface Grid<T> {
  readonly width: number;
  readonly height: number;
  get(x: number, y: number): T | undefined;
  set(x: number, y: number, value: T): void;
  inBounds(x: number, y: number): boolean;
  /** Every value, row-major. */
  values(): T[];
  /** A shallow copy of the rows, ready to serialise or hand to a renderer. */
  rows(): T[][];
  forEach(visit: (value: T, x: number, y: number) => void): void;
  find(match: (value: T, x: number, y: number) => boolean): Cell | null;
  count(match: (value: T, x: number, y: number) => boolean): number;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseTileKey(key: string): Cell {
  const [x, y] = key.split(",");
  return { x: Number(x), y: Number(y) };
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

/** The four orthogonal neighbours of a cell, in N/E/S/W order. */
export function neighbors4(x: number, y: number): Cell[] {
  return [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ];
}

export function createGrid<T>(
  width: number,
  height: number,
  fill: T | ((x: number, y: number) => T),
): Grid<T> {
  if (width < 1 || height < 1) {
    throw new Error(`createGrid needs positive dimensions, got ${width}x${height}`);
  }
  const rows: T[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: T[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push(typeof fill === "function" ? (fill as (x: number, y: number) => T)(x, y) : fill);
    }
    rows.push(row);
  }
  return gridFromRows(rows);
}

/**
 * Wrap rows a generator already produced (a maze, a hand-authored map) without
 * copying them, and reject ragged input: a ragged map is a crash waiting for
 * the one coordinate that is out of range.
 */
export function gridFromRows<T>(rows: readonly (readonly T[])[]): Grid<T> {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  for (let y = 0; y < height; y += 1) {
    if (rows[y]!.length !== width) {
      throw new Error(
        `gridFromRows: row ${y} has ${rows[y]!.length} columns, expected ${width}`,
      );
    }
  }
  return {
    width,
    height,
    get: (x, y) => (inBounds(width, height, x, y) ? rows[y]![x] : undefined),
    set: (x, y, value) => {
      if (!inBounds(width, height, x, y)) {
        throw new Error(`grid.set(${x}, ${y}) is outside ${width}x${height}`);
      }
      (rows[y] as T[])[x] = value;
    },
    inBounds: (x, y) => inBounds(width, height, x, y),
    values: () => rows.flat() as T[],
    rows: () => rows.map((row) => [...row]),
    forEach: (visit) => {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          visit(rows[y]![x]!, x, y);
        }
      }
    },
    find: (match) => {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (match(rows[y]![x]!, x, y)) {
            return { x, y };
          }
        }
      }
      return null;
    },
    count: (match) => {
      let total = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (match(rows[y]![x]!, x, y)) {
            total += 1;
          }
        }
      }
      return total;
    },
  };
}

/**
 * The cells reachable from `starts` through open ground (breadth-first), as a
 * set of tile keys. Reachability is the workhorse of the content invariants:
 * "can the player actually get there" is a question about this set.
 */
export function floodFill<T>(
  grid: Grid<T>,
  starts: readonly Cell[],
  isOpen: (value: T, x: number, y: number) => boolean,
): Set<string> {
  const seen = new Set<string>();
  const queue: Cell[] = [];
  for (const start of starts) {
    const value = grid.get(start.x, start.y);
    if (value !== undefined && isOpen(value, start.x, start.y) && !seen.has(tileKey(start.x, start.y))) {
      seen.add(tileKey(start.x, start.y));
      queue.push(start);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbors4(current.x, current.y)) {
      const key = tileKey(next.x, next.y);
      if (seen.has(key)) {
        continue;
      }
      const value = grid.get(next.x, next.y);
      if (value === undefined || !isOpen(value, next.x, next.y)) {
        continue;
      }
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Breadth-first shortest path between two cells, or null when there is none.
 * Returned including both endpoints.
 */
export function findPath<T>(
  grid: Grid<T>,
  from: Cell,
  to: Cell,
  isOpen: (value: T, x: number, y: number) => boolean,
): Cell[] | null {
  const startKey = tileKey(from.x, from.y);
  const goalKey = tileKey(to.x, to.y);
  if (startKey === goalKey) {
    return [from];
  }
  const previous = new Map<string, string>();
  const queue: Cell[] = [from];
  const seen = new Set<string>([startKey]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbors4(current.x, current.y)) {
      const key = tileKey(next.x, next.y);
      if (seen.has(key)) {
        continue;
      }
      const value = grid.get(next.x, next.y);
      if (value === undefined || !isOpen(value, next.x, next.y)) {
        continue;
      }
      seen.add(key);
      previous.set(key, tileKey(current.x, current.y));
      if (key === goalKey) {
        const path: Cell[] = [{ x: next.x, y: next.y }];
        let cursor = key;
        while (cursor !== startKey) {
          cursor = previous.get(cursor)!;
          path.push(parseTileKey(cursor));
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
