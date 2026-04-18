import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';

export type FavoriteTargetType = 'artist' | 'artwork';

const favoritesInitialization = new Map<string, Promise<void>>();

function tableNameFor(targetType: FavoriteTargetType) {
  return targetType === 'artist' ? '"FavoriteArtist"' : '"FavoriteArtwork"';
}

function slugColumnFor(targetType: FavoriteTargetType) {
  return targetType === 'artist' ? '"artistSlug"' : '"artworkSlug"';
}

export async function ensureFavoritesStorage() {
  if (!isDatabaseConfigured()) {
    return;
  }

  const key = process.env.DATABASE_URL ?? 'database';
  const existing = favoritesInitialization.get(key);
  if (existing) {
    await existing;
    return;
  }

  const initialize = (async () => {
    const prisma = getPrisma();
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FavoriteArtist" (
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "artistSlug" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("userId", "artistSlug")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FavoriteArtwork" (
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "artworkSlug" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("userId", "artworkSlug")
      );
    `);
  })();

  favoritesInitialization.set(key, initialize);
  try {
    await initialize;
  } catch (error) {
    favoritesInitialization.delete(key);
    throw error;
  }
}

export async function getIsFavoritedByUser(userId: string | undefined, targetType: FavoriteTargetType, targetSlug: string) {
  if (!userId || !isDatabaseConfigured()) {
    return false;
  }

  await ensureFavoritesStorage();
  const prisma = getPrisma();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT 1 AS found FROM ${tableNameFor(targetType)} WHERE "userId" = $1 AND ${slugColumnFor(targetType)} = $2 LIMIT 1`,
    userId,
    targetSlug
  )) as Array<{ found: number }>;

  return rows.length > 0;
}

export async function setFavoritedByUser(userId: string, targetType: FavoriteTargetType, targetSlug: string, favorited: boolean) {
  if (!isDatabaseConfigured()) {
    return;
  }

  await ensureFavoritesStorage();
  const prisma = getPrisma();
  const tableName = tableNameFor(targetType);
  const slugColumn = slugColumnFor(targetType);

  if (favorited) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${tableName} ("userId", ${slugColumn}) VALUES ($1, $2) ON CONFLICT ("userId", ${slugColumn}) DO NOTHING`,
      userId,
      targetSlug
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${tableName} WHERE "userId" = $1 AND ${slugColumn} = $2`,
    userId,
    targetSlug
  );
}

export async function getFavoriteSlugsByMemberHandle(handle: string, targetType: FavoriteTargetType) {
  if (!isDatabaseConfigured()) {
    return [] as string[];
  }

  await ensureFavoritesStorage();
  const prisma = getPrisma();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT ${slugColumnFor(targetType)} AS slug
     FROM ${tableNameFor(targetType)} favorites
     JOIN "User" users ON users.id = favorites."userId"
     WHERE users.handle = $1
     ORDER BY favorites."createdAt" DESC`,
    handle
  )) as Array<{ slug: string }>;

  return rows.map((row) => row.slug);
}
