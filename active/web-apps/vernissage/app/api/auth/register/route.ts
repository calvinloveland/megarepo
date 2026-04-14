import { NextResponse } from 'next/server';

import { members } from '@/src/lib/catalog';
import { parseRegistrationSubmission } from '@/src/lib/account-registration';
import { hashPassword } from '@/src/lib/passwords';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';

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
  const parsed = parseRegistrationSubmission(formData);
  if (!parsed.ok) {
    const callbackUrl = `${formData.get('callbackUrl') ?? '/reviews/new'}` || '/reviews/new';
    return redirectTo(request, '/join', { error: parsed.error, callbackUrl });
  }
  const { callbackUrl, name, handle, password } = parsed.value;

  if (members.some((member) => member.handle === handle)) {
    return redirectTo(request, '/join', { error: 'reserved-handle', callbackUrl });
  }

  const prisma = getPrisma();
  const existingUser = await prisma.user.findFirst({
    where: {
      handle
    },
    select: {
      handle: true
    }
  });

  if (existingUser?.handle === handle) {
    return redirectTo(request, '/join', { error: 'handle-in-use', callbackUrl });
  }

  await prisma.user.create({
    data: {
      name,
      handle,
      passwordHash: await hashPassword(password)
    }
  });

  return redirectTo(request, '/signin', {
    registered: '1',
    identifier: handle,
    callbackUrl
  });
}
