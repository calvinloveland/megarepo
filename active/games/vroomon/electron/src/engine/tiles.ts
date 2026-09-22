/**
 * Tile definitions.
 *
 * A tile id is a string in a map; its *meaning* — is it solid, does it roll for
 * an encounter, what does it look like — lives in a tileset. Maps name tiles,
 * tilesets decide what they do, and the two are checked against each other when
 * a map is defined, so a typo like `"tall_gras"` fails at startup instead of
 * silently becoming walkable ground.
 */

export interface TileDefinition {
  id: string;
  /** Blocks movement. */
  solid?: boolean;
  /** An encounter-table id; stepping here (or walking over it) rolls. */
  encounter?: string;
  /** Free-form grouping used by generators, renderers and validators. */
  tags?: string[];
}

export interface TileSet {
  readonly id: string;
  readonly ids: readonly string[];
  has(id: string): boolean;
  define(id: string): TileDefinition;
  isSolid(id: string): boolean;
  encounterFor(id: string): string | null;
  /** Every tile id carrying a tag, in definition order. */
  withTag(tag: string): string[];
}

export function createTileSet(id: string, definitions: readonly TileDefinition[]): TileSet {
  const byId = new Map<string, TileDefinition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`tileset "${id}" defines "${definition.id}" twice`);
    }
    byId.set(definition.id, { ...definition, tags: definition.tags ? [...definition.tags] : undefined });
  }
  if (byId.size === 0) {
    throw new Error(`tileset "${id}" has no tiles`);
  }

  const ids = [...byId.keys()];
  const define = (tileId: string): TileDefinition => {
    const found = byId.get(tileId);
    if (!found) {
      throw new Error(`tileset "${id}" has no tile "${tileId}"`);
    }
    return found;
  };

  return {
    id,
    ids,
    has: (tileId) => byId.has(tileId),
    define,
    isSolid: (tileId) => define(tileId).solid === true,
    encounterFor: (tileId) => define(tileId).encounter ?? null,
    withTag: (tag) => definitions.filter((definition) => definition.tags?.includes(tag)).map((d) => d.id),
  };
}
