import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { artists, artworks } from '@/src/lib/catalog';
import { authOptions } from '@/src/lib/auth';
import { setFavoritedByUser } from '@/src/lib/favorites-storage';
import { isDatabaseConfigured } from '@/src/lib/prisma';

const allowedTargets = {
  artist: new Set(artists.map((artist) => artist.slug)),
  artwork: new Set(artworks.map((artwork) => artwork.slug))
} as const;

type FavoritePayload = {
  targetType?: 'artist' | 'artwork';
  targetSlug?: string;
  favorited?: boolean;
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ message: 'Database unavailable.' }, { status: 503 });
  }

  const payload = (await request.json()) as FavoritePayload;
  const targetType = payload.targetType;
  const targetSlug = payload.targetSlug?.trim() ?? '';
  const favorited = payload.favorited === true;

  if (!(targetType === 'artist' || targetType === 'artwork') || !targetSlug || !allowedTargets[targetType].has(targetSlug)) {
    return NextResponse.json({ message: 'Invalid favorite target.' }, { status: 400 });
  }

  await setFavoritedByUser(session.user.id, targetType, targetSlug, favorited);

  return NextResponse.json({
    ok: true,
    favorited
  });
}
