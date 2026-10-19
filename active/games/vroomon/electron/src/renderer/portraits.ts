// Parameterized pixel-bust portraits for overworld dialogue, drawn as inline
// SVG from an archetype table (no image assets). Every archetype shares the
// same face geometry so the style stays coherent; markers (caps, beards,
// scars, crowns) tell each host apart.

type ArchetypeKey =
  | "scholar"
  | "elder"
  | "king"
  | "marshal"
  | "boss"
  | "shopkeep"
  | "rider"
  | "rider-alt"
  | "highlander"
  | "miner"
  | "courier"
  | "foreman"
  | "sage"
  | "generic"
  | "narrator";

interface Archetype {
  skin: string;
  cap: string;
  beard?: "grey" | "brown";
  marker: string;
  markerColor: string;
  glasses?: boolean;
  patch?: boolean;
  bandana?: string;
}

const ARCHETYPES: Record<ArchetypeKey, Archetype> = {
  scholar: { skin: "#e8c9a0", cap: "#5a5148", glasses: true, marker: "lens", markerColor: "#cfe0ea" },
  elder: { skin: "#d9b48a", cap: "#8ab4ff", beard: "grey", marker: "staff", markerColor: "#a06a3b" },
  king: { skin: "#d9b48a", cap: "#caa672", beard: "brown", marker: "crown", markerColor: "#ffd166" },
  marshal: { skin: "#c9a176", cap: "#8f3b2e", patch: true, marker: "star", markerColor: "#ffd166" },
  boss: { skin: "#d9b48a", cap: "#7d4e24", bandana: "#6d2608", marker: "badge", markerColor: "#9bc16a" },
  shopkeep: { skin: "#e8c9a0", cap: "#3b5468", marker: "coin", markerColor: "#ffd166" },
  rider: { skin: "#e8c9a0", cap: "#2c5f7a", bandana: "#4f9e55", marker: "goggles", markerColor: "#cfe0ea" },
  "rider-alt": { skin: "#d9b48a", cap: "#8f5a28", bandana: "#8f3b2e", marker: "goggles", markerColor: "#cfe0ea" },
  highlander: { skin: "#d9b48a", cap: "#5a5148", marker: "earmuffs", markerColor: "#79c9c9" },
  miner: { skin: "#c9a176", cap: "#6d6d6d", marker: "lamp", markerColor: "#ffd166" },
  courier: { skin: "#e0c2a2", cap: "#3d5a80", beard: "grey", marker: "fluff", markerColor: "#e8f1f8" },
  foreman: { skin: "#d9b48a", cap: "#e0b01a", marker: "stripe", markerColor: "#fff4d1" },
  sage: { skin: "#c9a176", cap: "#7a5c3e", beard: "grey", marker: "wrap", markerColor: "#8ab4ff" },
  generic: { skin: "#d9b48a", cap: "#5a5148", bandana: "#4f9e55", marker: "band", markerColor: "#9bc16a" },
  narrator: { skin: "#e8c9a0", cap: "#3b3b45", marker: "quill", markerColor: "#f8fbff" },
};

// NPC id -> archetype (id alone is enough; unknown ids get a generic bust).
const NPC_ARCHETYPES: Record<string, ArchetypeKey> = {
  // The rancher who takes you in: hat and all, matching his overworld sprite.
  // He had no entry at all, so the tutorial's most important face was the
  // generic fallback while his sprite was a bespectacled professor.
  "robby-kitchen": "rider",
  "robby-reveal-1": "rider",
  "robby-reveal-2": "rider",
  "robby-reveal-3": "rider",
  "robby-reveal-4": "rider",
  "robby-yard-1": "rider",
  "robby-yard-2": "rider",
  "robby-yard-3": "rider",
  "robby-caught-1": "rider",
  "robby-caught-2": "rider",
  "robby-caught-3": "rider",
  "robby-caught-4": "rider",
  "professor-axle": "scholar",
  "professor-axle-2": "scholar",
  "meadow-elder": "elder",
  "roundup-king": "king",
  "king-join-faction": "king",
  "wreck-marshal": "marshal",
  "trail-boss": "boss",
  shopkeeper: "shopkeep",
  "rival-vicky": "rider",
  "rival-marcus": "rider-alt",
  "highland-herder": "highlander",
  "skimmers-herder": "highlander",
  "canyon-hauler": "miner",
  "frost-courier": "courier",
  "lay-foreman": "foreman",
  "union-boss": "foreman",
  "guru-of-the-updrafts": "sage",
  "guru-of-the-canyons": "sage",
  "keeper-of-the-long-light": "courier",
};

