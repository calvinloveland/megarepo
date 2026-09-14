// Single source of truth for overworld sprite colors. The canvas renderer
// can't read CSS custom properties, so these constants mirror the warm
// meadow theme from game.html (cream skins, gold/earth, navy inks).
//
// Faction houses each own a signature accent so their overworld hosts read
// as faction-coded at a glance (drawn as the band across the sprite's head).

export const SPRITE_PALETTE = {
  skin: {
    light: "#f7d4a0", // most NPCs
    mid: "#f0c896", // warm-tanned NPCs
    dark: "#7a5a3a", // signage
  },
  ink: {
    eyes: "#0a0a0a",
    feet: "#1a1a1a",
  },
  shadow: "rgba(0,0,0,0.18)",
  cap: {
    navy: "#1f3a5a",
    red: "#cf3a3a",
    green: "#2f7a3a",
  },
  body: {
    navy: "#2a4a7a", // rancher player
    purple: "#5a3a8a", // professor
    maroon: "#7a3a3a", // mechanic
    green: "#3a8a5a", // rider
    charcoal: "#3a3a3a", // gym-leader
    brown: "#5a4530", // sign
    gray: "#444444", // default
  },
  accent: {
    white: "#f0f0f0", // professor
    red: "#cf3a3a", // mechanic
    gold: "#ffd166", // rider / gym-leader / race leader + HUD highlights
    tan: "#3a2a1a", // sign
    gray: "#999999", // default
    blue: "#7dd3fc", // race selected
  },
} as const;

/** Signature accents per faction house (used by overworld hosts). */
export const HOUSE_ACCENTS: Record<string, string> = {
  greensprouts: "#6fb44d", // meadow grass
  redlines: "#cf3a3a", // rust red
  saltcaravan: "#c2a670", // dune tan
  wreckpickers: "#8a7a5a", // salvage brown
  skimmers: "#9ad0e8", // summit sky
  miners: "#8a6a4a", // stone brown
  union: "#5a8ac2", // safety blue
  runners: "#ff8a4a", // stunt orange
  herdsmen: "#b8d8f0", // aurora pale
  "drift-syndicate": "#8a9ab8", // ice slate
} as const;

/** Overworld host NPC id -> faction house accent. */
export const HOST_ACCENTS: Record<string, string> = {
  "meadow-elder": HOUSE_ACCENTS.greensprouts,
  "roundup-king": HOUSE_ACCENTS.redlines,
  "trail-boss": HOUSE_ACCENTS.saltcaravan,
  "wreck-marshal": HOUSE_ACCENTS.wreckpickers,
  "guru-updrafts": HOUSE_ACCENTS.skimmers,
  "guru-stone": HOUSE_ACCENTS.miners,
  "lay-foreman": HOUSE_ACCENTS.union,
  "canyon-ringleader": HOUSE_ACCENTS.runners,
  "keeper-long-light": HOUSE_ACCENTS.herdsmen,
  "frost-baron": HOUSE_ACCENTS["drift-syndicate"],
} as const;

export function houseAccentForNpc(npcId: string): string | null {
  return HOST_ACCENTS[npcId] ?? null;
}