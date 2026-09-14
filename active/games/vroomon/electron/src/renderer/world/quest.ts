// A tiny quest director: from the world state (mentor met, brands earned,
// houses joined) it tells the player what to do next. Pure + unit-testable.

export interface QuestLine {
  main: string;
  hint: string;
}

interface QuestBiome {
  houseBiome: string;
  brand: string;
  venue: string;
  boss: string;
}

const ORDER: QuestBiome[] = [
  { houseBiome: "grassland", brand: "Grassland Brand", venue: "Rustler Pasture", boss: "Roundup King" },
  { houseBiome: "sand", brand: "Salt Road Brand", venue: "Salt Road Post", boss: "Wreck Marshal" },
  { houseBiome: "hills", brand: "Highland Brand", venue: "Highland Mesa", boss: "Guru of the Updrafts" },
  { houseBiome: "rocky", brand: "Canyon Brand", venue: "Canyon Quarry", boss: "The Ringleader" },
  { houseBiome: "ice", brand: "Perimeter Brand", venue: "Drift Perimeter", boss: "The Frost Baron" },
];

export function questFor(world: {
  badges: string[];
  factionChoices: Record<string, string>;
  flags: Record<string, boolean>;
}): QuestLine {
  if (!world.flags["met-axle"]) {
    return {
      main: "Talk to Professor Axle at the schoolhouse (Z).",
      hint: "He holds your starter DNA and the Record Barn key.",
    };
  }

  for (const biome of ORDER) {
    if (world.badges.includes(biome.brand)) {
      continue;
    }
    const joined = world.factionChoices[biome.houseBiome];
    return {
      main: `Next: ${biome.venue} — race ${biome.boss} to settle the feud.`,
      hint: joined
        ? "Win the line and the Brand is yours."
        : `First, choose your house in ${biome.venue} (${biome.boss} or their rival).`,
    };
  }

  if (!world.flags["grand-roundup"]) {
    return {
      main: "All five Brands! Run the Grand Roundup at Rustler Pasture.",
      hint: "You'll need a champion in the Record Barn to enter.",
    };
  }

  return {
    main: "The Record Barn holds your champion.",
    hint: "Ride on — or chase a faster genome back on the Flat.",
  };
}
