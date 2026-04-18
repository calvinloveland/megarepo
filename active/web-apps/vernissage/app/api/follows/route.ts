import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/src/lib/auth';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';

type FollowPayload = {
  memberHandle?: string;
  following?: boolean;
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ message: 'Database unavailable.' }, { status: 503 });
  }

  const payload = (await request.json()) as FollowPayload;
  const memberHandle = payload.memberHandle?.trim().toLowerCase() ?? '';
  const following = payload.following === true;
  if (!memberHandle) {
    return NextResponse.json({ message: 'Invalid member handle.' }, { status: 400 });
  }

  const prisma = getPrisma();
  const targetUser = await prisma.user.findUnique({
    where: {
      handle: memberHandle
    },
    select: {
      id: true,
      handle: true
    }
  });

  if (!targetUser) {
    return NextResponse.json({ message: 'Unknown member.' }, { status: 404 });
  }

  if (targetUser.id === session.user.id) {
    return NextResponse.json({ message: 'You cannot follow yourself.' }, { status: 400 });
  }

  if (following) {
    await prisma.follow.upsert({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: targetUser.id
        }
      },
      update: {},
      create: {
        followerId: session.user.id,
        followingId: targetUser.id
      }
    });
  } else {
    await prisma.follow.deleteMany({
      where: {
        followerId: session.user.id,
        followingId: targetUser.id
      }
    });
  }

  return NextResponse.json({
    ok: true,
    following
  });
}
