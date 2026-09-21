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

function bustFor(archetype: Archetype, name: string): string {
  const beard =
    archetype.beard === "grey"
      ? `<path d="M60 82 Q60 100 74 102 Q88 100 88 82 Z" fill="#e8e0d0"/>`
      : archetype.beard === "brown"
        ? `<path d="M60 82 Q60 100 74 102 Q88 100 88 82 Z" fill="#8a5a28"/>`
        : "";
  const glasses = archetype.glasses ? `
    <rect x="56" y="66" width="10" height="8" rx="2" fill="${archetype.markerColor}" opacity="0.85"/>
    <rect x="72" y="66" width="10" height="8" rx="2" fill="${archetype.markerColor}" opacity="0.85"/>
    <line x1="66" y1="70" x2="72" y2="70" stroke="#4a4a55" stroke-width="2"/>` : "";
  const patch = archetype.patch ? `
    <path d="M56 64 L66 70 L56 76 Z" fill="#2a2a33"/>` : "";
  const bandana = archetype.bandana
    ? `<path d="M52 84 L86 84 L84 94 L54 94 Z" fill="${archetype.bandana}"/>`
    : "";
  const cap = `<path d="M50 58 Q66 46 88 58 L88 66 L50 66 Z" fill="${archetype.cap}"/><rect x="50" y="58" width="38" height="6" rx="3" fill="${archetype.cap}" opacity="0.7"/>`;
  const marker = `<text x="74" y="112" font-size="12" text-anchor="middle" fill="${archetype.markerColor}" font-family="monospace" font-weight="bold">${archetype.marker === "crown" ? "♛" : archetype.marker === "staff" ? "𝍏" : archetype.marker === "goggles" ? "⌐" : archetype.marker === "lamp" ? "◉" : archetype.marker === "wrap" ? "◠" : archetype.marker === "quill" ? "✎" : archetype.marker === "fluff" ? "☁" : archetype.marker === "earmuffs" ? "☁" : archetype.marker === "coin" ? "●" : archetype.marker === "star" ? "★" : archetype.marker === "badge" ? "▣" : archetype.marker === "stripe" ? "▲" : archetype.marker === "band" ? "▭" : "•"}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="30 30 80 120" width="120" height="150" role="img" aria-label="Portrait of ${name.replace(/&/g, "&amp;")}">
  <rect x="30" y="30" width="80" height="120" rx="6" fill="#2a1d12"/>
  <circle cx="70" cy="86" r="34" fill="${archetype.cap}" opacity="0.18"/>
  <circle cx="70" cy="86" r="14" fill="${archetype.skin}"/>
  <path d="M44 100 Q70 88 96 100 L96 150 L44 150 Z" fill="${archetype.cap}" opacity="0.35"/>
  <path d="M44 96 Q70 84 96 96 L96 150 L44 150 Z" fill="${archetype.cap}" opacity="0.5"/>
  ${cap}
  ${beard}
  ${glasses}
  ${patch}
  ${bandana}
  <circle cx="62" cy="74" r="2.4" fill="#2a2320"/>
  <circle cx="78" cy="74" r="2.4" fill="#2a2320"/>
  <path d="M64 82 Q70 86 76 82" stroke="#2a2320" stroke-width="2" fill="none" stroke-linecap="round"/>
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
