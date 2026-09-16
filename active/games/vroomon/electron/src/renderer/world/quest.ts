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
  currentMapId?: string | null;
}): QuestLine {
  // The opening ranch tutorial is its own objective line until Robby
  // sends the player into town. The ranch is two spaces now — the house and
  // the yard outside it — and both count as "at the ranch".
  if (world.currentMapId === "home_ranch" || world.currentMapId === "ranch_yard") {
    if (!world.flags["tut-revealed"]) {
      return {
        main: "Robby's in the kitchen — follow the call.",
        hint: "It smells like he's already started the day without you.",
      };
    }
    if (!world.flags["tut-caught"]) {
      return {
        main: "The tall grass on the left grazes wild vroomon.",
        hint: "Stand at its edge and press Z when it shakes — then race it for the herd.",
      };
    }
    if (!world.flags["tut-done"]) {
      return {
        main: "Show Robby your Herd Book — he's waiting by the paddock.",
        hint: "Then he's sending you into town with the rest of the day.",
      };
    }
    return {
      main: "The garden gate opens onto town.",
      hint: "Explore Starter Town — the road's yours now.",
    };
  }
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
