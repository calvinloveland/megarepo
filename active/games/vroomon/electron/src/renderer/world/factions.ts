// Worldbuilding layer: each biome is its own mini-culture with two rival
// households. Racing/ranching vernacular replaces the older "gym/badge"
// fiction (no Pokemon residue). The player picks a side per biome; the
// choice persists in WorldState.factionChoices and colors local dialogue.

export interface Faction {
  id: string;
  biomeId: string;
  biomeName: string;
  house: string;
  title: string;
  credo: string;
}

export const FACTIONS: Faction[] = [
  {
    id: "greensprouts",
    biomeId: "grassland",
    biomeName: "Grassland",
    house: "Greensprout Grazers",
    title: "Meadow Elder",
    credo: "Slow-grown and sturdy; the grass always grows back.",
  },
  {
    id: "redlines",
    biomeId: "grassland",
    biomeName: "Grassland",
    house: "Redline Rustlers",
    title: "Roundup King",
    credo: "Cut the fastest calf and run it at the summer circuit.",
  },
  {
    id: "commission",
    biomeId: "flat",
    biomeName: "Flat",
    house: "Commission Herds",
    title: "King of the Commission",
    credo: "One spec herd for the freight lanes — predictable and legal.",
  },
  {
    id: "freewheelers",
    biomeId: "flat",
    biomeName: "Flat",
    house: "Freewheelers",
    title: "King of the Underroads",
    credo: "Records are made under the streets, off the books.",
  },
  {
    id: "saltcaravan",
    biomeId: "sand",
    biomeName: "Sand",
    house: "Salt Road Caravan",
    title: "Trail Boss of the Salt Road",
    credo: "Water rights and safe passage: the caravan moves together.",
  },
  {
    id: "wreckpickers",
    biomeId: "sand",
    biomeName: "Sand",
    house: "Wreckpickers",
    title: "Wreck Marshal",
    credo: "Salvage genes from the dune wrecks; no questions asked.",
  },
  {
    id: "skimmers",
    biomeId: "hills",
    biomeName: "Hills",
    house: "Summit Skimmers",
    title: "Guru of the Updrafts",
    credo: "Lightest chassis, updraft lines; the sky teaches patience.",
  },
  {
    id: "miners",
    biomeId: "hills",
    biomeName: "Hills",
    house: "Hill-Down Miners",
    title: "Guru of the Stone Path",
    credo: "Low-slung burrowers; the stone pays in mineral rights.",
  },
  {
    id: "union",
    biomeId: "rocky",
    biomeName: "Rocky",
    house: "Stonecutters' Union",
    title: "The Lay Foreman",
    credo: "Safety boards, group insurance, and durable DNA.",
  },
  {
    id: "runners",
    biomeId: "rocky",
    biomeName: "Rocky",
    house: "Canyon Runners",
    title: "The Ringleader",
    credo: "Airtime, flare wheels, and the bookmaker's odds.",
  },
  {
    id: "herdsmen",
    biomeId: "ice",
    biomeName: "Ice",
    house: "Aurora Herdsmen",
    title: "Keeper of the Long Light",
    credo: "Oldest lineages on the ice, bred slow under the aurora.",
  },
  {
    id: "drift-syndicate",
    biomeId: "ice",
    biomeName: "Ice",
    house: "Drift Syndicate",
    title: "The Frost Baron",
    credo: "Ice-road freight with no receipt and no refusal.",
  },
];

export function findFaction(factionId: string | null | undefined): Faction | null {
  if (!factionId) {
    return null;
  }
  return FACTIONS.find((faction) => faction.id === factionId) ?? null;
}

export function factionsForBiome(biomeId: string): Faction[] {
  return FACTIONS.filter((faction) => faction.biomeId === biomeId);
}

export function joinedFactionForBiome(
  factionChoices: Record<string, string>,
  biomeId: string,
): Faction | null {
  return findFaction(factionChoices[biomeId]);
}