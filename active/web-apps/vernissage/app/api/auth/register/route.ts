import { NextResponse } from 'next/server';

import { members } from '@/src/lib/catalog';
import { hashPassword } from '@/src/lib/passwords';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { normalizeHandle } from '@/src/lib/review-submission';

function redirectTo(request: Request, path: string, params: Record<string, string>) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const requestUrl = new URL(request.url);
  const protocol =
    forwardedProto ??
    (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : requestUrl.protocol.replace(':', ''));
  const url = new URL(path, host ? `${protocol}://${host}` : requestUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return redirectTo(request, '/join', { error: 'database-unavailable' });
  }

  const formData = await request.formData();
  const callbackUrl = `${formData.get('callbackUrl') ?? '/reviews/new'}` || '/reviews/new';
  const name = `${formData.get('name') ?? ''}`.trim();
  const handle = normalizeHandle(`${formData.get('handle') ?? ''}`);
  const email = `${formData.get('email') ?? ''}`.trim().toLowerCase();
  const password = `${formData.get('password') ?? ''}`;
  const location = `${formData.get('location') ?? ''}`.trim();
  const bio = `${formData.get('bio') ?? ''}`.trim();

  if (!name || !handle || !email || password.length < 10 || handle.length < 3 || handle.length > 32 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirectTo(request, '/join', { error: 'invalid', callbackUrl });
  }

  if (members.some((member) => member.handle === handle)) {
    return redirectTo(request, '/join', { error: 'reserved-handle', callbackUrl });
  }

  const prisma = getPrisma();
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { handle }]
    },
    select: {
      email: true,
      handle: true
    }
  });

  if (existingUser?.email === email) {
    return redirectTo(request, '/join', { error: 'email-in-use', callbackUrl });
  }

  if (existingUser?.handle === handle) {
    return redirectTo(request, '/join', { error: 'handle-in-use', callbackUrl });
  }

  await prisma.user.create({
    data: {
      name,
      handle,
      email,
      passwordHash: await hashPassword(password),
      location: location || null,
      bio: bio || null
    }
  });

  return redirectTo(request, '/signin', {
    registered: '1',
    identifier: email,
    callbackUrl
  });
}