// ---- The bust ----
// A portrait is the same pixel grid as the overworld sprites, blown up: the
// face a player talks to should look like the person they walked up to, not
// like a smooth vector illustration standing next to a pixel-art town. Cells
// are emitted as SVG rects so the picture stays crisp at any size and there is
// still no image asset to ship.

const CELL = 6;
const GRID_COLS = 26;
const GRID_ROWS = 30;
const OUTLINE = "#1b1109";

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

function shade(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const parse = (offset: number): number => parseInt(clean.slice(offset, offset + 2), 16);
  const channel = (value: number): string => {
    const next = amount < 0 ? value * (1 + amount) : value + (255 - value) * amount;
    return Math.round(next).toString(16).padStart(2, "0");
  };
  return `#${channel(parse(0))}${channel(parse(2))}${channel(parse(4))}`;
}

/** Fill a rectangle of cells, clipped to the grid so a bad number cannot paint
 * outside the portrait frame. */
function block(
  cells: Cell[],
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(GRID_COLS, x + w);
  const y1 = Math.min(GRID_ROWS, y + h);
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  cells.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill });
}

const MARKER_GLYPHS: Record<string, string> = {
  crown: "♛",
  staff: "𝍏",
  goggles: "⌐",
  lamp: "◉",
  wrap: "◠",
  quill: "✎",
  fluff: "☁",
  earmuffs: "☁",
  coin: "●",
  star: "★",
  badge: "▣",
  stripe: "▲",
  band: "▭",
  lens: "•",
};

function bustCells(archetype: Archetype): Cell[] {
  const cells: Cell[] = [];
  const skin = archetype.skin;
  const skinShade = shade(skin, -0.2);
  const cap = archetype.cap;
  const capShade = shade(cap, -0.32);
  const cloth = shade(cap, 0.1);

  // Frame and a dithered backdrop, so the bust sits inside a window.
  block(cells, 0, 0, GRID_COLS, GRID_ROWS, "#171019");
  block(cells, 1, 1, GRID_COLS - 2, GRID_ROWS - 2, "#241a1b");
  for (let y = 3; y < GRID_ROWS - 3; y += 2) {
    for (let x = 3 + ((y / 2) % 2) * 2; x < GRID_COLS - 3; x += 4) {
      block(cells, x, y, 1, 1, "#2c2020");
    }
  }

  // Shoulders, tapering up into the neck so the frame cuts a chest rather
  // than slicing a torso in half.
  block(cells, 3, 22, 20, 8, OUTLINE);
  block(cells, 4, 23, 18, 7, cloth);
  block(cells, 4, 23, 18, 2, shade(cap, 0.24));
  block(cells, 12, 23, 2, 7, capShade);
  block(cells, 8, 23, 2, 4, shade(cloth, 0.34));
  block(cells, 16, 23, 2, 4, shade(cloth, 0.34));

  // Neck.
  block(cells, 11, 19, 4, 4, OUTLINE);
  block(cells, 12, 19, 2, 4, skinShade);

  // Head: wide, like the overworld sprite's — a narrow face over wide
  // shoulders is the shape of a chess piece, not of the character you walked
  // up to.
  block(cells, 5, 4, 16, 17, OUTLINE);
  block(cells, 6, 5, 14, 15, skin);
  block(cells, 7, 7, 4, 2, shade(skin, 0.14));
  block(cells, 6, 16, 14, 4, shade(skin, -0.06));
  block(cells, 17, 9, 3, 9, skinShade);

  // Hair under the cap.
  block(cells, 6, 4, 14, 2, shade(cap, -0.6));

  // Brows, eyes, nose, mouth.
  block(cells, 8, 11, 3, 1, OUTLINE);
  block(cells, 16, 11, 3, 1, OUTLINE);
  block(cells, 8, 12, 2, 2, OUTLINE);
  block(cells, 16, 12, 2, 2, OUTLINE);
  block(cells, 8, 12, 1, 1, "#f4f1e8");
  block(cells, 16, 12, 1, 1, "#f4f1e8");
  block(cells, 12, 13, 2, 2, skinShade);
  block(cells, 12, 17, 2, 1, skinShade);
  block(cells, 11, 18, 4, 1, "#8a5340");

  // The cap: crown, band, then a brim a cell wider than the head.
  block(cells, 5, 0, 16, 6, OUTLINE);
  block(cells, 6, 1, 14, 3, cap);
  block(cells, 6, 1, 14, 1, shade(cap, 0.26));
  block(cells, 6, 4, 14, 1, capShade);
  block(cells, 3, 5, 20, 1, OUTLINE);
  block(cells, 3, 5, 20, 1, shade(cap, -0.1));

  if (archetype.beard) {
    const hair = archetype.beard === "grey" ? "#ded7c6" : "#7a4a1e";
    block(cells, 6, 16, 14, 2, hair);
    block(cells, 7, 18, 12, 4, hair);
    block(cells, 11, 18, 4, 1, "#8a5340");
    block(cells, 12, 22, 2, 1, hair);
    block(cells, 7, 16, 12, 1, shade(hair, -0.3));
  }
  if (archetype.bandana) {
    block(cells, 7, 21, 12, 3, archetype.bandana);
    block(cells, 7, 21, 12, 1, shade(archetype.bandana, 0.22));
  }
  if (archetype.glasses) {
    block(cells, 6, 11, 6, 4, OUTLINE);
    block(cells, 14, 11, 6, 4, OUTLINE);
    block(cells, 7, 12, 4, 2, archetype.markerColor);
    block(cells, 15, 12, 4, 2, archetype.markerColor);
    block(cells, 12, 13, 2, 1, OUTLINE);
  }
  if (archetype.patch) {
    block(cells, 14, 10, 6, 5, "#2a2a33");
    block(cells, 14, 10, 6, 1, "#3c3c48");
    block(cells, 8, 10, 1, 11, "#3c3c48");
  }
  return cells;
}

function bustFor(archetype: Archetype, name: string): string {
  const cells = bustCells(archetype);
  const rects = cells
    .map(
      (cell) =>
        `<rect x="${cell.x * CELL}" y="${cell.y * CELL}" width="${cell.w * CELL}" height="${cell.h * CELL}" fill="${cell.fill}"/>`,
    )
    .join("");
  const glyph = MARKER_GLYPHS[archetype.marker] ?? "•";
  // The trade mark sits in the corner of the frame, like a stamp on a card,
  // instead of over the host's mouth.
  const marker = `<text x="${GRID_COLS * CELL - 8}" y="${GRID_ROWS * CELL - 8}" font-size="13" text-anchor="end" fill="${archetype.markerColor}" font-family="monospace" font-weight="bold">${glyph}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_COLS * CELL} ${GRID_ROWS * CELL}" width="${GRID_COLS * CELL}" height="${GRID_ROWS * CELL}" shape-rendering="crispEdges" role="img" aria-label="Portrait of ${name.replace(/&/g, "&amp;")}">
  ${rects}
  ${marker}
</svg>`;
}

let genericPortrait: string | null = null;
let narratorPortrait: string | null = null;

/** Portrait for an NPC (by id or name fallback); narrator gets a quill bust. */
export function portraitSvgFor(npcId: string | null, npcName: string): string {
  const key = npcId ? NPC_ARCHETYPES[npcId] : null;
  if (key) {
    return bustFor(ARCHETYPES[key]!, npcName);
  }
  if (npcName === "Narrator" || !npcId) {
    narratorPortrait ??= bustFor(ARCHETYPES.narrator, "Narrator");
    return narratorPortrait;
  }
  genericPortrait ??= bustFor(ARCHETYPES.generic, "the rancher");
  return genericPortrait;
}
